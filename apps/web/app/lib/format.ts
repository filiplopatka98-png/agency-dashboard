/** Formátovacie helpery. Kľúčové pravidlo: chýbajúca hodnota = „nezistené", NIKDY 0. */

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

/** Počet dní do dátumu (YYYY-MM-DD alebo ISO). null → null. */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - Date.now()) / 86400000);
}
