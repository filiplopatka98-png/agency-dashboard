// Čisté (bez Reactu/DOM) helpery pre SVG grafy — testovateľné.

export type Range = '7d' | '14d' | '30d' | 'all';

const RANGE_DAYS: Record<Range, number> = { '7d': 7, '14d': 14, '30d': 30, all: 365 };

// Začiatok časového okna (ISO) pre daný filter. `all` = 365 dní (retencia SP1).
export function sinceIsoForRange(range: Range, now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - RANGE_DAYS[range]);
  return d.toISOString();
}

// Min/max cez nenull hodnoty. Prázdne → 0..1. Konštanta → rozšír, nech sa nedelí nulou.
export function yBounds(values: (number | null)[]): { min: number; max: number } {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return { min: 0, max: 1 };
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) { min -= 1; max += 1; }
  return { min, max };
}

export interface ScaleOpts { w: number; h: number; pad: number; yMin: number; yMax: number }
export interface Pt { x: number; y: number }

// Hodnoty → SVG body. x rovnomerne cez šírku (index), y invertované (0 dole, max hore).
// null hodnota → null bod (medzera v čiare). Jeden bod → v strede.
export function scalePoints(values: (number | null)[], o: ScaleOpts): (Pt | null)[] {
  const n = values.length;
  const innerW = o.w - 2 * o.pad;
  const innerH = o.h - 2 * o.pad;
  const span = o.yMax - o.yMin || 1;
  return values.map((v, i) => {
    if (v === null) return null;
    const x = o.pad + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
    const y = o.pad + innerH - ((v - o.yMin) / span) * innerH;
    return { x, y };
  });
}

// SVG path „M x y L x y …" cez nenull body; medzery (null) prerušia čiaru (nové M).
export function pathFromPoints(pts: (Pt | null)[]): string {
  let d = '';
  let pen = false;
  for (const p of pts) {
    if (p === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
    pen = true;
  }
  return d.trim();
}
