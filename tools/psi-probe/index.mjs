#!/usr/bin/env node
// PageSpeed Insights collector — pre každý web mobile + desktop, zapíše perf_snapshots.
//
//   node index.mjs --probe <url>       → vypíše skóre (test, potrebuje PSI_API_KEY)
//   node index.mjs                      → prejde aktívne weby zo Supabase
//
// Env: PSI_API_KEY, (DB režim) SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { fetchPsi } from '../../packages/core/dist/psi.js';
import { isoWeek, isDrop } from '../../packages/core/dist/proactive.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Denná detekcia poklesu výkonu (PSI beží denne, ale history-snapshot deteguje
// zhoršenia len týždenne → až 7 dní neskoro). Formát MUSÍ byť byte-identický s
// history-snapshot/index.mjs (METRICS + `proactive:<site>:<metric>:<wk>`), aby
// denný psi alert a týždenný history alert DEDUPOVALI proti sebe (žiadny dvojitý
// e-mail). history-snapshot je ZDROJ PRAVDY formátu — tu ho len replikujeme.
const PERF_DROP_TH = 10; // rovnaký prah ako history-snapshot METRICS (perf ±10)
const PERF_METRIC = {
  mobile: { metric: 'perf_mobile', label: 'Výkon (mobil)' },
  desktop: { metric: 'perf_desktop', label: 'Výkon (desktop)' },
};

import { runJob } from '../_shared/runJob.mjs';
import { raiseAlerts } from '../_shared/raiseAlert.mjs';

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

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,url,domain&is_active=eq.true`, { headers: restHeaders(srv) });
  const sites = await sitesRes.json();

  // Baseline pre detekciu poklesu: posledná (najnovšia) hodnota metric_history
  // pre perf_mobile/perf_desktop per web (to isté, čo history-snapshot berie ako
  // `prev`). Prvý = najnovší vďaka order=captured_at.desc.
  const baseRows = await (await fetch(`${url}/rest/v1/metric_history?select=site_id,metric,value&metric=in.(perf_mobile,perf_desktop)&order=captured_at.desc`, { headers: restHeaders(srv) })).json();
  const baseline = new Map(); // `${site}|${metric}` -> number
  for (const r of Array.isArray(baseRows) ? baseRows : []) {
    const k = `${r.site_id}|${r.metric}`;
    if (!baseline.has(k) && r.value !== null) baseline.set(k, Number(r.value));
  }

  const now = new Date().toISOString();
  const wk = isoWeek(new Date());
  let ok = 0;
  let failed = 0;
  const alertRows = []; // denné poklesy výkonu → e-mailová fronta (runAlerts)

  for (const s of sites) {
    for (const strategy of ['mobile', 'desktop']) {
      const r = await fetchPsi(s.url, KEY, strategy);
      let row;
      if (r.ok) {
        const p = r.snap;
        row = { site_id: s.id, org_id: s.org_id, strategy, performance_score: p.performanceScore, accessibility: p.accessibility, best_practices: p.bestPractices, seo: p.seo, lcp_ms: p.lcpMs, inp_ms: p.inpMs, cls: p.cls, tbt_ms: p.tbtMs, ttfb_ms: p.ttfbMs, page_weight_kb: p.pageWeightKb, requests: p.requests, field_lcp_ms: p.fieldLcpMs, field_inp_ms: p.fieldInpMs, field_cls: p.fieldCls, measured_at: now, error: null };
        ok++;
        console.log(JSON.stringify({ ev: 'psi.ok', url: s.url, strategy, perf: p.performanceScore }));

        // Pokles ≥ PERF_DROP_TH oproti baseline → metric_drop alert (owner
        // rozhodnutie: rovnaký prah/formát ako history). Prvý beh (žiadny
        // baseline) → skip. Len zhoršenie (isDrop), nie zlepšenie.
        const meta = PERF_METRIC[strategy];
        const before = baseline.get(`${s.id}|${meta.metric}`);
        const cur = p.performanceScore;
        if (typeof cur === 'number' && typeof before === 'number' && isDrop(before, cur, PERF_DROP_TH)) {
          const dom = s.domain ?? s.url ?? 'web';
          alertRows.push({
            org_id: s.org_id,
            site_id: s.id,
            type: 'metric_drop',
            severity: 'warning',
            title: `${dom}: ${meta.label} kleslo`,
            body: `${meta.label}: ${Math.round(before)} → ${Math.round(cur)}`,
            dedupe_key: `proactive:${s.id}:${meta.metric}:${wk}`,
          });
        }
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
  // Non-fatal insert, dedupe cez unique dedupe_key (dedupuje aj proti týždennému
  // history-snapshot alertu — rovnaký kľúč `proactive:<site>:<metric>:<wk>`).
  await raiseAlerts(url, srv, alertRows, 'psi.alerts_fail');
  console.log(JSON.stringify({ ev: 'psi.done', ok, failed, alerts: alertRows.length }));
  return { ok, failed };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
