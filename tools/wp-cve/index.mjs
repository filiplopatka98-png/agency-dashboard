#!/usr/bin/env node
// WP CVE collector — vezme pluginy/verzie z wp_snapshots (poslal ich WP agent),
// porovná so známymi zraniteľnosťami z WPScanu a zapíše `vulns` späť do wp_snapshots.
// Zdroj pluginov je DB (nič nesťahuje z webov).
//
//   node index.mjs           → prejde wp_snapshots s pluginmi, zapíše vulns
//
// Dve fázy:
//   1. Naplň cache (`wpscan_cache`, migrácia 0034) — max 25 WPScan lookupov/deň
//      (free tier), plánované cez `planLookups`.
//   2. Vyhodnoť každý web VÝHRADNE z cache — čistý lokálny výpočet, bez siete.
//
// Rozhodovacia logika (buildTargets/planLookups/siteComplete/projectVulns) žije v
// `packages/core/src/wpscanPlan.ts` a je pokrytá testami — tu ostáva len I/O.
//
// Prečo perzistentná cache: 6 webov = ~188 unikátnych cieľov, rozpočet 25/deň.
// Predtým bola cache `new Map()` vnútri run() — zomrela s procesom, takže každý
// beh sa pýtal odznova a kvôli „rate-limit → preskoč celý web" dostal dáta len
// prvý web. Nulový progres, donekonečna. Teraz platíme rozpočet len za to, čo
// ešte nemáme → pokrytie za ~8 dní, potom TTL refresh ~188/30 ≈ 6/deň.
// Pozor: celá táto aritmetika stojí na DENNOM behu workflow (wp-cve.yml).
//
// Závažnosť (CVSS): najprv WPScan vlastné `cvss.score`, inak NVD lookup podľa
// CVE id (nvd.nist.gov, zdarma). Ak ani jedno → severity 'unknown' (nefabrikujeme).
//
// Env: WPSCAN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (voliteľne) NVD_API_KEY
import { runJob } from '../_shared/runJob.mjs';
import { severityFromScore } from '../../packages/core/dist/cve.js';
import { diffVulns } from '../../packages/core/dist/events.js';
import {
  buildTargets,
  planLookups,
  siteComplete,
  projectVulns,
  targetKey,
  cacheRowKey,
} from '../../packages/core/dist/wpscanPlan.js';

const WPSCAN_BASE = 'https://wpscan.com/api/v3';
const UA = 'MonitorixCVE/1.0 (+https://dash.lopatka.sk)';
const DAILY_BUDGET = 25; // WPScan free tier
const TTL_DAYS = 30; // po 30 dňoch sa slug preberie znova (kvôli novo zverejneným CVE)
const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// NVD lookup CVSS base score podľa CVE id. Bez kľúča limit 5 req/30s → 6.5s pauza.
// Preferuje v3.1 → v3.0 → v2. Vráti number|null (null = NVD skóre nemá).
async function nvdScore(cveId, apiKey) {
  const headers = { 'User-Agent': UA, ...(apiKey ? { apiKey } : {}) };
  const res = await fetch(`${NVD_BASE}?cveId=${encodeURIComponent(cveId)}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const body = await res.json();
  const metrics = body.vulnerabilities?.[0]?.cve?.metrics ?? {};
  const m = metrics.cvssMetricV31?.[0] ?? metrics.cvssMetricV30?.[0] ?? metrics.cvssMetricV2?.[0];
  const score = m?.cvssData?.baseScore;
  return typeof score === 'number' ? score : null;
}

// Doplní každému vuln `cvss` (number|null) + `severity`. WPScan skóre má prednosť,
// inak NVD podľa CVE (dedup + rate-limit). Mutuje pole vulns.
//
// Volá sa PRI FETCHI (fáza 1), nie pri vyhodnocovaní webu (fáza 2). Keď cache
// funguje, každý web sa vyrieši každý deň — obohacovanie pri čítaní by bolo
// mnohominútové denné zdržanie (6.5 s pauza na CVE bez API kľúča) a mlátili by
// sme NVD kvôli skóre, ktoré už poznáme. Takto je počet NVD volaní ohraničený
// počtom novo stiahnutých slugov (≤25/deň) a fáza 2 je čistý lokálny výpočet.
//
// Akceptovaná cena: keď NVD práve zlyhá, severity ostane 'unknown' až do
// vypršania TTL (30 dní), lebo sa už neprepočítava. 'unknown' je čestné
// („skóre nepoznáme"), nie fabrikované → prijateľné.
async function enrichSeverity(vulns, nvdCache, apiKey) {
  for (const v of vulns) {
    let score = typeof v.cvss === 'number' ? v.cvss : null; // z WPScan
    if (score === null && v.cve) {
      if (nvdCache.has(v.cve)) {
        score = nvdCache.get(v.cve);
      } else {
        try {
          score = await nvdScore(v.cve, apiKey);
        } catch {
          score = null;
        }
        nvdCache.set(v.cve, score);
        await sleep(apiKey ? 700 : 6500); // rešpektuj NVD rate-limit
      }
    }
    v.cvss = score;
    v.severity = severityFromScore(score);
  }
}

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// Jeden WPScan lookup. Vráti { vulns } | { rateLimited: true } | { error: status }.
async function wpscanFetch(kind, cacheSlug, token) {
  const path = kind === 'plugin' ? `/plugins/${cacheSlug}` : `/wordpresses/${String(cacheSlug).replace(/\./g, '')}`;
  const res = await fetch(`${WPSCAN_BASE}${path}`, {
    headers: { Authorization: `Token token=${token}`, 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  // 404 = WPScan o tomto slugu nevie žiadne zraniteľnosti. Cachujeme aj tento
  // NEGATÍVNY výsledok — väčšina z 185 slugov vulns nemá, a keby sa negatíva
  // necachovali, prepálili by rozpočet každý deň nanovo a systém by nikdy
  // neskonvergoval (presne pôvodný bug, len inak).
  if (res.status === 404) return { vulns: [] };
  if (res.status === 429) return { rateLimited: true };
  if (!res.ok) return { error: res.status };
  const body = await res.json();
  const entry = body[Object.keys(body)[0]] ?? {};
  const vulns = (entry.vulnerabilities ?? []).map((v) => {
    // WPScan niekedy vracia cvss ako { score } alebo číslo/string; vezmi ak je platné.
    const raw = v.cvss?.score ?? v.cvss ?? null;
    const wpCvss = raw != null && !Number.isNaN(Number(raw)) ? Number(raw) : null;
    return {
      title: v.title,
      cve: v.references?.cve?.[0] ? `CVE-${v.references.cve[0]}` : null,
      fixed_in: v.fixed_in ?? null,
      cvss: wpCvss,
    };
  });
  return { vulns };
}

// FÁZA 1 — naplň cache v rámci denného rozpočtu. Vráti { fetched, planned, left }.
async function fillCache(sites, url, srv, token, nvdKey) {
  // Metadáta cache (bez `vulns` — netreba ich na plánovanie). Čítanie je
  // nestránkované a PostgREST má max_rows 1000: pri ~188 slugoch v pohode, ale
  // toto je strop, ktorý treba sledovať, ak by počet webov výrazne narástol.
  // Proti nekontrolovanému rastu drží tabuľku retenčný cron (migrácia 0034).
  const meta = await (await fetch(`${url}/rest/v1/wpscan_cache?select=kind,slug,fetched_at`, { headers: restHeaders(srv) })).json();
  const cache = (Array.isArray(meta) ? meta : []).map((r) => ({ kind: r.kind, slug: r.slug, fetchedAt: r.fetched_at }));

  const planned = planLookups(sites, cache, { budget: DAILY_BUDGET, now: new Date(), ttlDays: TTL_DAYS });

  const nvdCache = new Map(); // CVE id -> score|null (dedup NVD naprieč slugmi)
  let fetched = 0;
  let left = DAILY_BUDGET;

  for (const t of planned) {
    let r;
    try {
      r = await wpscanFetch(t.kind, t.cacheSlug, token);
    } catch (e) {
      console.log(JSON.stringify({ ev: 'cve.fetch_fail', target: targetKey(t), error: String(e?.message ?? e) }));
      continue; // necachuj — cieľ ostane chýbajúci a skúsi sa iný deň
    }
    left--;
    // Rate-limit → okamžite ukonči celú fázu; ďalšie requesty by aj tak boli 429.
    if (r.rateLimited) {
      console.log(JSON.stringify({ ev: 'cve.rate_limited', target: targetKey(t) }));
      left = 0;
      break;
    }
    // Iná non-2xx chyba: NEcachuj (na rozdiel od 404). Nevieme, či slug vulns má
    // alebo nemá — uložiť `[]` by bola fabrikácia „žiadne zraniteľnosti".
    if (r.error != null) {
      console.log(JSON.stringify({ ev: 'cve.api_error', target: targetKey(t), status: r.error }));
      continue;
    }
    await enrichSeverity(r.vulns, nvdCache, nvdKey);
    const up = await fetch(`${url}/rest/v1/wpscan_cache`, {
      method: 'POST',
      headers: { ...restHeaders(srv), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ kind: t.kind, slug: t.cacheSlug, vulns: r.vulns, fetched_at: new Date().toISOString() }),
    });
    if (!up.ok) {
      console.log(JSON.stringify({ ev: 'cve.cache_write_fail', target: targetKey(t), status: up.status }));
      continue;
    }
    fetched++;
  }
  return { fetched, planned: planned.length, left };
}

// Načíta cache aj s vulns → Map(kľúč → pole vulns).
// Riadok s nepoužiteľným `vulns` (nie pole) sa do mapy NEDOSTANE, takže platí za
// CHÝBAJÚCI, nie za prázdny: `[]` by znamenalo „tento cieľ nemá zraniteľnosti"
// a diff by reálne CVE ohlásil ako vyriešené. DB to stráži checkom
// `jsonb_typeof(vulns) = 'array'` — toto je druhá obrana (fail-closed).
async function loadCacheVulns(url, srv) {
  // Rovnaký max_rows 1000 strop ako pri metadátach vo fillCache.
  const rows = await (await fetch(`${url}/rest/v1/wpscan_cache?select=kind,slug,vulns`, { headers: restHeaders(srv) })).json();
  const byKey = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(r.vulns)) {
      console.log(JSON.stringify({ ev: 'cve.cache_bad_row', target: cacheRowKey(r) }));
      continue;
    }
    byKey.set(cacheRowKey(r), r.vulns);
  }
  return byKey;
}

async function main() {
  await runJob('cve', run);
}

async function run() {
  const token = process.env.WPSCAN_TOKEN;
  if (!token) throw new Error('WPSCAN_TOKEN je povinný');
  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');
  const nvdKey = process.env.NVD_API_KEY || null;

  const rows = await (await fetch(`${url}/rest/v1/wp_snapshots?select=site_id,org_id,wp_version,plugins,vulns&wp_version=not.is.null`, { headers: restHeaders(srv) })).json();

  const scannable = [];
  for (const wp of rows) {
    // Prázdny/chýbajúci zoznam pluginov je takmer vždy zlyhanie zberu (WP agent
    // get_plugins() nevidel mu-pluginy, request vynechal `plugins` atď.), nie fakt
    // "web nemá žiadne pluginy" — bežiaci WordPress bez jediného pluginu je v praxi
    // zanedbateľný prípad. Preskoč web bez zápisu — `vulns: []` by sa PATCHlo,
    // monthly-report by to prečítal ako knownVulns: 0 a klientovi by sme fabrikovali
    // "žiadne známe zraniteľnosti" o webe, ktorého pluginy sme vôbec neskenovali.
    if (!Array.isArray(wp.plugins) || wp.plugins.length === 0) {
      console.log(JSON.stringify({ ev: 'cve.skip_no_plugins', site_id: wp.site_id }));
      continue;
    }
    // Nescanovateľná položka (plugin bez slugu, rozbitá verzia jadra) → dáta webu
    // sa nedajú skompletizovať → preskoč CELÝ web (fail-closed, bez zápisu a diffu).
    const built = buildTargets(wp);
    if (!built.ok) {
      console.log(JSON.stringify({ ev: `cve.skip_${built.reason}`, site_id: wp.site_id, offending: built.offending }));
      continue;
    }
    scannable.push({ wp, siteId: wp.site_id, targets: built.targets });
  }

  // ── FÁZA 1: doplň cache (jediná časť, čo chodí na WPScan) ──
  const { fetched, planned, left } = await fillCache(scannable, url, srv, token, nvdKey);

  // ── FÁZA 2: vyhodnoť weby z cache ──
  // Načítaj cache AŽ TERAZ (po fáze 1), aby boli dnešné fetche zahrnuté.
  const byKey = await loadCacheVulns(url, srv);
  const presentKeys = new Set(byKey.keys());

  let ok = 0;
  let failed = 0;

  for (const { wp, targets } of scannable) {
    try {
      // Neúplný web = niektorý cieľ ešte NIE JE v cache. To dnes NIE je chyba, ale
      // normálny prechodný stav počas ~8-dňového napĺňania cache (25 lookupov/deň
      // na ~188 cieľov). Nezapisuj ani nediffuj — inak by sme ohlásili „vyriešené"
      // pre zraniteľnosť, ktorá tam v skutočnosti stále je, a zmazali by sme ju
      // z DB (diff by ju videl ako chýbajúcu → fabrikovaná dobrá správa).
      // Pozn.: stale (>TTL) záznam sa za prítomný RÁTA — viď komentár pri
      // siteComplete v core: sú to reálne dáta a nemôžu vyrobiť falošné „fixed".
      if (!siteComplete(targets, presentKeys)) {
        const missing = targets.filter((t) => !presentKeys.has(targetKey(t))).length;
        console.log(JSON.stringify({ ev: 'cve.skip_incomplete', site_id: wp.site_id, missing }));
        continue;
      }
      const vulns = projectVulns(targets, byKey);
      // Diff proti uloženému zoznamu (prvý beh: vulns === null → žiadne udalosti).
      // Vlastný try/catch: hypotetický throw v diffe nesmie zablokovať PATCH
      // (izolácia zápisu snapshotu od diff/eventov, konzistentné s wpIngest.ts).
      let events = [];
      try {
        events = diffVulns(wp.vulns ?? null, vulns);
      } catch (e) {
        console.log(JSON.stringify({ ev: 'cve.diff_fail', site_id: wp.site_id, error: String(e?.message ?? e) }));
      }
      const up = await fetch(`${url}/rest/v1/wp_snapshots?site_id=eq.${wp.site_id}`, {
        method: 'PATCH',
        headers: { ...restHeaders(srv), Prefer: 'return=minimal' },
        body: JSON.stringify({ vulns }),
      });
      if (!up.ok) throw new Error(`patch ${up.status}: ${await up.text()}`);
      if (events.length) {
        const log = await fetch(`${url}/rest/v1/change_log`, {
          method: 'POST',
          headers: { ...restHeaders(srv), Prefer: 'return=minimal' },
          body: JSON.stringify(events.map((e) => ({
            site_id: wp.site_id, org_id: wp.org_id, kind: e.kind, severity: e.severity, message: e.message, payload: e.payload,
          }))),
        });
        if (!log.ok) console.log(JSON.stringify({ ev: 'cve.changelog_fail', site_id: wp.site_id, status: log.status }));
      }
      ok++;
      console.log(JSON.stringify({ ev: 'cve.ok', site_id: wp.site_id, vulns: vulns.length, events: events.length }));
    } catch (e) {
      failed++;
      console.log(JSON.stringify({ ev: 'cve.fail', site_id: wp.site_id, error: String(e?.message ?? e) }));
    }
  }
  console.log(JSON.stringify({ ev: 'cve.done', ok, failed, wpscan_left: left, cached: fetched, planned }));
  return { ok, failed };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
