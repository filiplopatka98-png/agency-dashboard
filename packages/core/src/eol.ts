// EOL (end-of-life) kontrola verzií WordPressu a PHP — čisté, testovateľné,
// bez I/O. Volá ho infra-probe a robí z toho ADMIN-ONLY alert (nie klientsky).
//
// Zásada: hlásime len FAKTY. Keď verziu nepoznáme alebo je aktuálna, vraciame
// [] — nikdy si nevymýšľame dátum ani „zastaranosť".

export interface EolFinding {
  component: 'php' | 'wordpress';
  version: string; // pôvodná nameraná verzia (interpoluje sa do textu)
  branch: string; // major.minor (napr. '8.1') — dedupe kľúč EOL faktu; patch bump
  //                 v tej istej mŕtvej vetve nesmie znova poslať identický alert
  kind: string; // 'PHP' | 'WordPress' — pre titulok alertu
  text: string; // slovenská veta pre telo alertu
}

// ── PHP ─────────────────────────────────────────────────────────────────────
// Oficiálne dátumy konca podpory z https://www.php.net/supported-versions.php
// (FAKTY, nie odhady). Kľúč je major.minor. Uprav podľa aktuálnej tabuľky na
// php.net. Pozn.: 8.2 je od 2024-12 už len security-fix (do 2026-12-31);
// 8.3 „until 2027-12" a 8.4 „until 2028-12" → berieme koniec daného mesiaca.
export const PHP_EOL: Record<string, string> = {
  '8.0': '2023-11-26',
  '8.1': '2025-12-31',
  '8.2': '2026-12-31',
  '8.3': '2027-12-31',
  '8.4': '2028-12-31',
};

// Najstaršia vetva v tabuľke ako number (major*100+minor). Čokoľvek staršie
// (7.x, 5.x) je podľa php.net dávno po EOL — hlásime BEZ konkrétneho dátumu
// (nefabrikujeme presný deň, keď ho v tabuľke nemáme).
const PHP_OLDEST_TRACKED = 800; // 8.0

function verTuple(v: string): { major: number; minor: number; num: number } | null {
  const m = /^(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return { major, minor, num: major * 100 + minor };
}

function checkPhp(version: string, now: Date): EolFinding | null {
  const t = verTuple(version);
  if (!t) return null; // neznáme → nefabrikuj
  const mm = `${t.major}.${t.minor}`;
  const eol = PHP_EOL[mm];
  if (eol) {
    // < now, nie <= — verzia je „po konci" až deň PO EOL dátume.
    if (Date.parse(`${eol}T00:00:00Z`) < now.getTime()) {
      return { component: 'php', version, branch: mm, kind: 'PHP', text: `PHP ${version} je po konci podpory (EOL ${eol})` };
    }
    return null; // v tabuľke a ešte podporované
  }
  // Nie je v tabuľke: ak je staršia než najstaršia sledovaná vetva → dávno EOL.
  if (t.num < PHP_OLDEST_TRACKED) {
    return { component: 'php', version, branch: mm, kind: 'PHP', text: `PHP ${version} je po konci podpory (staršie než 8.0)` };
  }
  return null; // novšie než tabuľka (napr. 8.9 pred jej pridaním) → nevieme → []
}

// ── WordPress ────────────────────────────────────────────────────────────────
// WP nezverejňuje tvrdý EOL dátum, preto používame POLITICKÝ spodný prah (NIE
// oficiálny EOL) — nastaviteľná konštanta. Čokoľvek pod ním hlásime ako
// zastarané. Uprav podľa toho, čo ešte považujeme za bezpečné podporovať.
export const WP_MIN_SUPPORTED = '6.4';

function checkWp(version: string): EolFinding | null {
  const cur = verTuple(version);
  const min = verTuple(WP_MIN_SUPPORTED);
  if (!cur || !min) return null;
  const below = cur.major < min.major || (cur.major === min.major && cur.minor < min.minor);
  if (below) {
    return {
      component: 'wordpress',
      version,
      branch: `${cur.major}.${cur.minor}`,
      kind: 'WordPress',
      text: `WordPress ${version} je zastaraný (odporúčaná ≥ ${WP_MIN_SUPPORTED})`,
    };
  }
  return null;
}

// Vráti zoznam EOL nálezov (0–2). `now` je injektovateľné kvôli testom.
export function checkEol(
  wpVersion: string | null | undefined,
  phpVersion: string | null | undefined,
  now: Date,
): EolFinding[] {
  const out: EolFinding[] = [];
  if (typeof phpVersion === 'string' && phpVersion) {
    const f = checkPhp(phpVersion, now);
    if (f) out.push(f);
  }
  if (typeof wpVersion === 'string' && wpVersion) {
    const f = checkWp(wpVersion);
    if (f) out.push(f);
  }
  return out;
}
