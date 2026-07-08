/** Formátovacie helpery. Kľúčové pravidlo: chýbajúca hodnota = „nezistené", NIKDY 0. */

export const DASH = '—';

/** Relatívny čas po slovensky: „pred 3 h", „pred 5 min". null → „nezistené". */
export function relativeTime(iso: string | null): string {
  if (!iso) return 'nezistené';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'práve teraz';
  if (min < 60) return `pred ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `pred ${h} h`;
  const d = Math.floor(h / 24);
  return `pred ${d} d`;
}

/** Farba stavovej bodky podľa uptime %. null → sivá (nezistené). */
export function uptimeColor(pct: number | null): string {
  if (pct === null || pct === undefined) return 'var(--dot-unknown)';
  if (pct >= 99.5) return 'var(--dot-ok)';
  if (pct >= 95) return 'var(--dot-warn)';
  return 'var(--dot-down)';
}

/** Uptime % text. null → „nezistené" (nie 0 %). */
export function uptimePct(pct: number | null): string {
  return pct === null || pct === undefined ? 'nezistené' : `${pct}%`;
}

/** Počet dní do dátumu (YYYY-MM-DD alebo ISO). null → null. */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - Date.now()) / 86400000);
}

/** „o 23 dní" / „expirované" / „nezistené". Rozlišuje null (nezistené) od 0. */
export function expiryLabel(dateStr: string | null): string {
  const d = daysUntil(dateStr);
  if (d === null) return 'nezistené';
  if (d < 0) return 'expirované';
  if (d === 0) return 'dnes';
  return `o ${d} ${d === 1 ? 'deň' : d < 5 ? 'dni' : 'dní'}`;
}
