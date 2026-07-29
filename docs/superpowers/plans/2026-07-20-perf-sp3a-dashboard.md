# Performance SP3a — read-only dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prestavať Performance tab na read-only dashboard: krúžky, mobile/desktop + lab/CrUX prepínače, časové filtre, grafy Score History + Web Vitals (vlastný SVG), Issues sekcia. Číta `perf_runs` client-side.

**Architecture:** Čisté helpery (`perf/perfChart.ts`, testované) škálujú dáta → SVG. `perf/LineChart.tsx` je znovupoužiteľný SVG graf. `perf/usePerfData.ts` číta `perf_runs` cez supabase browser client (RLS+JWT). `TabPerformance.tsx` (extrahovaný z page.tsx) skladá layout. Bez backendu/migrácie.

**Tech Stack:** Next.js (static export, client components), supabase-js browser client, vitest (pure helpers), custom SVG.

Spec: `docs/superpowers/specs/2026-07-20-perf-sp3a-dashboard-design.md`. Stavia na SP1.

---

### Task 1: DB typy — doplniť nové tabuľky do `types.generated.ts`

**Files:**
- Modify: `packages/db/src/types.generated.ts`

Typovaný supabase klient (`createClient<Database>`) obmedzuje `.from(name)` na tabuľky v `Database`. Nové tabuľky (perf_runs, monitored_pages, scan_jobs) tam nie sú → treba doplniť, inak client-side query nezkompiluje. (Súbor je generovaný `supabase gen types`, ale bez DB prístupu ho dopĺňame ručne — presný regen by dal to isté.)

- [ ] **Step 1: Pridaj tri tabuľky do `Database['public']['Tables']`**

Nájdi v `packages/db/src/types.generated.ts` blok `public: { Tables: {` a pridaj medzi existujúce tabuľky (napr. za `perf_snapshots`) tieto tri záznamy. Každý má `Row`/`Insert`/`Update`/`Relationships` v štýle okolitých tabuliek (skopíruj tvar z `perf_snapshots` pre konzistenciu; Insert = Row s optional default poľami, Update = všetko optional):

```ts
      monitored_pages: {
        Row: { id: string; site_id: string; org_id: string; url: string; is_homepage: boolean; active: boolean; added_at: string }
        Insert: { id?: string; site_id: string; org_id: string; url: string; is_homepage?: boolean; active?: boolean; added_at?: string }
        Update: { id?: string; site_id?: string; org_id?: string; url?: string; is_homepage?: boolean; active?: boolean; added_at?: string }
        Relationships: []
      }
      perf_runs: {
        Row: { id: string; page_id: string; org_id: string; strategy: string; performance_score: number | null; accessibility: number | null; best_practices: number | null; seo: number | null; lcp_ms: number | null; fcp_ms: number | null; inp_ms: number | null; cls: number | null; tbt_ms: number | null; ttfb_ms: number | null; page_weight_kb: number | null; requests: number | null; field_lcp_ms: number | null; field_inp_ms: number | null; field_cls: number | null; opportunities: Json; measured_at: string; error: string | null }
        Insert: { id?: string; page_id: string; org_id: string; strategy: string; performance_score?: number | null; accessibility?: number | null; best_practices?: number | null; seo?: number | null; lcp_ms?: number | null; fcp_ms?: number | null; inp_ms?: number | null; cls?: number | null; tbt_ms?: number | null; ttfb_ms?: number | null; page_weight_kb?: number | null; requests?: number | null; field_lcp_ms?: number | null; field_inp_ms?: number | null; field_cls?: number | null; opportunities?: Json; measured_at?: string; error?: string | null }
        Update: { [k: string]: never } extends never ? Record<string, never> : never
        Relationships: []
      }
      scan_jobs: {
        Row: { id: string; page_id: string; org_id: string; strategy: string; status: string; error: string | null; requested_at: string; finished_at: string | null }
        Insert: { id?: string; page_id: string; org_id: string; strategy: string; status?: string; error?: string | null; requested_at?: string; finished_at?: string | null }
        Update: { id?: string; page_id?: string; org_id?: string; strategy?: string; status?: string; error?: string | null; requested_at?: string; finished_at?: string | null }
        Relationships: []
      }
```
(Pre `perf_runs.Update` použi jednoducho `Update: Partial<...Row...>` tvar ako okolité tabuľky — vlož rovnaké optional polia ako Insert bez povinných; needitujeme perf_runs z UI, takže presný Update tvar je nepodstatný, len musí typovo existovať. Ak okolité tabuľky používajú konkrétny tvar, skopíruj ho.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck` (alebo `pnpm --filter @agency/web typecheck` — over názov balíka v `apps/web/package.json`)
Expected: čisté (žiadne „table not found" chyby zatiaľ, lebo nikto ešte nequeryuje — over aspoň že súbor kompiluje). Ak build celého repa: `pnpm --filter @agency/db build` ak má build.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/types.generated.ts
git commit -m "feat(db-types): add perf_runs, monitored_pages, scan_jobs to Database types (SP3a)"
```

---

### Task 2: čisté chart helpery `perfChart.ts` (TDD)

**Files:**
- Create: `apps/web/app/sites/perf/perfChart.ts`
- Test: `apps/web/app/sites/perf/perfChart.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { sinceIsoForRange, yBounds, scalePoints } from './perfChart';

describe('sinceIsoForRange', () => {
  const now = new Date('2026-07-20T00:00:00Z');
  it('7d → now - 7 dní', () => {
    expect(sinceIsoForRange('7d', now)).toBe(new Date('2026-07-13T00:00:00Z').toISOString());
  });
  it('all → now - 365 dní', () => {
    expect(sinceIsoForRange('all', now)).toBe(new Date('2025-07-20T00:00:00Z').toISOString());
  });
});

describe('yBounds', () => {
  it('min/max s malým paddingom; ignoruje null', () => {
    expect(yBounds([10, null, 30, 20])).toEqual({ min: 10, max: 30 });
  });
  it('prázdne → 0..1', () => {
    expect(yBounds([])).toEqual({ min: 0, max: 1 });
  });
  it('konštanta → rozšíri rozsah, nedelí nulou', () => {
    const b = yBounds([50, 50]);
    expect(b.max).toBeGreaterThan(b.min);
  });
});

describe('scalePoints', () => {
  it('mapuje hodnoty na SVG body (y invertované), null = medzera', () => {
    const pts = scalePoints([0, 50, 100], { w: 100, h: 100, pad: 0, yMin: 0, yMax: 100 });
    expect(pts[0]).toEqual({ x: 0, y: 100 });   // 0 → dole
    expect(pts[2]).toEqual({ x: 100, y: 0 });    // 100 → hore
  });
  it('null hodnota → null bod (gap)', () => {
    const pts = scalePoints([10, null, 30], { w: 100, h: 100, pad: 0, yMin: 0, yMax: 100 });
    expect(pts[1]).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm --filter web exec vitest run app/sites/perf/perfChart.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter web exec vitest run app/sites/perf/perfChart.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/sites/perf/perfChart.ts apps/web/app/sites/perf/perfChart.test.ts
git commit -m "feat(web): pure SVG chart helpers for perf dashboard (SP3a)"
```

---

### Task 3: hook `usePerfData.ts`

**Files:**
- Create: `apps/web/app/sites/perf/usePerfData.ts`

- [ ] **Step 1: Implement**

```ts
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface PerfRun {
  measured_at: string;
  performance_score: number | null;
  accessibility: number | null;
  best_practices: number | null;
  seo: number | null;
  lcp_ms: number | null; fcp_ms: number | null; inp_ms: number | null;
  cls: number | null; tbt_ms: number | null; ttfb_ms: number | null;
  field_lcp_ms: number | null; field_inp_ms: number | null; field_cls: number | null;
  opportunities: unknown;
  error: string | null;
}

export interface PerfData { history: PerfRun[]; latest: PerfRun | null; loading: boolean; error: string | null }

// Číta perf_runs pre (pageId, strategy) od `sinceIso`. Latest = posledný (najnovší).
// pageId null (homepage sa ešte resolvuje) → nič nefetchuj.
export function usePerfData(pageId: string | null, strategy: 'mobile' | 'desktop', sinceIso: string): PerfData {
  const [state, setState] = useState<PerfData>({ history: [], latest: null, loading: true, error: null });
  useEffect(() => {
    if (!pageId) { setState({ history: [], latest: null, loading: false, error: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    supabase
      .from('perf_runs')
      .select('measured_at, performance_score, accessibility, best_practices, seo, lcp_ms, fcp_ms, inp_ms, cls, tbt_ms, ttfb_ms, field_lcp_ms, field_inp_ms, field_cls, opportunities, error')
      .eq('page_id', pageId)
      .eq('strategy', strategy)
      .gte('measured_at', sinceIso)
      .order('measured_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setState({ history: [], latest: null, loading: false, error: error.message }); return; }
        const history = (data ?? []) as PerfRun[];
        setState({ history, latest: history.length ? history[history.length - 1]! : null, loading: false, error: null });
      });
    return () => { cancelled = true; };
  }, [pageId, strategy, sinceIso]);
  return state;
}

// Resolvne homepage monitored_pages.id pre web (SP3a; SP3b odovzdá vybranú stránku).
export function useHomepageId(siteId: string): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.from('monitored_pages').select('id').eq('site_id', siteId).eq('is_homepage', true).limit(1).maybeSingle()
      .then(({ data }) => { if (!cancelled) setId(data?.id ?? null); });
    return () => { cancelled = true; };
  }, [siteId]);
  return id;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: čisté (perf_runs/monitored_pages sú v typoch z Tasku 1).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/sites/perf/usePerfData.ts
git commit -m "feat(web): usePerfData/useHomepageId hooks (perf_runs client read) (SP3a)"
```

---

### Task 4: `LineChart.tsx` (SVG multi-series graf)

**Files:**
- Create: `apps/web/app/sites/perf/LineChart.tsx`

- [ ] **Step 1: Implement** (konzumuje `perfChart.ts`; theme cez CSS premenné; legenda toggluje série; hover tooltip; `role="img"` + aria)

```tsx
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
            <button key={s.key} onClick={() => setHidden((h) => { const n = new Set(h); n.has(s.key) ? n.delete(s.key) : n.add(s.key); return n; })}
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
```

- [ ] **Step 2: Typecheck** — `pnpm --filter web typecheck` → čisté.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/sites/perf/LineChart.tsx
git commit -m "feat(web): reusable SVG LineChart (legend toggle, hover, a11y) (SP3a)"
```

---

### Task 5: `TabPerformance.tsx` — prestavaný kontajner + wiring

**Files:**
- Create: `apps/web/app/sites/perf/ui.tsx` (presun `Gauge` + `card` + `mono` z page.tsx, exportuj)
- Create: `apps/web/app/sites/TabPerformance.tsx`
- Modify: `apps/web/app/sites/page.tsx` (odstráň starý inline `TabPerformance`; importuj nový; presuň `Gauge`/`card`/`mono` do `perf/ui.tsx` a importuj ich tam, kde ich page.tsx ešte používa — napr. Security gauge na riadku ~894)

- [ ] **Step 1: Presun zdieľané atómy do `perf/ui.tsx`**

Vytvor `apps/web/app/sites/perf/ui.tsx` s `'use client'`, presuň doň `Gauge` (definícia z page.tsx ~451), `card` štýl (~24) a `mono` (~30), exportuj všetky tri. V `page.tsx` ich prestaň definovať a namiesto toho `import { Gauge, card, mono } from './perf/ui';` (page.tsx ich používa aj inde — Security gauge). Over, že page.tsx po zmene typecheckuje.

- [ ] **Step 2: Implement `TabPerformance.tsx`**

Kontajner. Toggly (mobile/desktop, lab/CrUX), časový filter (7d/14d/30d/all + range), rings z `latest`, dva `LineChart`-y z `history`, Issues z `latest.opportunities`. Vizuálny chrome (toggle buttony, karty) MATCHUJ existujúci štýl z page.tsx (device toggle ~460-470, `card`). Kľúčová logika (skopíruj a doplň chrome podľa existujúcich vzorov):

```tsx
'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import type { SiteVM } from '../lib/data';
import { scoreColor, gaugeOffset } from '../lib/design';
import { Gauge, card, mono } from './perf/ui';
import { LineChart, type Series } from './perf/LineChart';
import { usePerfData, useHomepageId } from './perf/usePerfData';
import { sinceIsoForRange, type Range } from './perf/perfChart';

const SCORE_SERIES: { key: keyof PerfPick; label: string; color: string }[] = [
  { key: 'performance_score', label: 'Performance', color: 'var(--accent-primary)' },
  { key: 'accessibility', label: 'Accessibility', color: '#22c55e' },
  { key: 'best_practices', label: 'Best Practices', color: '#f59e0b' },
  { key: 'seo', label: 'SEO', color: '#8b5cf6' },
];
type PerfPick = { performance_score: number|null; accessibility: number|null; best_practices: number|null; seo: number|null };

export function TabPerformance({ site }: { site: SiteVM }) {
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile');
  const [source, setSource] = useState<'lab' | 'crux'>('lab');
  const [range, setRange] = useState<Range>('30d');
  const pageId = useHomepageId(site.id);
  const sinceIso = useMemo(() => sinceIsoForRange(range, new Date()), [range]);
  const { history, latest, loading, error } = usePerfData(pageId, strategy, sinceIso);

  const labels = history.map((r) => r.measured_at);
  const scoreSeries: Series[] = SCORE_SERIES.map((s) => ({ key: s.key, label: s.label, color: s.color, values: history.map((r) => r[s.key]) }));
  const vitalsSeries: Series[] = source === 'lab'
    ? [
        { key: 'lcp', label: 'LCP', color: 'var(--accent-primary)', unit: 'ms', values: history.map((r) => r.lcp_ms) },
        { key: 'fcp', label: 'FCP', color: '#22c55e', unit: 'ms', values: history.map((r) => r.fcp_ms) },
        { key: 'tbt', label: 'TBT', color: '#f59e0b', unit: 'ms', values: history.map((r) => r.tbt_ms) },
        { key: 'ttfb', label: 'TTFB', color: '#8b5cf6', unit: 'ms', values: history.map((r) => r.ttfb_ms) },
      ]
    : [
        { key: 'flcp', label: 'LCP', color: 'var(--accent-primary)', unit: 'ms', values: history.map((r) => r.field_lcp_ms) },
        { key: 'finp', label: 'INP', color: '#22c55e', unit: 'ms', values: history.map((r) => r.field_inp_ms) },
        { key: 'fcls', label: 'CLS×1000', color: '#f59e0b', values: history.map((r) => (r.field_cls === null ? null : Math.round(r.field_cls * 1000))) },
      ];
  const hasCrux = history.some((r) => r.field_lcp_ms !== null || r.field_inp_ms !== null || r.field_cls !== null);
  const opps = Array.isArray(latest?.opportunities) ? (latest!.opportunities as { title: string; savingsMs: number | null }[]) : [];

  const seg = (active: boolean): CSSProperties => ({ padding: '7px 15px', background: active ? 'var(--surface-primary)' : 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, color: active ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 600, boxShadow: active ? 'var(--shadow-sm)' : 'none' });
  const wrap: CSSProperties = { display: 'flex', gap: 4, background: 'var(--surface-secondary)', padding: 4, borderRadius: 10, width: 'fit-content' };
  const enoughHistory = history.length >= 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div role="group" aria-label="Zariadenie" style={wrap}>
          {(['mobile', 'desktop'] as const).map((d) => (
            <button key={d} aria-pressed={strategy === d} onClick={() => setStrategy(d)} style={seg(strategy === d)}>{d === 'mobile' ? 'Mobil' : 'Desktop'}</button>
          ))}
        </div>
        <div role="group" aria-label="Zdroj dát" style={wrap}>
          {(['lab', 'crux'] as const).map((s) => (
            <button key={s} aria-pressed={source === s} onClick={() => setSource(s)} style={seg(source === s)}>{s === 'lab' ? 'Lighthouse' : 'CrUX'}</button>
          ))}
        </div>
        <div role="group" aria-label="Obdobie" style={wrap}>
          {(['7d', '14d', '30d', 'all'] as const).map((r) => (
            <button key={r} aria-pressed={range === r} onClick={() => setRange(r)} style={seg(range === r)}>{r === 'all' ? 'Všetko' : r.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ ...card, padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>Načítavam…</div>
      ) : error ? (
        <div style={{ ...card, padding: 20 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>Nepodarilo sa načítať dáta: {error}</div>
          <button onClick={() => setRange(range)} style={seg(false)}>Skúsiť znova</button>
        </div>
      ) : !latest ? (
        <div style={{ ...card, padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>Zatiaľ žiadne merania (PageSpeed beží denne).</div>
      ) : (
        <>
          <div style={{ ...card, padding: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 }}>
              {([['Performance', latest.performance_score], ['Accessibility', latest.accessibility], ['Best Practices', latest.best_practices], ['SEO', latest.seo]] as const).map(([name, score]) => (
                <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 8 }}>
                  {score === null ? <div style={{ width: 76, height: 76, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: 'var(--text-tertiary)', ...mono }}>—</div>
                    : <Gauge score={score} off={gaugeOffset(score, 207.3)} color={scoreColor(score)} />}
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{name}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...card, padding: 20 }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 14 }}>Score History</h3>
            {enoughHistory ? <LineChart series={scoreSeries} labels={labels} yFixed={{ min: 0, max: 100 }} />
              : <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Zatiaľ málo meraní na graf (zbiera sa denne).</div>}
          </div>

          <div style={{ ...card, padding: 20 }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 14 }}>Web Vitals · {source === 'lab' ? 'Lighthouse (lab)' : 'CrUX (reálni návštevníci)'}</h3>
            {source === 'crux' && !hasCrux ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Žiadne dáta z reálnych návštevníkov (CrUX) — málo návštevnosti.</div>
              : enoughHistory ? <LineChart series={vitalsSeries} labels={labels} />
              : <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Zatiaľ málo meraní na graf (zbiera sa denne).</div>}
          </div>

          <div style={{ ...card, padding: 20 }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 14 }}>Príležitosti na zlepšenie</h3>
            {opps.length === 0 ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Žiadne zásadné príležitosti.</div>
              : <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0 }}>
                  {opps.map((o, i) => (
                    <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <span>{o.title}</span>
                      {typeof o.savingsMs === 'number' && o.savingsMs > 0 && <span style={{ ...mono, color: 'var(--text-tertiary)' }}>~{(o.savingsMs / 1000).toFixed(1)} s</span>}
                    </li>
                  ))}
                </ul>}
          </div>
        </>
      )}
    </div>
  );
}
```

Import na začiatku: `import { useMemo, useState, type CSSProperties } from 'react';`. Custom „range" (od–do date inputy) je z SP3a vedome vynechaný — 4 presety pokryjú bežné potreby, doplní sa neskôr ak bude treba (YAGNI). Vizuálny chrome hore je kompletný; over ho na dev serveri (Task 6) a doladí sa podľa screenshotu.

- [ ] **Step 3: Wire v `page.tsx`**

Odstráň starú `function TabPerformance(...)` z page.tsx. Pridaj `import { TabPerformance } from './TabPerformance';`. Riadok `{tab === 'performance' && <TabPerformance site={site} />}` ostáva (len teraz ukazuje na nový komponent).

- [ ] **Step 4: Typecheck + build + lint**

Run: `pnpm --filter web typecheck && pnpm --filter web build && pnpm --filter web lint`
Expected: čisté (pre-existing font warning OK). Build musí prejsť (static export).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/sites/perf/ui.tsx apps/web/app/sites/TabPerformance.tsx apps/web/app/sites/page.tsx
git commit -m "feat(web): rebuilt Performance tab — rings, toggles, filters, history charts, issues (SP3a)"
```

---

### Task 6: Vizuálne overenie (dev server) + finálne testy

- [ ] **Step 1: Celá suita + lint + build**

Run: `pnpm -r test && pnpm -r lint && pnpm --filter web build`
Expected: zelené (nové perfChart testy + existujúce), build OK.

- [ ] **Step 2: Vizuálne over na dev serveri (Claude Preview)**

Spusti web dev server (`.claude/launch.json` config alebo `pnpm --filter web dev`), prihlás sa, otvor web s dátami (napr. **soccercoacheshub** — má perf_runs históriu z SP1 denných behov), Performance tab. Skontroluj:
- 4 krúžky ukazujú reálne skóre (mobil/desktop prepínač mení hodnoty),
- Score History graf vykreslí čiary (aspoň 1–2 body z doterajších behov), legenda toggluje, hover tooltip funguje,
- Web Vitals graf; lab/CrUX prepínač — CrUX pravdepodobne „žiadne dáta" (malé weby),
- časové filtre menia okno,
- Issues sekcia (soccercoacheshub má opportunities),
- prázdny stav na webe bez histórie, dark-mode.
Sprav screenshot pre používateľa.

- [ ] **Step 3: Deployment (až na „go")** — `git push` + `v*` tag (deploy.yml). Len frontend, žiadna migrácia/Worker/secret.

---

## Poznámky
- Číta existujúce `perf_runs` (SP1) — čím viac dní beží denný zber, tým bohatšie grafy. Dnes ~1–2 body/web.
- SP3b pridá pages tabuľku + scan button; `usePerfData` už berie `pageId`, takže výber stránky sa napojí bez prepisu.
- Bez backendu/migrácie/secretu. Vizuálne overenie je povinné (frontend).
