#!/usr/bin/env node
// WP CVE collector — vezme pluginy/verzie z wp_snapshots (poslal ich WP agent),
// porovná cez WPScan so známymi zraniteľnosťami a zapíše `vulns` späť do wp_snapshots.
// Zdroj pluginov je DB (nič nesťahuje z webov). WPScan free = 25 req/deň → dedup slugov.
//
//   node index.mjs           → prejde wp_snapshots s pluginmi, zapíše vulns
//
// Env: WPSCAN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
const WPSCAN_BASE = 'https://wpscan.com/api/v3';
const UA = 'MonitorixCVE/1.0 (+https://dash.lopatka.sk)';
const DAILY_BUDGET = 25; // WPScan free tier

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
  const vulns = (entry.vulnerabilities ?? []).map((v) => ({
    title: v.title,
    cve: v.references?.cve?.[0] ? `CVE-${v.references.cve[0]}` : null,
    fixed_in: v.fixed_in ?? null,
  }));
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
        out.push({ target: t.label, slug: t.slug, version: t.version, title: v.title, cve: v.cve, fixed_in: v.fixed_in });
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
  const budget = { left: DAILY_BUDGET };
  let ok = 0;
  let failed = 0;

  for (const wp of rows) {
    try {
      const { vulns, rateLimited } = await collectVulns(wp, token, cache, budget);
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
