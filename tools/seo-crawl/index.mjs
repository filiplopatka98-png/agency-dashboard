#!/usr/bin/env node
// SEO crawler — BFS z homepage (max N URL, 1 req/s), rozbor cez core.analyzePage,
// kontrola broken links, agregácia core.buildSeoIssues → seo_snapshots. Bez kľúčov.
//
//   node index.mjs --crawl <domena>   → vypíše výsledok (test, bez DB)
//   node index.mjs                     → prejde aktívne weby zo Supabase
//
// Env (DB režim): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { analyzePage, buildSeoIssues } from '../../packages/core/dist/seo.js';

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
  const sitemapRes = await get(`${origin}/sitemap.xml`, 'HEAD');
  const sitemapOk = Boolean(sitemapRes && sitemapRes.ok);

  const visited = new Set();
  const status = new Map();
  const queue = [origin + '/'];
  const pages = [];

  while (queue.length && pages.length < MAX_PAGES) {
    const url = queue.shift();
    const norm = url.replace(/\/$/, '') || url;
    if (visited.has(norm)) continue;
    visited.add(norm);
    const res = await get(url);
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
  return { pages_crawled: pages.length, sitemap_ok: sitemapOk, robots_ok: robotsOk, canonical_ok: canonicalOk, issues };
}

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--crawl') {
    const domain = args[1];
    if (!domain) throw new Error('usage: --crawl <domena>');
    const r = await crawlSite(domain);
    console.log(JSON.stringify({ ...r, issues: r.issues.map((i) => `${i.severity} · ${i.type} (${i.count})`) }, null, 2));
    return;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,domain&is_active=eq.true`, { headers: restHeaders(key) });
  const sites = await sitesRes.json();
  const now = new Date().toISOString();
  let ok = 0;
  let failed = 0;

  for (const s of sites) {
    let row;
    try {
      const r = await crawlSite(s.domain);
      if (r.pages_crawled === 0) throw new Error('žiadna stránka sa nenačítala');
      row = { site_id: s.id, org_id: s.org_id, ...r, measured_at: now, error: null };
      ok++;
      console.log(JSON.stringify({ ev: 'seo.ok', domain: s.domain, pages: r.pages_crawled, issues: r.issues.length }));
    } catch (e) {
      row = { site_id: s.id, org_id: s.org_id, pages_crawled: 0, measured_at: now, error: String(e?.message ?? e) };
      failed++;
      console.log(JSON.stringify({ ev: 'seo.fail', domain: s.domain, error: String(e?.message ?? e) }));
    }
    const up = await fetch(`${url}/rest/v1/seo_snapshots?on_conflict=site_id`, { method: 'POST', headers: { ...restHeaders(key), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
    if (!up.ok) console.log(JSON.stringify({ ev: 'seo.upsert_fail', domain: s.domain, status: up.status, body: await up.text() }));
  }
  console.log(JSON.stringify({ ev: 'seo.done', ok, failed, total: sites.length }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
