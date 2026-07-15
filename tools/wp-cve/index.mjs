#!/usr/bin/env node
// WP CVE collector — vezme pluginy/verzie z wp_snapshots (poslal ich WP agent),
// porovná cez WPScan so známymi zraniteľnosťami a zapíše `vulns` späť do wp_snapshots.
// Zdroj pluginov je DB (nič nesťahuje z webov). WPScan free = 25 req/deň → dedup slugov.
//
//   node index.mjs           → prejde wp_snapshots s pluginmi, zapíše vulns
//
// Závažnosť (CVSS): najprv WPScan vlastné `cvss.score`, inak NVD lookup podľa
// CVE id (nvd.nist.gov, zdarma). Ak ani jedno → severity 'unknown' (nefabrikujeme).
//
// Env: WPSCAN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (voliteľne) NVD_API_KEY
import { recordJobRun } from '../_shared/jobRun.mjs';
import { severityFromScore } from '../../packages/core/dist/cve.js';

const WPSCAN_BASE = 'https://wpscan.com/api/v3';
const UA = 'MonitorixCVE/1.0 (+https://dash.lopatka.sk)';
const DAILY_BUDGET = 25; // WPScan free tier
const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// NVD lookup CVSS base score podľa CVE id. Bez kľúča limit 5 req/30s → 6.5s pauza.
// Preferuje v3.1 → v3.0 → v2. Vráti number|null (null = NVD skóre nemá).
async function nvdScore(cveId, apiKey) {
  const headers = { 'User-Agent': UA, ...(apiKey ? { apiKey } : {}) };
  const res = await fetch(`${NVD_BASE}?cveId=${encodeURIComponent(cveId)}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const body = await res.json();
  const metrics = body.vulnerabilities?.[0]?.cve?.metrics ?? {};
  const m = metrics.cvssMetricV31?.[0] ?? metrics.cvssMetricV30?.[0] ?? metrics.cvssMetricV2?.[0];
  const score = m?.cvssData?.baseScore;
  return typeof score === 'number' ? score : null;
}

// Doplní každému vuln `cvss` (number|null) + `severity`. WPScan skóre má prednosť,
// inak NVD podľa CVE (dedup + rate-limit). Mutuje pole vulns.
async function enrichSeverity(vulns, nvdCache, apiKey) {
  for (const v of vulns) {
    let score = typeof v.cvss === 'number' ? v.cvss : null; // z WPScan
    if (score === null && v.cve) {
      if (nvdCache.has(v.cve)) {
        score = nvdCache.get(v.cve);
      } else {
        try {
          score = await nvdScore(v.cve, apiKey);
        } catch {
          score = null;
        }
        nvdCache.set(v.cve, score);
        await sleep(apiKey ? 700 : 6500); // rešpektuj NVD rate-limit
      }
    }
    v.cvss = score;
    v.severity = severityFromScore(score);
  }
}

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// „1.2.10" > „1.2.9" — číselné porovnanie po segmentoch.
function cmpVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Zraniteľná, ak nie je opravená (fixed_in null) alebo je inštalovaná verzia nižšia než fixed_in.
function isAffected(installed, fixedIn) {
  if (!fixedIn) return true;
  if (!installed) return false;
  return cmpVersions(installed, fixedIn) < 0;
}

// WPScan lookup s cache (dedup) a rozpočtom. Vráti { vulns, rateLimited }.
async function wpscan(kind, id, token, cache, budget) {
  const key = `${kind}:${id}`;
  if (cache.has(key)) return cache.get(key);
  if (budget.left <= 0) {
    const r = { rateLimited: true, vulns: [] };
    cache.set(key, r);
    return r;
  }
  const path = kind === 'plugin' ? `/plugins/${id}` : `/wordpresses/${String(id).replace(/\./g, '')}`;
  budget.left--;
  const res = await fetch(`${WPSCAN_BASE}${path}`, { headers: { Authorization: `Token token=${token}`, 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) {
    const r = { vulns: [] }; // žiadne známe vulns pre tento slug
    cache.set(key, r);
    return r;
  }
  if (res.status === 429) {
    budget.left = 0;
    const r = { rateLimited: true, vulns: [] };
    cache.set(key, r);
    return r;
  }
  if (!res.ok) {
    const r = { error: res.status, vulns: [] };
    cache.set(key, r);
    return r;
  }
  const body = await res.json();
  const entry = body[Object.keys(body)[0]] ?? {};
  const vulns = (entry.vulnerabilities ?? []).map((v) => {
    // WPScan niekedy vracia cvss ako { score } alebo číslo/string; vezmi ak je platné.
    const raw = v.cvss?.score ?? v.cvss ?? null;
    const wpCvss = raw != null && !Number.isNaN(Number(raw)) ? Number(raw) : null;
    return {
      title: v.title,
      cve: v.references?.cve?.[0] ? `CVE-${v.references.cve[0]}` : null,
      fixed_in: v.fixed_in ?? null,
      cvss: wpCvss,
    };
  });
  const r = { vulns };
  cache.set(key, r);
  return r;
}

// Vyhodnotí CVE pre jeden web z jeho (uložených) pluginov + core.
async function collectVulns(wp, token, cache, budget) {
  const out = [];
  const targets = [];
  if (wp.wp_version) targets.push({ kind: 'core', id: wp.wp_version, slug: 'wordpress', label: 'WordPress', version: wp.wp_version });
  for (const p of wp.plugins ?? []) {
    if (p.slug === 'monitorix-agent') continue;
    targets.push({ kind: 'plugin', id: p.slug, slug: p.slug, label: p.name, version: p.version });
  }
  let rateLimited = false;
  for (const t of targets) {
    const r = await wpscan(t.kind, t.id, token, cache, budget);
    if (r.rateLimited) rateLimited = true;
    for (const v of r.vulns) {
      if (isAffected(t.version, v.fixed_in)) {
        out.push({ target: t.label, slug: t.slug, version: t.version, title: v.title, cve: v.cve, fixed_in: v.fixed_in, cvss: v.cvss ?? null });
      }
    }
  }
  return { vulns: out, rateLimited };
}

async function main() {
  const token = process.env.WPSCAN_TOKEN;
  if (!token) throw new Error('WPSCAN_TOKEN je povinný');
  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const rows = await (await fetch(`${url}/rest/v1/wp_snapshots?select=site_id,wp_version,plugins&wp_version=not.is.null`, { headers: restHeaders(srv) })).json();
  const cache = new Map();
  const nvdCache = new Map(); // CVE id -> score|null (dedup NVD naprieč webmi)
  const nvdKey = process.env.NVD_API_KEY || null;
  const budget = { left: DAILY_BUDGET };
  let ok = 0;
  let failed = 0;

  for (const wp of rows) {
    try {
      const { vulns, rateLimited } = await collectVulns(wp, token, cache, budget);
      await enrichSeverity(vulns, nvdCache, nvdKey);
      const up = await fetch(`${url}/rest/v1/wp_snapshots?site_id=eq.${wp.site_id}`, {
        method: 'PATCH',
        headers: { ...restHeaders(srv), Prefer: 'return=minimal' },
        body: JSON.stringify({ vulns }),
      });
      if (!up.ok) throw new Error(`patch ${up.status}: ${await up.text()}`);
      ok++;
      console.log(JSON.stringify({ ev: 'cve.ok', site_id: wp.site_id, vulns: vulns.length, rate_limited: rateLimited }));
    } catch (e) {
      failed++;
      console.log(JSON.stringify({ ev: 'cve.fail', site_id: wp.site_id, error: String(e?.message ?? e) }));
    }
  }
  console.log(JSON.stringify({ ev: 'cve.done', ok, failed, wpscan_left: budget.left }));
  await recordJobRun(url, srv, 'cve', ok, failed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
