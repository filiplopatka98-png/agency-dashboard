#!/usr/bin/env node
// SEO crawler — BFS z homepage (max N URL, 1 req/s), rozbor cez core.analyzePage,
// kontrola broken links, agregácia core.buildSeoIssues → seo_snapshots. Bez kľúčov.
//
//   node index.mjs --crawl <domena>   → vypíše výsledok (test, bez DB)
//   node index.mjs                     → prejde aktívne weby zo Supabase
//
// Env (DB režim): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { analyzePage, buildSeoIssues } from '../../packages/core/dist/seo.js';
import { diffSeoIssues } from '../../packages/core/dist/events.js';

const UA = 'AgencyDashboard/1.0 (+https://dash.lopatka.sk)';
const TIMEOUT = 12_000;
const MAX_PAGES = 20;
const MAX_LINK_CHECKS = 40;
const DELAY_MS = 400; // ~2 req/s, šetrný k webu

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, method = 'GET') {
  try {
    return await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': UA } });
  } catch {
    return null;
  }
}

export async function crawlSite(domain) {
  const origin = `https://${domain}`;
  const robotsRes = await get(`${origin}/robots.txt`);
  const robotsOk = Boolean(robotsRes && robotsRes.ok);

  // Sitemapu ber primárne z robots.txt (`Sitemap:` direktíva) — weby ju často
  // majú na /sitemap_index.xml alebo /sitemap-index.xml, nie /sitemap.xml.
  // Fallback: /sitemap.xml. Niektoré servery nepodporujú HEAD → skús aj GET.
  let robotsText = '';
  if (robotsRes && robotsRes.ok) {
    try {
      robotsText = await robotsRes.text();
    } catch {
      /* ignore */
    }
  }
  const declared = (robotsText.match(/^\s*sitemap:\s*(\S+)/im) || [])[1];
  const sitemapUrl = declared || `${origin}/sitemap.xml`;
  let sitemapRes = await get(sitemapUrl, 'HEAD');
  if (!sitemapRes || !sitemapRes.ok) sitemapRes = await get(sitemapUrl, 'GET');
  const sitemapOk = Boolean(sitemapRes && sitemapRes.ok);

  const visited = new Set();
  const status = new Map();
  const queue = [origin + '/'];
  const pages = [];
  // Počet stránok, ktoré sa nepodarilo úspešne načítať — sieťová chyba/timeout
  // (`get()` vrátil null) ALEBO HTTP chybový stav (5xx/429/403…, `res.ok` je
  // false). Obe sa potichu vynechajú z `pages` a teda aj z buildSeoIssues.
  // (2xx odpoveď, ktorá jednoducho nie je HTML, sa NEPOČÍTA — to je legitímny
  // výsledok „nie je to crawlovateľná stránka", nie zlyhanie.) Ak je > 0, tento
  // beh je NEÚPLNY a hore (main) sa podľa toho nesmie diffovať (viď komentár tam).
  let failedPages = 0;

  while (queue.length && pages.length < MAX_PAGES) {
    const url = queue.shift();
    const norm = url.replace(/\/$/, '') || url;
    if (visited.has(norm)) continue;
    visited.add(norm);
    const res = await get(url);
    // Počítaj ako zlyhanie aj HTTP chybové stavy (5xx/429/403…) — `fetch()`
    // pri nich nevyhodí výnimku, takže `!res` samotné by ich nezachytilo a
    // stránka by potichu vypadla z `pages` bez inkrementácie `failedPages`.
    if (!res || !res.ok) failedPages++;
    status.set(url, res ? res.status : 0);
    if (res && res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
      const html = (await res.text()).slice(0, 800_000);
      const page = analyzePage(html, url);
      pages.push(page);
      for (const link of page.internalLinks) {
        const ln = link.replace(/\/$/, '') || link;
        if (!visited.has(ln) && queue.length + pages.length < MAX_PAGES * 3) queue.push(link);
      }
    }
    await sleep(DELAY_MS);
  }

  // broken links: skontroluj vzorku interných odkazov, ktoré sme ešte nevideli
  const allLinks = [...new Set(pages.flatMap((p) => p.internalLinks))];
  const toCheck = allLinks.filter((l) => !status.has(l)).slice(0, MAX_LINK_CHECKS);
  const broken = [];
  for (const l of toCheck) {
    let res = await get(l, 'HEAD');
    if (!res || res.status === 405) res = await get(l, 'GET');
    const st = res ? res.status : 0;
    if (st >= 400 || st === 0) broken.push({ url: l, status: st });
    await sleep(DELAY_MS);
  }
  // aj z už navštívených, ktoré zlyhali
  for (const [url, st] of status) if (st >= 400) broken.push({ url, status: st });

  const issues = buildSeoIssues(pages, broken);
  const canonicalOk = pages.length > 0 && pages.every((p) => p.hasCanonical);
  // `failed_pages` je len signál pre volajúceho (main) — NESMIE sa dostať do
  // seo_snapshots (viď row v main(), kde sa spreadá cielene bez tohto poľa).
  return { pages_crawled: pages.length, sitemap_ok: sitemapOk, robots_ok: robotsOk, canonical_ok: canonicalOk, issues, failed_pages: failedPages };
}

import { runJob } from '../_shared/runJob.mjs';

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--crawl') {
    // Manuálny test jednej domény — nie je to scheduled beh, nezapisuje sa do job_runs.
    const domain = args[1];
    if (!domain) throw new Error('usage: --crawl <domena>');
    const r = await crawlSite(domain);
    console.log(JSON.stringify({ ...r, issues: r.issues.map((i) => `${i.severity} · ${i.type} (${i.count})`) }, null, 2));
    return;
  }
  await runJob('seo', run);
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,domain&is_active=eq.true`, { headers: restHeaders(key) });
  const sites = await sitesRes.json();
  const now = new Date().toISOString();
  let ok = 0;
  let failed = 0;

  for (const s of sites) {
    // Starý zoznam issues PRED prepísaním (prvý beh → prevIssues null → žiadne udalosti).
    // Fail-safe: ak toto čítanie zlyhá (výpadok Supabase/DNS), `prevIssues`
    // zostane `null` — bez baseline sa diff nespustí (prázdne `events`), takže
    // sa klientovi nikdy nedostane fabrikovaná „opravené" správa. Zlyhanie
    // tohto jedného webu tiež nesmie zhodiť celý beh pre ostatné weby.
    let prevIssues = null;
    try {
      const prevRes = await fetch(`${url}/rest/v1/seo_snapshots?select=issues&site_id=eq.${s.id}`, { headers: restHeaders(key) });
      const prevRows = prevRes.ok ? await prevRes.json() : [];
      prevIssues = prevRows[0]?.issues ?? null;
    } catch (e) {
      console.log(JSON.stringify({ ev: 'seo.prev_read_fail', domain: s.domain, message: String(e?.message ?? e) }));
    }

    let row;
    let events = [];
    try {
      const r = await crawlSite(s.domain);
      if (r.pages_crawled === 0) throw new Error('žiadna stránka sa nenačítala');
      // `failed_pages` je len interný signál (partial crawl) — vyber ho zo `r`
      // predtým, než ho spreadneme do `row`, nech sa nedostane do seo_snapshots.
      const { failed_pages, ...snapshot } = r;
      row = { site_id: s.id, org_id: s.org_id, ...snapshot, measured_at: now, error: null };
      const partial = failed_pages > 0;
      if (partial) {
        // Neúplný beh: niektoré stránky sa nenačítali (timeout/sieťová chyba),
        // takže `issues` môže chýbať problém, ktorý v skutočnosti stále existuje
        // na nenačítanej stránke. Diff by to nesprávne ohlásil ako „opravené" —
        // fabrikovaná dobrá správa pre klienta. Preto pri partial crawle diff
        // PRESKOČÍME (events zostáva []), ale snapshot ULOŽÍME — je to naša
        // aktuálne najlepšia znalosť a dashboard ju zobrazuje s `measured_at`.
        // Opačný smer je bezpečný: ak neskorší KOMPLETNÝ crawl uvidí issue typ,
        // ktorý predtým partial beh nezachytil, zaloguje sa ako „new" — a „new"
        // SEO udalosti sú admin-only (isClientVisible v reportText.ts vracia
        // false pre kind:'seo' + direction:'new'), takže sa k žiadnemu klientovi
        // nedostane fabrikovaný záver.
        console.log(JSON.stringify({ ev: 'seo.skip_partial', domain: s.domain, failed_pages }));
      } else {
        events = diffSeoIssues(prevIssues, (r.issues ?? []).map((i) => ({ type: i.type, count: i.count })));
      }
      ok++;
      console.log(JSON.stringify({ ev: 'seo.ok', domain: s.domain, pages: r.pages_crawled, issues: r.issues.length, failed_pages }));
    } catch (e) {
      row = { site_id: s.id, org_id: s.org_id, pages_crawled: 0, measured_at: now, error: String(e?.message ?? e) };
      failed++;
      console.log(JSON.stringify({ ev: 'seo.fail', domain: s.domain, error: String(e?.message ?? e) }));
    }
    const up = await fetch(`${url}/rest/v1/seo_snapshots?on_conflict=site_id`, { method: 'POST', headers: { ...restHeaders(key), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
    if (!up.ok) console.log(JSON.stringify({ ev: 'seo.upsert_fail', domain: s.domain, status: up.status, body: await up.text() }));

    // Best-effort — zlyhanie zápisu udalostí nesmie zhodiť crawl.
    if (events.length) {
      const log = await fetch(`${url}/rest/v1/change_log`, {
        method: 'POST',
        headers: { ...restHeaders(key), Prefer: 'return=minimal' },
        body: JSON.stringify(events.map((e) => ({
          site_id: s.id, org_id: s.org_id, kind: e.kind, severity: e.severity, message: e.message, payload: e.payload,
        }))),
      });
      if (!log.ok) console.log(JSON.stringify({ ev: 'seo.changelog_fail', domain: s.domain, status: log.status }));
    }
  }
  console.log(JSON.stringify({ ev: 'seo.done', ok, failed, total: sites.length }));
  return { ok, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
