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

const MAX_PAGES_PER_SITE = 10; // cap kvôli času behu (owner-adjustable)
const CONCURRENCY = 4;         // súbežných PSI volaní; PSI to znesie

// concurrency-limited map (worker-pool). Zachová poradie výsledkov.
async function mapLimit(items, limit, fn) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function run() {
  const KEY = process.env.PSI_API_KEY;
  if (!KEY) throw new Error('PSI_API_KEY je povinný');
  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sites = await (await fetch(`${url}/rest/v1/sites?select=id,org_id,url,domain&is_active=eq.true`, { headers: restHeaders(srv) })).json();

  // Baseline pre drop-detekciu (per-web homepage) — nezmenené oproti pôvodnému.
  const baseRows = await (await fetch(`${url}/rest/v1/metric_history?select=site_id,metric,value&metric=in.(perf_mobile,perf_desktop)&order=captured_at.desc`, { headers: restHeaders(srv) })).json();
  const baseline = new Map();
  for (const r of Array.isArray(baseRows) ? baseRows : []) {
    const k = `${r.site_id}|${r.metric}`;
    if (!baseline.has(k) && r.value !== null) baseline.set(k, Number(r.value));
  }

  // Monitorované stránky pre všetky aktívne weby (homepage prvá vďaka order).
  const siteIds = (Array.isArray(sites) ? sites : []).map((s) => s.id);
  const pagesRes = siteIds.length
    ? await (await fetch(`${url}/rest/v1/monitored_pages?select=id,site_id,org_id,url,is_homepage&active=eq.true&site_id=in.(${siteIds.join(',')})&order=is_homepage.desc,added_at.asc`, { headers: restHeaders(srv) })).json()
    : [];
  const pagesBySite = new Map();
  for (const p of Array.isArray(pagesRes) ? pagesRes : []) {
    const arr = pagesBySite.get(p.site_id) ?? [];
    if (arr.length < MAX_PAGES_PER_SITE) arr.push(p);
    else console.log(JSON.stringify({ ev: 'psi.page_cap', site_id: p.site_id, skipped: p.url }));
    pagesBySite.set(p.site_id, arr);
  }

  // Jednotky práce: stránka × stratégia.
  const units = [];
  for (const s of Array.isArray(sites) ? sites : []) {
    for (const p of pagesBySite.get(s.id) ?? []) {
      for (const strategy of ['mobile', 'desktop']) units.push({ s, p, strategy });
    }
  }

  const now = new Date().toISOString();
  const wk = isoWeek(new Date());
  let ok = 0;
  let failed = 0;
  const perfRuns = [];
  const snapshotRows = []; // homepage → perf_snapshots (back-compat)
  const alertRows = [];

  await mapLimit(units, CONCURRENCY, async ({ s, p, strategy }) => {
    const r = await fetchPsi(p.url, KEY, strategy);
    if (r.ok) {
      const x = r.snap;
      perfRuns.push({
        page_id: p.id, org_id: p.org_id, strategy,
        performance_score: x.performanceScore, accessibility: x.accessibility, best_practices: x.bestPractices, seo: x.seo,
        lcp_ms: x.lcpMs, fcp_ms: x.fcpMs, inp_ms: x.inpMs, cls: x.cls, tbt_ms: x.tbtMs, ttfb_ms: x.ttfbMs,
        page_weight_kb: x.pageWeightKb, requests: x.requests,
        field_lcp_ms: x.fieldLcpMs, field_inp_ms: x.fieldInpMs, field_cls: x.fieldCls,
        opportunities: x.opportunities, measured_at: now, error: null,
      });
      ok++;
      console.log(JSON.stringify({ ev: 'psi.ok', url: p.url, strategy, perf: x.performanceScore }));

      if (p.is_homepage) {
        snapshotRows.push({
          site_id: s.id, org_id: s.org_id, strategy,
          performance_score: x.performanceScore, accessibility: x.accessibility, best_practices: x.bestPractices, seo: x.seo,
          lcp_ms: x.lcpMs, inp_ms: x.inpMs, cls: x.cls, tbt_ms: x.tbtMs, ttfb_ms: x.ttfbMs,
          page_weight_kb: x.pageWeightKb, requests: x.requests,
          field_lcp_ms: x.fieldLcpMs, field_inp_ms: x.fieldInpMs, field_cls: x.fieldCls,
          measured_at: now, error: null,
        });
        const meta = PERF_METRIC[strategy];
        const before = baseline.get(`${s.id}|${meta.metric}`);
        const cur = x.performanceScore;
        if (typeof cur === 'number' && typeof before === 'number' && isDrop(before, cur, PERF_DROP_TH)) {
          const dom = s.domain ?? s.url ?? 'web';
          alertRows.push({
            org_id: s.org_id, site_id: s.id, type: 'metric_drop', severity: 'warning',
            title: `${dom}: ${meta.label} kleslo`, body: `${meta.label}: ${Math.round(before)} → ${Math.round(cur)}`,
            dedupe_key: `proactive:${s.id}:${meta.metric}:${wk}`,
          });
        }
      }
    } else {
      perfRuns.push({
        page_id: p.id, org_id: p.org_id, strategy,
        performance_score: null, accessibility: null, best_practices: null, seo: null,
        lcp_ms: null, fcp_ms: null, inp_ms: null, cls: null, tbt_ms: null, ttfb_ms: null,
        page_weight_kb: null, requests: null, field_lcp_ms: null, field_inp_ms: null, field_cls: null,
        opportunities: [], measured_at: now, error: r.error,
      });
      if (p.is_homepage) {
        snapshotRows.push({
          site_id: s.id, org_id: s.org_id, strategy,
          performance_score: null, accessibility: null, best_practices: null, seo: null,
          lcp_ms: null, inp_ms: null, cls: null, tbt_ms: null, ttfb_ms: null,
          page_weight_kb: null, requests: null, field_lcp_ms: null, field_inp_ms: null, field_cls: null,
          measured_at: now, error: r.error,
        });
      }
      failed++;
      console.log(JSON.stringify({ ev: 'psi.fail', url: p.url, strategy, error: r.error }));
    }
  });

  // Batch append do perf_runs (jeden POST).
  if (perfRuns.length) {
    const ins = await fetch(`${url}/rest/v1/perf_runs`, { method: 'POST', headers: { ...restHeaders(srv), Prefer: 'return=minimal' }, body: JSON.stringify(perfRuns) });
    if (!ins.ok) console.log(JSON.stringify({ ev: 'psi.perf_runs_fail', status: ins.status, body: (await ins.text()).slice(0, 200) }));
  }
  // Homepage → perf_snapshots (back-compat, per riadok upsert ako doteraz).
  for (const row of snapshotRows) {
    const up = await fetch(`${url}/rest/v1/perf_snapshots?on_conflict=site_id,strategy`, { method: 'POST', headers: { ...restHeaders(srv), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
    if (!up.ok) console.log(JSON.stringify({ ev: 'psi.upsert_fail', status: up.status, body: (await up.text()).slice(0, 200) }));
  }
  await raiseAlerts(url, srv, alertRows, 'psi.alerts_fail');
  console.log(JSON.stringify({ ev: 'psi.done', ok, failed, runs: perfRuns.length, alerts: alertRows.length }));
  return { ok, failed };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
