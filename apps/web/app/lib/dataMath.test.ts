import { describe, it, expect, vi } from 'vitest';
import {
  fetchAllPaged,
  type PagedResult,
  isoDay,
  buildDailyMaps,
  aggUptime,
  buildUptimeSegs,
  buildUptimeP95Series,
  freshState,
  computeIncidentStats,
  mttrMinFromStats,
  daysSinceIncidentFromStats,
  type UptimeDailyRow,
  type IncStatsRow,
} from './dataMath';

// Fixný "teraz" pre deterministické testy freshness/incidentov (rovnaký vzor ako packages/core).
const NOW = Date.parse('2026-07-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe('fetchAllPaged — stránkovanie (audit 4.1 + "flat top-N cap")', () => {
  function pagerOver<T>(rows: T[]): (from: number, to: number) => Promise<PagedResult<T>> {
    return async (from, to) => ({ data: rows.slice(from, to + 1), error: null });
  }

  it('čítanie cez viac strán vráti ÚPLNE všetky riadky, nie len prvú stranu', async () => {
    // 2500 riadkov, strana 1000 → presne scenár z auditu (uptime_daily 90 dní × viac webov
    // narazilo na PostgREST max_rows=1000 a bez stránkovania sa ticho orezalo).
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const out = await fetchAllPaged('test', pagerOver(rows), { pageSize: 1000 });
    expect(out).toHaveLength(2500);
    expect(out.map((r) => r.id)).toEqual(rows.map((r) => r.id)); // poradie zachované, nič sa nestratilo/nezduplikovalo
  });

  it('presne na hranici strany (počet riadkov = násobok pageSize) neurobí nekonečnú slučku ani duplicitu', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: i }));
    const out = await fetchAllPaged('test', pagerOver(rows), { pageSize: 2 });
    expect(out).toHaveLength(4);
    expect(out.map((r) => r.id)).toEqual([0, 1, 2, 3]);
  });

  it('krátke čítanie (menej riadkov než jedna strana) sa NEPOMÝLI za neúplný výsledok', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: i }));
    const pager = vi.fn(pagerOver(rows));
    const out = await fetchAllPaged('test', pager, { pageSize: 1000 });
    expect(out).toHaveLength(3);
    expect(pager).toHaveBeenCalledTimes(1); // jedna (krátka) strana stačí — vie, že je koniec
  });

  it('chyba z jednej strany sa nezahodí ticho — vyhodí sa (nie prázdne/čiastočné dáta)', async () => {
    const erroring = async (): Promise<PagedResult<number>> => ({ data: null, error: { message: 'boom' } });
    await expect(fetchAllPaged('widget', erroring)).rejects.toThrow(/widget.*boom/);
  });

  it('keby stránkovanie nikdy neskončilo (stále plné strany), vyhodí explicitnú chybu namiesto tichého orezania', async () => {
    // Simuluje presne to riziko, ktorému sa fix vyhýba: rovnaká chyba, aká pôvodne
    // spôsobila orez `uptime_daily` pri ~11 weboch — tu by bez poistky beh nikdy neskončil.
    const neverShort = async (): Promise<PagedResult<number>> => ({ data: [1, 2], error: null });
    await expect(fetchAllPaged('endless', neverShort, { pageSize: 2, maxPages: 3 })).rejects.toThrow(
      /endless.*neskončilo po 3 stranách/,
    );
  });
});

describe('aggUptime — vážený priemer SUM(up)/SUM(checks) (audit 2.6)', () => {
  it('vážený priemer sa líši od naivného priemeru denných percent', () => {
    const rows: UptimeDailyRow[] = [
      { site_id: 's1', day: isoDay(0), uptime_pct: 100, checks: 3, up: 3, p95_ms: null }, // riedky deň, 100 %
      { site_id: 's1', day: isoDay(1), uptime_pct: 93.75, checks: 288, up: 270, p95_ms: null }, // hustý deň
    ];
    const { dailyCountsBySite } = buildDailyMaps(rows);
    // Naivný priemer percent by dal (100 + 93.75) / 2 = 96.875.
    // Vážený: (3 + 270) / (3 + 288) = 273/291 = 93.8144...% → zaokrúhlené na 93.81.
    const result = aggUptime(dailyCountsBySite, 's1', 2);
    expect(result).toBeCloseTo(93.81, 2);
    expect(result).not.toBeCloseTo(96.875, 2);
  });

  it('null (nie 0 %) keď v okne nie je žiadne meranie — fabrikačné pravidlo', () => {
    const rows: UptimeDailyRow[] = [{ site_id: 's1', day: isoDay(50), uptime_pct: 100, checks: 10, up: 10, p95_ms: null }];
    const { dailyCountsBySite } = buildDailyMaps(rows);
    // okno 7 dní neobsahuje deň spred 50 dní
    expect(aggUptime(dailyCountsBySite, 's1', 7)).toBeNull();
  });

  it('null pre neznámy web (žiadne dáta vôbec)', () => {
    const { dailyCountsBySite } = buildDailyMaps([]);
    expect(aggUptime(dailyCountsBySite, 'ghost', 30)).toBeNull();
  });

  it('deň s checks=0 sa v súčte nezapočíta ako výpadok', () => {
    const rows: UptimeDailyRow[] = [{ site_id: 's1', day: isoDay(0), uptime_pct: 0, checks: 0, up: 0, p95_ms: null }];
    const { dailyCountsBySite } = buildDailyMaps(rows);
    expect(aggUptime(dailyCountsBySite, 's1', 1)).toBeNull();
  });
});

describe('buildUptimeSegs / buildUptimeP95Series', () => {
  it('vráti presne `days` segmentov, najstarší prvý, chýbajúce dni = null (nie fabrikovaná hodnota)', () => {
    const rows: UptimeDailyRow[] = [{ site_id: 's1', day: isoDay(0), uptime_pct: 99.5, checks: 100, up: 99, p95_ms: 200 }];
    const { dailyBySite } = buildDailyMaps(rows);
    const segs = buildUptimeSegs(dailyBySite, 's1', 3);
    expect(segs).toHaveLength(3);
    expect(segs[0].value).toBeNull(); // najstarší (pred 2 dňami) — nemeraný
    expect(segs[1].value).toBeNull(); // pred 1 dňom — nemeraný
    expect(segs[2].value).toBe(99.5); // dnes
    expect(segs[2].date).toBe(isoDay(0));
  });

  it('p95 séria preskočí dni bez merania namiesto fabrikovania 0', () => {
    const rows: UptimeDailyRow[] = [
      { site_id: 's1', day: isoDay(0), uptime_pct: 100, checks: 10, up: 10, p95_ms: 150 },
      { site_id: 's1', day: isoDay(5), uptime_pct: 100, checks: 10, up: 10, p95_ms: 300 },
    ];
    const { p95BySite } = buildDailyMaps(rows);
    const series = buildUptimeP95Series(p95BySite, 's1');
    expect(series).toEqual([300, 150]); // len 2 hodnoty (nie 30), najstaršia prvá
  });

  it('neznámy web → prázdna p95 séria', () => {
    const { p95BySite } = buildDailyMaps([]);
    expect(buildUptimeP95Series(p95BySite, 'ghost')).toEqual([]);
  });
});

describe('freshState — čerstvosť dát (delegované na @agency/core freshnessFor)', () => {
  it('čerstvé pod prahom (216h) → stale=false, measuredAt zachované', () => {
    const at = hoursAgo(10);
    expect(freshState('security', at, NOW)).toEqual({ measuredAt: at, stale: false });
  });

  it('pristaré nad prahom (216h) → stale=true', () => {
    expect(freshState('security', hoursAgo(220), NOW).stale).toBe(true);
  });

  it('gsc má dlhší prah (264h) než ostatné (216h) — rovnaký vek je pre gsc ešte čerstvý', () => {
    const at = hoursAgo(230);
    expect(freshState('security', at, NOW).stale).toBe(true);
    expect(freshState('gsc', at, NOW).stale).toBe(false);
  });

  it('žiadne meranie (null/undefined) → neznáme, nie stale, measuredAt null', () => {
    expect(freshState('aeo', null, NOW)).toEqual({ measuredAt: null, stale: false });
    expect(freshState('aeo', undefined, NOW)).toEqual({ measuredAt: null, stale: false });
  });
});

describe('computeIncidentStats / mttrMinFromStats / daysSinceIncidentFromStats', () => {
  it('incidentCount30 počíta len incidenty za posledných 30 dní, staršie ignoruje', () => {
    const rows: IncStatsRow[] = [
      { site_id: 's1', started_at: daysAgo(5), duration_seconds: 600 },
      { site_id: 's1', started_at: daysAgo(45), duration_seconds: 600 }, // mimo 30-dňového okna
    ];
    const stats = computeIncidentStats(rows, NOW);
    expect(stats.get('s1')?.count30).toBe(1);
  });

  it('presne na 30-dňovej hranici sa ešte započíta (>=, nie >)', () => {
    const rows: IncStatsRow[] = [{ site_id: 's1', started_at: new Date(NOW - 30 * 86_400_000).toISOString(), duration_seconds: null }];
    const stats = computeIncidentStats(rows, NOW);
    expect(stats.get('s1')?.count30).toBe(1);
  });

  it('mttrMin je priemer len z incidentov so known duration (otvorené s null duration sa neráta do priemeru)', () => {
    const rows: IncStatsRow[] = [
      { site_id: 's1', started_at: daysAgo(1), duration_seconds: 600 }, // 10 min
      { site_id: 's1', started_at: daysAgo(2), duration_seconds: 1200 }, // 20 min
      { site_id: 's1', started_at: daysAgo(0), duration_seconds: null }, // prebiehajúci, bez duration
    ];
    const stats = computeIncidentStats(rows, NOW);
    expect(mttrMinFromStats(stats.get('s1'))).toBe(15); // (10+20)/2, nie /3
  });

  it('mttrMin je null keď žiadny incident nemá known duration', () => {
    const rows: IncStatsRow[] = [{ site_id: 's1', started_at: daysAgo(1), duration_seconds: null }];
    const stats = computeIncidentStats(rows, NOW);
    expect(mttrMinFromStats(stats.get('s1'))).toBeNull();
    expect(mttrMinFromStats(undefined)).toBeNull();
  });

  it('daysSinceIncident je od NAJNOVŠIEHO incidentu, nie od najstaršieho', () => {
    const rows: IncStatsRow[] = [
      { site_id: 's1', started_at: daysAgo(20), duration_seconds: 60 },
      { site_id: 's1', started_at: daysAgo(3), duration_seconds: 60 },
    ];
    const stats = computeIncidentStats(rows, NOW);
    expect(daysSinceIncidentFromStats(stats.get('s1'), NOW)).toBe(3);
  });

  it('daysSinceIncident je null keď web nemá žiadny incident v dodanej sade', () => {
    expect(daysSinceIncidentFromStats(undefined, NOW)).toBeNull();
  });

  it('viacero webov sa počíta nezávisle (jeden hlučný web neovplyvní iný)', () => {
    const rows: IncStatsRow[] = [
      { site_id: 'noisy', started_at: daysAgo(1), duration_seconds: 60 },
      { site_id: 'noisy', started_at: daysAgo(2), duration_seconds: 60 },
      { site_id: 'quiet', started_at: daysAgo(1), duration_seconds: 120 },
    ];
    const stats = computeIncidentStats(rows, NOW);
    expect(stats.get('noisy')?.count30).toBe(2);
    expect(stats.get('quiet')?.count30).toBe(1);
    expect(mttrMinFromStats(stats.get('quiet'))).toBe(2);
  });
});
