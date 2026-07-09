#!/usr/bin/env node
// AEO collector — fetchne HTML + robots.txt + llms.txt každého webu, spočíta
// deterministické skóre cez core.scoreAeo a zapíše do aeo_snapshots.
// Bez externých API kľúčov. Beží ako GitHub Action (týždenne) alebo lokálne.
//
// Režimy:
//   node index.mjs --probe <domena>   → vypíše skóre (test, bez DB)
//   node index.mjs                     → prejde aktívne weby zo Supabase, zapíše aeo_snapshots
//
// Env (DB režim): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { scoreAeo } from '../../packages/core/dist/aeo.js';

const UA = 'AgencyDashboard/1.0 (+https://dash.lopatka.sk)';
const TIMEOUT = 12_000;

async function tryFetch(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': UA },
    });
    return res;
  } catch {
    return null;
  }
}

export async function probeAeo(domain) {
  const res = await tryFetch(`https://${domain}`);
  if (!res || !res.ok) throw new Error(`fetch ${domain}: ${res ? res.status : 'network'}`);
  const html = (await res.text()).slice(0, 500_000);
  const robotsRes = await tryFetch(`https://${domain}/robots.txt`);
  const robotsTxt = robotsRes && robotsRes.ok ? await robotsRes.text() : '';
  const llmsRes = await tryFetch(`https://${domain}/llms.txt`);
  const hasLlmsTxt = Boolean(llmsRes && llmsRes.ok);
  return scoreAeo({ html, robotsTxt, hasLlmsTxt });
}

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--probe') {
    const domain = args[1];
    if (!domain) throw new Error('usage: --probe <domena>');
    const r = await probeAeo(domain);
    console.log(JSON.stringify({ score: r.score, aiBots: r.aiBots, schemaTypes: r.schemaTypes, checks: r.checks.map((c) => `${c.pass ? '✓' : '✗'} ${c.label} (${c.earned}/${c.weight})`) }, null, 2));
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,domain&is_active=eq.true`, { headers: restHeaders(key) });
  if (!sitesRes.ok) throw new Error(`load sites ${sitesRes.status}`);
  const sites = await sitesRes.json();
  const now = new Date().toISOString();
  let ok = 0;
  let failed = 0;

  for (const s of sites) {
    let row;
    try {
      const r = await probeAeo(s.domain);
      row = { site_id: s.id, org_id: s.org_id, score: r.score, checks: r.checks, schema_types: r.schemaTypes, has_llms_txt: r.hasLlmsTxt, ai_bots: r.aiBots, measured_at: now, error: null };
      ok++;
      console.log(JSON.stringify({ ev: 'aeo.ok', domain: s.domain, score: r.score }));
    } catch (e) {
      row = { site_id: s.id, org_id: s.org_id, score: null, measured_at: now, error: String(e?.message ?? e) };
      failed++;
      console.log(JSON.stringify({ ev: 'aeo.fail', domain: s.domain, error: String(e?.message ?? e) }));
    }
    const up = await fetch(`${url}/rest/v1/aeo_snapshots?on_conflict=site_id`, {
      method: 'POST',
      headers: { ...restHeaders(key), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!up.ok) console.log(JSON.stringify({ ev: 'aeo.upsert_fail', domain: s.domain, status: up.status, body: await up.text() }));
  }
  console.log(JSON.stringify({ ev: 'aeo.done', ok, failed, total: sites.length }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
