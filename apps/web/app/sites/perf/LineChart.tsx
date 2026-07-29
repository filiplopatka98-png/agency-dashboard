'use client';
import { useState } from 'react';
import { scalePoints, pathFromPoints, yBounds, type Pt } from './perfChart';

export interface Series { key: string; label: string; color: string; values: (number | null)[]; unit?: string }

// Viacsériový čiarový graf. `labels` = os X (dátumy, rovnaká dĺžka ako values).
export function LineChart({ series, labels, height = 220, yFixed }: { series: Series[]; labels: string[]; height?: number; yFixed?: { min: number; max: number } }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, PAD = 28;
  const visible = series.filter((s) => !hidden.has(s.key));
  const allVals = visible.flatMap((s) => s.values);
  const { min, max } = yFixed ?? yBounds(allVals);
  const scaled = visible.map((s) => ({ ...s, pts: scalePoints(s.values, { w: W, h: height, pad: PAD, yMin: min, yMax: max }) }));
  const summary = series.map((s) => `${s.label}: ${s.values.filter((v) => v !== null).slice(-1)[0] ?? '—'}`).join(', ');

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={`Graf: ${summary}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const n = labels.length;
          if (n < 2) { setHover(n ? 0 : null); return; }
          const i = Math.round(((x - PAD) / (W - 2 * PAD)) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}>
        {/* baseline os */}
        <line x1={PAD} y1={height - PAD} x2={W - PAD} y2={height - PAD} stroke="var(--border)" strokeWidth={1} />
        {scaled.map((s) => (
          <path key={s.key} d={pathFromPoints(s.pts)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {/* hover zvislá čiara + body */}
        {hover !== null && labels.length > 0 && scaled.map((s) => {
          const p = s.pts[hover] as Pt | null;
          return p ? <circle key={s.key} cx={p.x} cy={p.y} r={3.5} fill={s.color} /> : null;
        })}
      </svg>
      {/* tooltip */}
      {hover !== null && labels[hover] && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
          <strong>{new Date(labels[hover]!).toLocaleDateString('sk')}</strong>{' — '}
          {visible.map((s) => `${s.label}: ${s.values[hover] ?? '—'}${s.unit ?? ''}`).join(' · ')}
        </div>
      )}
      {/* legenda (toggle série) */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
        {series.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button key={s.key} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n; })}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12.5, color: off ? 'var(--text-tertiary)' : 'var(--text-secondary)', opacity: off ? 0.55 : 1 }}
              aria-pressed={!off}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: 'inline-block' }} />
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
