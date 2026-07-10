#!/usr/bin/env node
// WordPress agent collector — verzie/pluginy/updaty z mu-pluginu (HMAC) + CVE z WPScan.
//
//   node index.mjs --probe <url>   → vypíše stav jedného webu (potrebuje WP_AGENT_SECRET)
//   node index.mjs                  → prejde WP weby zo Supabase, zapíše wp_snapshots
//
// Env: WP_AGENT_SECRET (HMAC, ten istý ako v wp-config MONITORIX_AGENT_SECRET),
//      WPSCAN_TOKEN (voliteľné — bez neho sa CVE preskočia),
//      (DB) SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createHmac } from 'node:crypto';

const UA = 'MonitorixWP/1.0 (+https://dash.lopatka.sk)';
const WPSCAN_BASE = 'https://wpscan.com/api/v3';

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

export async function probeWp(url, secret) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', secret).update(ts).digest('hex');
  const res = await fetch(`${url.replace(/\/$/, '')}/wp-json/monitorix/v1/status`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': UA, 'X-Monitorix-Timestamp': ts, 'X-Monitorix-Signature': sig },
  });
  if (!res.ok) throw new Error(`agent ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// WPScan lookup s cache (dedup podľa kľúča) — vráti [] pri 404 (žiadne známe vulns).
async function wpscan(kind, id, token, cache, budget) {
  const key = `${kind}:${id}`;
  if (cache.has(key)) return cache.get(key);
  if (budget.left <= 0) {
    cache.set(key, { rateLimited: true, vulns: [] });
    return cache.get(key);
  }
  const path = kind === 'plugin' ? `/plugins/${id}` : `/wordpresses/${String(id).replace(/\./g, '')}`;
  budget.left--;
  const res = await fetch(`${WPSCAN_BASE}${path}`, { headers: { Authorization: `Token token=${token}`, 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) {
    cache.set(key, { vulns: [] });
    return cache.get(key);
  }
  if (res.status === 429) {
    budget.left = 0;
    cache.set(key, { rateLimited: true, vulns: [] });
    return cache.get(key);
  }
  if (!res.ok) {
    cache.set(key, { error: res.status, vulns: [] });
    return cache.get(key);
  }
  const body = await res.json();
  const entry = body[Object.keys(body)[0]] ?? {};
  const vulns = (entry.vulnerabilities ?? []).map((v) => ({
    title: v.title,
    cve: v.references?.cve?.[0] ? `CVE-${v.references.cve[0]}` : null,
    fixed_in: v.fixed_in ?? null,
  }));
  cache.set(key, { vulns });
  return cache.get(key);
}

// Vyhodnotí CVE pre jeden web z jeho pluginov (+ core) — len tie, ktoré ho reálne ohrozujú.
async function collectVulns(snap, token, cache, budget) {
  const out = [];
  const targets = [];
  if (snap.wp_version) targets.push({ kind: 'core', id: snap.wp_version, slug: 'wordpress', label: 'WordPress', version: snap.wp_version });
  for (const p of snap.plugins ?? []) targets.push({ kind: 'plugin', id: p.slug, slug: p.slug, label: p.name, version: p.version });

  for (const t of targets) {
    const r = await wpscan(t.kind, t.id, token, cache, budget);
    for (const v of r.vulns) {
      if (isAffected(t.version, v.fixed_in)) {
        out.push({ target: t.label, slug: t.slug, version: t.version, title: v.title, cve: v.cve, fixed_in: v.fixed_in });
      }
    }
  }
  return out;
}

async function main() {
  const secret = process.env.WP_AGENT_SECRET;
  if (!secret) throw new Error('WP_AGENT_SECRET je povinný');
  const token = process.env.WPSCAN_TOKEN || null;
  const args = process.argv.slice(2);

  if (args[0] === '--probe') {
    const url = args[1];
    if (!url) throw new Error('usage: --probe <url>');
    const snap = await probeWp(url, secret);
    if (token) {
      const cache = new Map();
      const budget = { left: 25 };
      snap.vulns = await collectVulns(snap, token, cache, budget);
    }
    console.log(JSON.stringify(snap, null, 2));
    return;
  }

  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,url&is_active=eq.true&cms=eq.wordpress`, { headers: restHeaders(srv) });
  const sites = await sitesRes.json();
  const now = new Date().toISOString();
  const cache = new Map();
  const budget = { left: token ? 25 : 0 }; // WPScan free: 25/deň
  let ok = 0;
  let failed = 0;

  for (const s of sites) {
    let row;
    try {
      const snap = await probeWp(s.url, secret);
      const vulns = token ? await collectVulns(snap, token, cache, budget) : [];
      row = {
        site_id: s.id,
        org_id: s.org_id,
        wp_version: snap.wp_version ?? null,
        wp_update: snap.wp_update ?? null,
        php_version: snap.php_version ?? null,
        mysql_version: snap.mysql_version ?? null,
        theme: snap.theme ?? null,
        plugins: snap.plugins ?? [],
        vulns,
        backup_at: snap.backup_at ?? null,
        measured_at: now,
        error: null,
      };
      ok++;
      console.log(JSON.stringify({ ev: 'wp.ok', url: s.url, wp: snap.wp_version, plugins: (snap.plugins ?? []).length, vulns: vulns.length }));
    } catch (e) {
      row = { site_id: s.id, org_id: s.org_id, plugins: [], vulns: [], measured_at: now, error: String(e?.message ?? e) };
      failed++;
      console.log(JSON.stringify({ ev: 'wp.fail', url: s.url, error: String(e?.message ?? e) }));
    }
    const up = await fetch(`${url}/rest/v1/wp_snapshots?on_conflict=site_id`, {
      method: 'POST',
      headers: { ...restHeaders(srv), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!up.ok) console.log(JSON.stringify({ ev: 'wp.upsert_fail', url: s.url, status: up.status, body: await up.text() }));
  }
  console.log(JSON.stringify({ ev: 'wp.done', ok, failed, wpscan_left: budget.left }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
