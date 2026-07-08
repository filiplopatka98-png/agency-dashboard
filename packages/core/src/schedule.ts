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

/** Typy alertov, ktoré sa v noci odkladajú do rannej správy. */
export const NIGHT_DEFERRED_TYPES = new Set(['site_up', 'region_outage']);
