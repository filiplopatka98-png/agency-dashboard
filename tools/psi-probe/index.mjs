#!/usr/bin/env node
// PageSpeed Insights collector — pre každý web mobile + desktop, zapíše perf_snapshots.
//
//   node index.mjs --probe <url>       → vypíše skóre (test, potrebuje PSI_API_KEY)
//   node index.mjs                      → prejde aktívne weby zo Supabase
//
// Env: PSI_API_KEY, (DB režim) SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { fetchPsi } from '../../packages/core/dist/psi.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

import { runJob } from '../_shared/runJob.mjs';

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--probe') {
    // Manuálny test jedného URL — nie je to scheduled beh, nezapisuje sa do job_runs.
    const KEY = process.env.PSI_API_KEY;
    if (!KEY) throw new Error('PSI_API_KEY je povinný');
    const url = args[1];
    if (!url) throw new Error('usage: --probe <url>');
    for (const strategy of ['mobile', 'desktop']) {
      const r = await fetchPsi(url, KEY, strategy);
      console.log(strategy, JSON.stringify(r.ok ? r.snap : { error: r.error }, null, 2));
      await sleep(1500);
    }
    return;
  }

  await runJob('psi', run);
}

async function run() {
  const KEY = process.env.PSI_API_KEY;
  if (!KEY) throw new Error('PSI_API_KEY je povinný');
  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,url&is_active=eq.true`, { headers: restHeaders(srv) });
  const sites = await sitesRes.json();
  const now = new Date().toISOString();
  let ok = 0;
  let failed = 0;

  for (const s of sites) {
    for (const strategy of ['mobile', 'desktop']) {
      const r = await fetchPsi(s.url, KEY, strategy);
      let row;
      if (r.ok) {
        const p = r.snap;
        row = { site_id: s.id, org_id: s.org_id, strategy, performance_score: p.performanceScore, accessibility: p.accessibility, best_practices: p.bestPractices, seo: p.seo, lcp_ms: p.lcpMs, inp_ms: p.inpMs, cls: p.cls, tbt_ms: p.tbtMs, ttfb_ms: p.ttfbMs, page_weight_kb: p.pageWeightKb, requests: p.requests, field_lcp_ms: p.fieldLcpMs, field_inp_ms: p.fieldInpMs, field_cls: p.fieldCls, measured_at: now, error: null };
        ok++;
        console.log(JSON.stringify({ ev: 'psi.ok', url: s.url, strategy, perf: p.performanceScore }));
      } else {
        // Nuluj VŠETKY Lighthouse/CWV polia (skóre aj lab/field metriky) — sú to
        // hodnoty z jedného PSI behu, ktorý zlyhal, takže o nich teraz nevieme
        // nič nové. Bez tohto by `merge-duplicates` upsert ponechal staré
        // hodnoty (zo staršieho úspešného behu) a len im dal čerstvý
        // `measured_at` → dashboard by ukazoval mesiace staré skóre pod
        // odznakom „aktualizované dnes" (data.ts gatuje freshness len na
        // performance_score === null). Rovnaký vzor ako security-probe/
        // aeo-probe/gsc-probe (nulujú score na chybe).
        row = {
          site_id: s.id, org_id: s.org_id, strategy,
          performance_score: null, accessibility: null, best_practices: null, seo: null,
          lcp_ms: null, inp_ms: null, cls: null, tbt_ms: null, ttfb_ms: null,
          page_weight_kb: null, requests: null,
          field_lcp_ms: null, field_inp_ms: null, field_cls: null,
          measured_at: now, error: r.error,
        };
        failed++;
        console.log(JSON.stringify({ ev: 'psi.fail', url: s.url, strategy, error: r.error }));
      }
      const up = await fetch(`${url}/rest/v1/perf_snapshots?on_conflict=site_id,strategy`, { method: 'POST', headers: { ...restHeaders(srv), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
      if (!up.ok) console.log(JSON.stringify({ ev: 'psi.upsert_fail', url: s.url, strategy, status: up.status, body: await up.text() }));
      await sleep(1200);
    }
  }
  console.log(JSON.stringify({ ev: 'psi.done', ok, failed }));
  return { ok, failed };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
