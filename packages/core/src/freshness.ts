// Strážca čerstvosti dát — nič sa neprezentuje ako aktuálne, ak je meranie
// pristaré. Prahy zodpovedajú kadencii collectorov (týždenné) s rezervou.

export type MetricKey = 'aeo' | 'security' | 'seo' | 'perf' | 'gsc' | 'infra' | 'wp' | 'cve';

// Po koľkých hodinách bez nového merania považujeme dáta za neaktuálne.
// Týždenné joby (168h) + rezerva na oneskorený beh. GSC má vlastné oneskorenie.
export const MAX_AGE_HOURS: Record<MetricKey, number> = {
  aeo: 216, // 9 dní
  security: 216,
  seo: 216,
  perf: 216,
  infra: 216,
  cve: 216,
  wp: 216, // agent tlačí denne, ale tolerujeme týždenne
  gsc: 264, // 11 dní (GSC dáta majú 2–3 dňový lag)
};

export interface Freshness {
  ageMs: number | null; // null = nikdy nemerané
  stale: boolean; // pristaré na prezentáciu ako aktuálne
  missing: boolean; // žiadne meranie
}

// `now` je injektovateľné kvôli testom. `measuredAt` ISO string alebo null.
export function computeFreshness(
  measuredAt: string | null | undefined,
  maxAgeHours: number,
  now: number = Date.now(),
): Freshness {
  if (!measuredAt) return { ageMs: null, stale: false, missing: true };
  const t = Date.parse(measuredAt);
  if (Number.isNaN(t)) return { ageMs: null, stale: false, missing: true };
  const ageMs = now - t;
  return { ageMs, stale: ageMs > maxAgeHours * 3_600_000, missing: false };
}

export function freshnessFor(
  metric: MetricKey,
  measuredAt: string | null | undefined,
  now: number = Date.now(),
): Freshness {
  return computeFreshness(measuredAt, MAX_AGE_HOURS[metric], now);
}
