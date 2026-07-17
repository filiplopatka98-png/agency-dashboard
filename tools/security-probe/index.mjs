#!/usr/bin/env node
// Security collector — bezpečnostné hlavičky (skóre) + Google Safe Browsing.
//
//   node index.mjs --probe <url>   → vypíše (test, potrebuje SB_API_KEY)
//   node index.mjs                  → prejde aktívne weby zo Supabase
//
// Env: SB_API_KEY (ten istý Google API key ako PSI), (DB) SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { scoreSecurityHeaders, fetchSafeBrowsing } from '../../packages/core/dist/security.js';

const UA = 'AgencyDashboard/1.0 (+https://dash.lopatka.sk)';

import { runJob } from '../_shared/runJob.mjs';

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export async function probeSecurity(url, sbKey) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': UA } });
  const { score, headers } = scoreSecurityHeaders((n) => res.headers.get(n));
  const sb = await fetchSafeBrowsing(url, sbKey);
  return { score, headers, safe_browsing_ok: sb.ok ? sb.clean : null };
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--probe') {
    // Manuálny test jedného URL — nie je to scheduled beh, nezapisuje sa do job_runs.
    const sbKey = process.env.SB_API_KEY;
    if (!sbKey) throw new Error('SB_API_KEY je povinný');
    const url = args[1];
    if (!url) throw new Error('usage: --probe <url>');
    console.log(JSON.stringify(await probeSecurity(url, sbKey), null, 2));
    return;
  }

  await runJob('security', run);
}

async function run() {
  const sbKey = process.env.SB_API_KEY;
  if (!sbKey) throw new Error('SB_API_KEY je povinný');
  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,url&is_active=eq.true`, { headers: restHeaders(srv) });
  const sites = await sitesRes.json();
  const now = new Date().toISOString();
  let ok = 0;
  let failed = 0;

  for (const s of sites) {
    let row;
    try {
      const r = await probeSecurity(s.url, sbKey);
      row = { site_id: s.id, org_id: s.org_id, ...r, measured_at: now, error: null };
      ok++;
      console.log(JSON.stringify({ ev: 'sec.ok', url: s.url, score: r.score, safe: r.safe_browsing_ok }));
    } catch (e) {
      row = { site_id: s.id, org_id: s.org_id, score: null, measured_at: now, error: String(e?.message ?? e) };
      failed++;
      console.log(JSON.stringify({ ev: 'sec.fail', url: s.url, error: String(e?.message ?? e) }));
    }
    const up = await fetch(`${url}/rest/v1/security_snapshots?on_conflict=site_id`, { method: 'POST', headers: { ...restHeaders(srv), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
    if (!up.ok) console.log(JSON.stringify({ ev: 'sec.upsert_fail', url: s.url, status: up.status, body: await up.text() }));
  }
  console.log(JSON.stringify({ ev: 'sec.done', ok, failed }));
  return { ok, failed };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
