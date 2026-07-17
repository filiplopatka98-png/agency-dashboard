#!/usr/bin/env node
// History snapshot — z aktuálnych snapshotov appenduje týždenné metriky do
// metric_history (trendy) a významné zmeny loguje do change_log (feed „čo sa zmenilo").
//
//   node index.mjs   → prejde weby, zapíše históriu + zmeny
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { runJob } from '../_shared/runJob.mjs';

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// Len skóre — presné CVE/SEO udalosti teraz logujú wp-cve a seo-crawl.
// Prahy: AEO/Security ±3 (deterministické kontroly z HTML/robots.txt → zmena je
// skutočná). Výkon ostáva ±10 — PageSpeed dá tomu istému webu bežne ±5 medzi
// behmi a nižší prah by hlásil zlepšenia, ktoré sú len šum merania.
const METRICS = [
  { key: 'aeo', label: 'AEO skóre', kind: 'score', th: 3, dir: 'up_good' },
  { key: 'security', label: 'Security skóre', kind: 'score', th: 3, dir: 'up_good' },
  { key: 'perf_mobile', label: 'Výkon (mobil)', kind: 'score', th: 10, dir: 'up_good' },
  { key: 'perf_desktop', label: 'Výkon (desktop)', kind: 'score', th: 10, dir: 'up_good' },
];
// Trend bez logovania (týždenne šumové) — seo_issues a wp_vulns tu ostávajú
// kvôli histórii, ale udalosti k nim vyrábajú príslušné collectory.
const TREND_ONLY = ['gsc_clicks', 'gsc_impressions', 'gsc_position', 'seo_issues', 'wp_vulns'];

// ISO týždeň (pre dedupe proaktívnych alertov — max 1 per web+metrika+týždeň).
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

async function main() {
  await runJob('history', run);
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');
  const H = restHeaders(srv);
  const get = async (path) => (await fetch(`${url}/rest/v1/${path}`, { headers: H })).json();

  const sites = await get('sites?select=id,org_id,domain&is_active=eq.true');
  const [aeo, sec, perf, seo, gsc, wp] = await Promise.all([
    get('aeo_snapshots?select=site_id,score'),
    get('security_snapshots?select=site_id,score'),
    get('perf_snapshots?select=site_id,strategy,performance_score'),
    get('seo_snapshots?select=site_id,issues'),
    get('gsc_snapshots?select=site_id,clicks,impressions,position'),
    get('wp_snapshots?select=site_id,vulns'),
  ]);
  const by = (arr) => new Map(arr.map((r) => [r.site_id, r]));
  const aeoM = by(aeo), secM = by(sec), seoM = by(seo), gscM = by(gsc), wpM = by(wp);
  const perfM = new Map();
  for (const p of perf) {
    const cur = perfM.get(p.site_id) ?? {};
    cur[p.strategy] = p.performance_score;
    perfM.set(p.site_id, cur);
  }

  // predchádzajúce hodnoty (posledná captured_at per site+metric)
  const prevRows = await get('metric_history?select=site_id,metric,value&order=captured_at.desc');
  const prev = new Map(); // `${site}|${metric}` -> value (prvý = najnovší)
  for (const r of prevRows) {
    const k = `${r.site_id}|${r.metric}`;
    if (!prev.has(k)) prev.set(k, r.value === null ? null : Number(r.value));
  }

  const now = new Date().toISOString();
  const wk = isoWeek(new Date());
  const historyRows = [];
  const changeRows = [];
  const alertRows = []; // proaktívne alerty (zhoršenia) → e-mailová fronta (runAlerts)
  const nameById = new Map(sites.map((s) => [s.id, s.domain]));

  const curValue = (siteId, key) => {
    switch (key) {
      case 'aeo': return aeoM.get(siteId)?.score ?? null;
      case 'security': return secM.get(siteId)?.score ?? null;
      case 'perf_mobile': return perfM.get(siteId)?.mobile ?? null;
      case 'perf_desktop': return perfM.get(siteId)?.desktop ?? null;
      case 'seo_issues': { const s = seoM.get(siteId); return s?.issues ? s.issues.length : null; }
      case 'wp_vulns': { const w = wpM.get(siteId); return w && w.vulns !== null ? w.vulns.length : null; }
      case 'gsc_clicks': return gscM.get(siteId)?.clicks ?? null;
      case 'gsc_impressions': return gscM.get(siteId)?.impressions ?? null;
      case 'gsc_position': { const g = gscM.get(siteId); return g?.position != null ? Number(g.position) : null; }
      default: return null;
    }
  };

  for (const s of sites) {
    for (const key of [...METRICS.map((m) => m.key), ...TREND_ONLY]) {
      const v = curValue(s.id, key);
      if (v === null) continue;
      historyRows.push({ site_id: s.id, org_id: s.org_id, metric: key, value: v, captured_at: now });
    }
    // detekcia zmien (len METRICS)
    for (const m of METRICS) {
      const cur = curValue(s.id, m.key);
      const before = prev.get(`${s.id}|${m.key}`);
      if (cur === null || before === undefined || before === null) continue;
      const diff = cur - before;
      if (Math.abs(diff) < m.th) continue;
      const improved = m.dir === 'up_good' ? diff > 0 : diff < 0;
      const message = `${m.label}: ${Math.round(before)} → ${Math.round(cur)}`;
      const severity = improved ? 'info' : 'warning';
      changeRows.push({
        site_id: s.id,
        org_id: s.org_id,
        kind: 'score',
        severity,
        message,
        payload: { metric: m.key, from: Math.round(before), to: Math.round(cur), direction: improved ? 'up' : 'down' },
        created_at: now,
      });

      // Proaktívny alert len pri ZHORŠENÍ (nie pri zlepšení). Dedupe: 1 per
      // web+metrika+ISO týždeň.
      if (!improved) {
        const dom = nameById.get(s.id) ?? 'web';
        alertRows.push({
          org_id: s.org_id,
          site_id: s.id,
          type: 'metric_drop',
          severity: 'warning',
          title: `${dom}: ${m.label} kleslo`,
          body: message,
          dedupe_key: `proactive:${s.id}:${m.key}:${wk}`,
        });
      }
    }
  }

  // zápis
  if (historyRows.length) {
    const r = await fetch(`${url}/rest/v1/metric_history`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(historyRows) });
    if (!r.ok) throw new Error(`history insert ${r.status}: ${await r.text()}`);
  }
  if (changeRows.length) {
    const r = await fetch(`${url}/rest/v1/change_log`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(changeRows) });
    // Log-and-continue (nie throw) — rovnako ako u ostatných collectorov
    // (wpIngest.ts, wp-cve, seo-crawl), diff/log zápis nesmie zablokovať
    // zvyšok run() (alertRows nižšie ani návrat { ok, failed } pre runJob) —
    // inak by zlyhanie change_log insertu spôsobilo, že proaktívne degradačné
    // e-maily sa nikdy nezapíšu a job bude vyzerať ako nikdy nespustený.
    if (!r.ok) console.log(JSON.stringify({ ev: 'history.changelog_fail', status: r.status, body: await r.text() }));
  }
  // Proaktívne alerty — ignoruj konflikt (dedupe_key unique), pošle ich runAlerts.
  if (alertRows.length) {
    const r = await fetch(`${url}/rest/v1/alerts`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(alertRows) });
    if (!r.ok) console.log(JSON.stringify({ ev: 'history.alerts_fail', status: r.status, body: await r.text() }));
  }
  console.log(JSON.stringify({ ev: 'history.done', sites: sites.length, history: historyRows.length, changes: changeRows.length, alerts: alertRows.length }));
  return { ok: sites.length, failed: 0 };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
