'use client';

// Zdieľané vizuálne atómy (presunuté z page.tsx) — používa ich Performance
// dashboard aj ostatné taby v page.tsx (Security gauge, karty, mono číslice).

export const card = {
  background: 'var(--surface-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-sm)',
} as const;

export const mono = { fontFamily: "'Geist Mono', monospace", fontVariantNumeric: 'tabular-nums' } as const;

// Kruhový gauge (skóre 0–100). `off` = strokeDashoffset, `circ` = obvod kruhu.
export function Gauge({ score, off, color, size = 76, sw = 7, r = 33, circ = 207.3 }: { score: number; off: number; color: string; size?: number; sw?: number; r?: number; circ?: number }) {
  const c = size / 2;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, transform: 'rotate(-90deg)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-secondary)" strokeWidth={sw} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size > 100 ? 34 : size > 70 ? 22 : 18, fontWeight: 800, ...mono, color }}>{score}</div>
    </div>
  );
}
