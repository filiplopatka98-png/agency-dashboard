/**
 * Nočné okno pre Europe/Bratislava (22:00–06:00 lokálneho času).
 * V noci sa neposielajú site_up ani region_outage alerty — zaradia sa do rannej
 * správy. critical (site_down) sa posiela vždy.
 */
export function isNightInBratislava(date: Date): boolean {
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bratislava',
    hour: '2-digit',
    hour12: false,
  }).format(date);
  const hour = Number(hourStr) % 24; // niektoré enginy dávajú "24" pre polnoc
  return hour >= 22 || hour < 6;
}

/**
 * Typy alertov, ktoré sa v noci odkladajú do rannej správy (06:00 Bratislava).
 * Sú to NEKRITICKÉ upozornenia — nikoho netreba budiť o 3:00:
 *  • site_up / region_outage — zotavenie, nie výpadok,
 *  • metric_drop / gsc_collapse / eol — degradácie výkonu/SEO/zastaraný stack.
 * ZÁMERNE tu NIE SÚ cve_critical ani tls_invalid (kritické, idú okamžite) —
 * ani site_down (výpadok, okamžite).
 */
export const NIGHT_DEFERRED_TYPES = new Set([
  'site_up',
  'region_outage',
  'metric_drop',
  'gsc_collapse',
  'eol',
]);

/** UTC hodinový bucket 'YYYY-MM-DD-HH' pre dedupe_key region_outage alertu. */
export function hourBucketUtc(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}-${p(date.getUTCHours())}`;
}
