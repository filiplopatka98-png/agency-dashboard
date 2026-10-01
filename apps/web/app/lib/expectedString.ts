// `sites.expected_string` — text, ktorý musí byť v HTML odpovedi webu, inak sa
// kontrola dostupnosti ráta ako zlyhaná (core localPinger.ts: `body.includes`,
// presná zhoda vrátane veľkosti písmen). Prázdne pole = kontrola vypnutá (NULL),
// nie prázdny reťazec — `''` by síce nič nerozbil, ale v DB by mätol.

/** Max dĺžka — dlhší reťazec je takmer isto prekopírovaný kus HTML, ktorý sa pri prvej zmene webu rozbije. */
export const EXPECTED_STRING_MAX = 200;

export function normalizeExpectedString(raw: string): string | null {
  const v = raw.trim();
  return v === '' ? null : v;
}

/** Chybová hláška pre formulár, alebo null keď je hodnota v poriadku. */
export function expectedStringError(raw: string): string | null {
  const v = normalizeExpectedString(raw);
  if (v !== null && v.length > EXPECTED_STRING_MAX) return `Kontrolný text môže mať najviac ${EXPECTED_STRING_MAX} znakov.`;
  return null;
}

export const EXPECTED_STRING_HINT =
  'Voliteľné. Text, ktorý musí byť v HTML stránky (presne, vrátane veľkých písmen). Ak chýba, web sa ráta ako nedostupný — zachytí aj „biele" stránky a chybové hlášky s kódom 200. Prázdne = len HTTP kontrola.';
