#!/usr/bin/env node
// Detekcia rozbitého CSS: na homepage + ~4 hlavných menu stránkach každého webu
// vytiahne <link rel="stylesheet"> a overí, či CSS súbory reálne existujú (200).
// 404/chyba na referencovanom CSS = rozbité (typicky Elementor prečísluje/zmaže
// vygenerovaný CSS a zacachovaná HTML naň stále odkazuje). Alert css_broken.
//
// Zero-fabrication: rozbité = LEN definitívny non-200 (404/5xx) alebo 0-bajtový
// 200; NAŠA sieťová chyba/timeout sa NEhlási (1 retry, potom preskoč). Web dole
// rieši uptime, nie tento job. 503 (údržba) sa preskočí.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { runJob } from '../_shared/runJob.mjs';
import { raiseAlerts } from '../_shared/raiseAlert.mjs';
import { extractStylesheets, extractMenuLinks, classifyAsset } from '../../packages/core/dist/assetCheck.js';

const UA = 'Mozilla/5.0 (Monitorix asset-check; +https://dash.lopatka.sk)';
const PAGE_TIMEOUT = 20_000;
const ASSET_TIMEOUT = 15_000;
const MAX_MENU = 4; // homepage + 4 = 5 stránok
const MAX_BROKEN_IN_BODY = 8; // koľko rozbitých vypísať do e-mailu

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// Vráti { status, bytes, text } | { status: null } pri sieťovej chybe/timeoute.
async function fetchText(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(PAGE_TIMEOUT), headers: { 'User-Agent': UA } });
    const text = await res.text();
    return { status: res.status, bytes: text.length, text };
  } catch {
    return { status: null, bytes: null, text: '' };
  }
}

// Stav CSS súboru: HEAD; ak HEAD nepodporený (405/501) → GET. `bytes` z
// Content-Length (HEAD) alebo z tela (GET); null ak sa nedá zistiť.
async function checkAsset(url) {
  const doReq = async (method) => {
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(ASSET_TIMEOUT), headers: { 'User-Agent': UA } });
      let bytes = null;
      const cl = res.headers.get('content-length');
      if (cl !== null && !Number.isNaN(Number(cl))) bytes = Number(cl);
      if (method === 'GET') bytes = (await res.text()).length;
      return { status: res.status, bytes };
    } catch {
      return { status: null, bytes: null };
    }
  };
  let r = await doReq('HEAD');
  if (r.status === 405 || r.status === 501) r = await doReq('GET');
  return r;
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,domain&is_active=eq.true`, { headers: restHeaders(key) });
  if (!sitesRes.ok) throw new Error(`load sites ${sitesRes.status}`);
  const sites = await sitesRes.json();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const alertRows = [];
  let ok = 0;
  let failed = 0;

  for (const s of sites) {
    try {
      const origin = `https://${s.domain}`;
      const home = await fetchText(origin + '/');
      // 503 = úmyselná údržba → preskoč (konzistentne s aeo/seo). Web dole
      // (status null / iný non-2xx na HOMEPAGE) rieši uptime, nie tento job.
      if (home.status === 503) {
        console.log(JSON.stringify({ ev: 'asset.skip_maintenance', domain: s.domain }));
        continue;
      }
      if (home.status === null || home.status >= 400) {
        console.log(JSON.stringify({ ev: 'asset.skip_home_unreachable', domain: s.domain, status: home.status }));
        continue;
      }

      // 5 stránok: homepage + menu. Zbieraj CSS → množina stránok, čo naň odkazujú.
      const menu = extractMenuLinks(home.text, origin, MAX_MENU);
      const pages = [origin + '/', ...menu];
      const cssToPages = new Map(); // css url -> Set(page)
      const addCss = (pageUrl, html) => {
        for (const css of extractStylesheets(html, pageUrl)) {
          if (!cssToPages.has(css)) cssToPages.set(css, new Set());
          cssToPages.get(css).add(pageUrl);
        }
      };
      addCss(origin + '/', home.text);
      for (const p of menu) {
        const pr = await fetchText(p);
        if (pr.status !== null && pr.status < 400) addCss(p, pr.text);
        await sleep(200);
      }

      // Over každý unikátny CSS (+1 retry na `unknown` — naša chyba, nie fakt).
      const broken = [];
      for (const [css, pageSet] of cssToPages) {
        let res = await checkAsset(css);
        let verdict = classifyAsset(res);
        if (verdict === 'unknown') {
          // `unknown` = naša sieťová chyba/timeout, nie fakt o webe → 1 retry.
          await sleep(1_000);
          res = await checkAsset(css);
          verdict = classifyAsset(res);
        }
        if (verdict === 'broken') broken.push({ css, status: res.status, page: [...pageSet][0] });
      }

      ok++;
      console.log(JSON.stringify({ ev: 'asset.ok', domain: s.domain, pages: pages.length, css: cssToPages.size, broken: broken.length }));

      if (broken.length) {
        const lines = broken.slice(0, MAX_BROKEN_IN_BODY).map((b) => `• ${b.css} → ${b.status ?? 'chyba'} (na ${b.page})`);
        const more = broken.length > MAX_BROKEN_IN_BODY ? `\n…a ďalších ${broken.length - MAX_BROKEN_IN_BODY}.` : '';
        alertRows.push({
          org_id: s.org_id,
          site_id: s.id,
          type: 'css_broken',
          severity: 'warning',
          title: `${s.domain}: rozbité CSS`,
          body: `${broken.length} CSS súborov nevrátilo platnú odpoveď (typicky zacachovaná stránka odkazuje na zmazaný CSS — pomôže premazanie cache):\n${lines.join('\n')}${more}`,
          dedupe_key: `css_broken:${s.id}:${day}`,
        });
      }
    } catch (e) {
      failed++;
      console.log(JSON.stringify({ ev: 'asset.fail', domain: s.domain, error: String(e?.message ?? e) }));
    }
  }

  await raiseAlerts(url, key, alertRows, 'asset.raise_fail');
  console.log(JSON.stringify({ ev: 'asset.done', ok, failed, alerts: alertRows.length }));
  return { ok, failed };
}

async function main() {
  await runJob('asset-check', run);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
