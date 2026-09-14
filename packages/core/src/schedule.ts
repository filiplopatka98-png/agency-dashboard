// Posledná nedeľa mesiaca o 01:00 UTC — okamih EU prechodu času.
function lastSundayUtc(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, lastDay.getUTCDate() - lastDay.getUTCDay(), 1);
}

/**
 * Lokálna hodina v Bratislave BEZ Intl. `Intl.DateTimeFormat` s timeZone pri
 * prvom použití v studenom izoláte načítava ICU dáta časových zón (~14 ms CPU)
 * — scheduler Worker na Free pláne má 10 ms na celé spustenie. EU pravidlo:
 * letný čas (UTC+2) od poslednej nedele v marci do poslednej nedele v októbri,
 * vždy o 01:00 UTC; inak UTC+1.
 */
export function bratislavaHour(date: Date): number {
  const t = date.getTime();
  const y = date.getUTCFullYear();
  const summer = t >= lastSundayUtc(y, 2) && t < lastSundayUtc(y, 9);
  return (date.getUTCHours() + (summer ? 2 : 1)) % 24;
}

/**
 * Nočné okno pre Europe/Bratislava (22:00–06:00 lokálneho času).
 * V noci sa neposielajú site_up ani region_outage alerty — zaradia sa do rannej
 * správy. critical (site_down) sa posiela vždy.
 */
export function isNightInBratislava(date: Date): boolean {
  const hour = bratislavaHour(date);
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
