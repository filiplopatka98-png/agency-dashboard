// Čistá výpočtová logika z `data.ts` — vytiahnutá do samostatného súboru bez
// akejkoľvek závislosti na `./supabase` (ten pri importe vytvára Supabase
// klienta z `process.env.NEXT_PUBLIC_SUPABASE_*`, čo v testoch nechceme
// riešiť). Tu je len matematika nad dodanými dátami — priamo testovateľná.
import { freshnessFor } from '@agency/core';
import { segColor } from './design';

export type FreshKey = 'aeo' | 'security' | 'seo' | 'perf' | 'gsc' | 'infra' | 'wp';

/**
 * Čerstvosť dát per metrika — delegované na `@agency/core` (`freshnessFor` +
 * `MAX_AGE_HOURS`), jediný zdroj prahov. Predtým tu bola duplicitná kópia
 * tabuľky prahov (riziko rozídenia); teraz jeden zdroj pravdy a existujúce
 * core testy (`freshness.test.ts`) pokrývajú stale/fresh hranice. `now`
 * injektovateľné kvôli testom.
 */
export function freshState(
  key: FreshKey,
  measuredAt: string | null | undefined,
  now: number = Date.now(),
): { measuredAt: string | null; stale: boolean } {
  const f = freshnessFor(key, measuredAt, now);
  return { measuredAt: f.missing ? null : (measuredAt ?? null), stale: f.stale };
}

/** Deň (YYYY-MM-DD) `offsetDays` dní pred dneškom — `0` = dnes. */
export function isoDay(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
}

export interface UptimeSeg {
  color: string;
  date: string;
  value: number | null;
}

export interface UptimeDailyRow {
  site_id: string;
  day: string;
  uptime_pct: number;
  checks: number;
  up: number;
  p95_ms: number | null;
}

export const UPTIME_PAGE_SIZE = 1000; // PostgREST max_rows — potvrdené na živom projekte.
// Poistka proti nekonečnej slučke, keby stránkovanie z nejakého dôvodu nikdy
// nevrátilo kratšiu stranu (napr. zlá odpoveď). 200 strán = 200k riadkov, ďaleko
// nad current 8 weby × 90 dní (720 riadkov). Radšej nahlas zlyhať, než ticho
// vydávať čiastočné dáta za kompletné.
export const UPTIME_MAX_PAGES = 200;

export interface PagedResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Generický stránkovací fetch cez PostgREST `.range()`. Vytiahnuté z pôvodného
 * `fetchUptimeDaily` (audit 4.1 — `uptime_daily` za 90 dní bez `.order()`/
 * `.range()` narazí na PostgREST `max_rows = 1000` a ticho vráti len prvých
 * 1000 riadkov) tak, aby bolo znovupoužiteľné pre hocijaký ďalší dopyt v
 * `data.ts` s rovnakým rizikom (tichý orez pri raste nad PostgREST stránku) —
 * napr. `incidents`/`alerts`, ktoré mali plochý top-N `.limit()` naprieč
 * všetkými webmi (audit "flat top-N cap").
 *
 * Volajúci MUSÍ dodať deterministické `.order()` (s tie-breakerom, napr.
 * `id`), inak stránkovanie môže riadky preskočiť alebo zduplikovať. Krátke
 * čítanie (menej riadkov než `pageSize`) = koniec dát; inak sa nikdy nesmie
 * potichu prijať čiastočný výsledok ako kompletný (fabrikačné pravidlo).
 */
export async function fetchAllPaged<T>(
  label: string,
  // `PromiseLike`, nie `Promise` — PostgREST query buildery sú "thenable", ale
  // nemajú `.catch()`/`.finally()` (nie sú skutočný `Promise`); `await` na
  // thenable funguje rovnako.
  fetchPage: (from: number, to: number) => PromiseLike<PagedResult<T>>,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? UPTIME_PAGE_SIZE;
  const maxPages = opts.maxPages ?? UPTIME_MAX_PAGES;
  const out: T[] = [];
  let from = 0;
  for (let page = 0; page < maxPages; page++) {
    const to = from + pageSize - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(`${label} (strana ${page}, from=${from}): ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out; // krátke čítanie → koniec dát
    from += pageSize;
  }
  // Nikdy nezahodiť chybu ticho — inak by neúplné dáta vyzerali kompletne.
  throw new Error(
    `${label}: stránkovanie neskončilo po ${maxPages} stranách (${maxPages * pageSize} riadkov) — pravdepodobne chyba, nie legitímny objem dát.`,
  );
}

/** Deň-indexované mapy z `uptime_daily` riadkov — vstup pre `aggUptime`/`buildUptimeSegs`/`buildUptimeP95Series`. */
export function buildDailyMaps(rows: UptimeDailyRow[]): {
  dailyBySite: Map<string, Map<string, number>>;
  dailyCountsBySite: Map<string, Map<string, { checks: number; up: number }>>;
  p95BySite: Map<string, Map<string, number>>;
} {
  const dailyBySite = new Map<string, Map<string, number>>();
  const dailyCountsBySite = new Map<string, Map<string, { checks: number; up: number }>>();
  const p95BySite = new Map<string, Map<string, number>>();
  for (const d of rows) {
    const day = d.day;
    const m = dailyBySite.get(d.site_id) ?? new Map<string, number>();
    m.set(day, Number(d.uptime_pct));
    dailyBySite.set(d.site_id, m);
    const c = dailyCountsBySite.get(d.site_id) ?? new Map<string, { checks: number; up: number }>();
    c.set(day, { checks: Number(d.checks), up: Number(d.up) });
    dailyCountsBySite.set(d.site_id, c);
    if (d.p95_ms != null) {
      const p = p95BySite.get(d.site_id) ?? new Map<string, number>();
      p.set(day, Number(d.p95_ms));
      p95BySite.set(d.site_id, p);
    }
  }
  return { dailyBySite, dailyCountsBySite, p95BySite };
}

/**
 * Vážený priemer uptime — SUM(up)/SUM(checks) za posledných `days` dní od
 * dneška, NIE priemer denných percent (audit 2.6: deň s 3 kontrolami by inak
 * vážil rovnako ako deň s 288 — na riedkom dni jeden výpadok urobí obrovský
 * výkyv v %, na hustom dni ho zriedi). `null` = žiadne dáta v okne (nie 0 %
 * — to by bola fabrikácia „totálny výpadok" tam, kde je pravda „nemeralo sa").
 */
export function aggUptime(
  dailyCountsBySite: Map<string, Map<string, { checks: number; up: number }>>,
  siteId: string,
  days: number,
): number | null {
  const m = dailyCountsBySite.get(siteId);
  if (!m) return null;
  let checksSum = 0;
  let upSum = 0;
  for (let i = 0; i < days; i++) {
    const c = m.get(isoDay(i));
    if (c !== undefined) {
      checksSum += c.checks;
      upSum += c.up;
    }
  }
  return checksSum === 0 ? null : Math.round((upSum / checksSum) * 10000) / 100;
}

/** Denné segmenty (posledných `days` dní, najstarší prvý) pre uptime pruh/kalendár. */
export function buildUptimeSegs(
  dailyBySite: Map<string, Map<string, number>>,
  siteId: string,
  days: number,
): UptimeSeg[] {
  const m = dailyBySite.get(siteId);
  const out: UptimeSeg[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = isoDay(i);
    const pct = m?.get(day) ?? null;
    out.push({ color: segColor(pct), date: day, value: pct });
  }
  return out;
}

/** p95 latencia za posledných 30 dní (najstarší prvý; dni bez merania sa preskočia, nie fabrikujú na 0). */
export function buildUptimeP95Series(p95BySite: Map<string, Map<string, number>>, siteId: string): number[] {
  const m = p95BySite.get(siteId);
  if (!m) return [];
  const out: number[] = [];
  for (let i = 29; i >= 0; i--) {
    const v = m.get(isoDay(i));
    if (v !== undefined) out.push(v);
  }
  return out;
}

export interface IncStatsRow {
  site_id: string;
  started_at: string;
  duration_seconds: number | null;
}
export interface IncStats {
  count30: number;
  durSum: number;
  durN: number;
  lastStart: number | null;
}

/** Per-site incident metriky z dodanej sady riadkov: 30-dňový počet, súčty pre MTTR, posledný začiatok. */
export function computeIncidentStats(rows: IncStatsRow[], now: number = Date.now()): Map<string, IncStats> {
  const cut30 = now - 30 * 86400000;
  const incStats = new Map<string, IncStats>();
  for (const i of rows) {
    const st = incStats.get(i.site_id) ?? { count30: 0, durSum: 0, durN: 0, lastStart: null };
    const started = new Date(i.started_at).getTime();
    if (started >= cut30) st.count30++;
    if (i.duration_seconds != null) {
      st.durSum += i.duration_seconds;
      st.durN++;
    }
    st.lastStart = st.lastStart === null ? started : Math.max(st.lastStart, started);
    incStats.set(i.site_id, st);
  }
  return incStats;
}

/** Priemerné MTTR v minútach z incident štatistík (null = žiadny incident s known duration). */
export function mttrMinFromStats(st: IncStats | undefined): number | null {
  return st && st.durN > 0 ? Math.round(st.durSum / st.durN / 60) : null;
}

/** Dní od posledného (známeho) incidentu; null = žiadny incident v dodanej sade. */
export function daysSinceIncidentFromStats(st: IncStats | undefined, now: number = Date.now()): number | null {
  return st?.lastStart ? Math.floor((now - st.lastStart) / 86400000) : null;
}
