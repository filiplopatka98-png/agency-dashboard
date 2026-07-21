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
const MAX_PAGES = 25; // pokryje malé/stredné weby celé; veľké sa capnú (min. „základných 10")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Vytiahne <loc> URL zo (sub)sitemapy.
async function fetchLocs(url) {
  const res = await tryFetch(url);
  if (!res || !res.ok) return [];
  const xml = (await res.text()).slice(0, 500_000);
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

// Objaví do MAX_PAGES stránok: homepage + zo sitemapy (aj sitemap-index), fallback interné odkazy.
async function discoverPages(origin, robotsTxt, homepageHtml) {
  const pages = [origin + '/'];
  const add = (u) => {
    try {
      const url = new URL(u, origin);
      if (url.origin === origin) {
        const norm = url.href.replace(/#.*$/, '');
        if (!pages.includes(norm) && pages.length < MAX_PAGES) pages.push(norm);
      }
    } catch {
      /* ignoruj nevalidnú URL */
    }
  };

  const declared = (robotsTxt.match(/^\s*sitemap:\s*(\S+)/im) || [])[1] || `${origin}/sitemap.xml`;
  let locs = await fetchLocs(declared);
  // sitemap-index (všetky loc sú .xml) → rozbaľ prvé pár sub-sitemap
  if (locs.length && locs.every((l) => /\.xml($|\?)/i.test(l))) {
    const sub = [];
    for (const sm of locs.slice(0, 3)) {
      sub.push(...(await fetchLocs(sm)));
      if (sub.length >= MAX_PAGES * 3) break;
    }
    locs = sub;
  }
  for (const l of locs) add(l);

  // fallback: interné odkazy z homepage
  if (pages.length < MAX_PAGES) {
    for (const m of homepageHtml.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) add(m[1]);
  }
  return pages.slice(0, MAX_PAGES);
}

export async function probeAeo(domain) {
  const origin = `https://${domain}`;
  const res = await tryFetch(origin);
  // 503 = web v úmyselnej údržbe (pred-launch maintenance stránka). Obsah sa
  // nedá hodnotiť, ale NIE je to chyba zberu — označ to rozlíšiteľne, nech to
  // `run()` preskočí bez `failed++` (inak by seo/aeo hlásili job_failed každý
  // deň, kým je web v údržbe). Reálny výpadok rieši uptime/site_down zvlášť.
  if (res && res.status === 503) {
    const e = new Error(`${domain}: údržba (503)`);
    e.maintenance = true;
    throw e;
  }
  if (!res || !res.ok) throw new Error(`fetch ${domain}: ${res ? res.status : 'network'}`);
  const homepageHtml = (await res.text()).slice(0, 500_000);

  // robots.txt: rozlíš SIEŤOVÉ zlyhanie (null = timeout/DNS, prechodné) od HTTP
  // odpovede. Pri sieťovom zlyhaní NEHODNOŤ — prázdny robotsTxt by dal všetkým
  // botom „neuvedené" a strhol −10 bodov ULOŽENÝCH ako čerstvý fakt. Radšej to
  // hoď ako zlyhanie zberu (score:null, failed++ → job_failed alert), nech
  // sa nefabrikuje. 404/403 (HTTP odpoveď) = legitímne „bez robots.txt" → skóruj.
  const robotsRes = await tryFetch(`${origin}/robots.txt`);
  if (!robotsRes) throw new Error(`${domain}: robots.txt nedostupný (sieťová chyba) — AEO skóre nezapisujem`);
  const robotsTxt = robotsRes.ok ? await robotsRes.text() : '';
  const llmsRes = await tryFetch(`${origin}/llms.txt`);
  const hasLlmsTxt = Boolean(llmsRes && llmsRes.ok);

  const urls = await discoverPages(origin, robotsTxt, homepageHtml);
  const htmls = [homepageHtml];
  for (const u of urls.slice(1)) {
    const r = await tryFetch(u);
    if (r && r.ok && (r.headers.get('content-type') || '').includes('text/html')) {
      htmls.push((await r.text()).slice(0, 500_000));
    }
    await sleep(300);
  }
  return { ...scoreAeo({ html: htmls, robotsTxt, hasLlmsTxt }), pagesChecked: htmls.length };
}

import { runJob } from '../_shared/runJob.mjs';

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--probe') {
    // Manuálny test jednej domény — nie je to scheduled beh, nezapisuje sa do job_runs.
    const domain = args[1];
    if (!domain) throw new Error('usage: --probe <domena>');
    const r = await probeAeo(domain);
    console.log(JSON.stringify({ score: r.score, aiBots: r.aiBots, schemaTypes: r.schemaTypes, checks: r.checks.map((c) => `${c.pass ? '✓' : '✗'} ${c.label} (${c.earned}/${c.weight})`) }, null, 2));
    return;
  }

  await runJob('aeo', run);
}

async function run() {
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
      console.log(JSON.stringify({ ev: 'aeo.ok', domain: s.domain, score: r.score, pages: r.pagesChecked }));
    } catch (e) {
      // Web v úmyselnej údržbe (503) — preskoč: žiadny zápis (nechaj starý
      // riadok zostarnúť), NErátaj ako failed, nech job ostane 'ok'.
      if (e?.maintenance) {
        console.log(JSON.stringify({ ev: 'aeo.skip_maintenance', domain: s.domain }));
        continue;
      }
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
  return { ok, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
