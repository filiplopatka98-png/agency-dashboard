'use client';
import { useMemo, useState, type CSSProperties } from 'react';
import type { SiteVM } from '../lib/data';
import { scoreColor, gaugeOffset } from '../lib/design';
import { Gauge, card, mono } from './perf/ui';
import { LineChart, type Series } from './perf/LineChart';
import { usePerfData, useHomepageId } from './perf/usePerfData';
import { sinceIsoForRange, type Range } from './perf/perfChart';
import { usePages } from './perf/usePages';
import { PagesTable } from './perf/PagesTable';

type PerfPick = { performance_score: number|null; accessibility: number|null; best_practices: number|null; seo: number|null };
const SCORE_SERIES: { key: keyof PerfPick; label: string; color: string }[] = [
  { key: 'performance_score', label: 'Performance', color: 'var(--accent-primary)' },
  { key: 'accessibility', label: 'Accessibility', color: '#22c55e' },
  { key: 'best_practices', label: 'Best Practices', color: '#f59e0b' },
  { key: 'seo', label: 'SEO', color: '#8b5cf6' },
];

export function TabPerformance({ site }: { site: SiteVM }) {
  const [strategy, setStrategy] = useState<'mobile' | 'desktop'>('mobile');
  const [source, setSource] = useState<'lab' | 'crux'>('lab');
  const [range, setRange] = useState<Range>('30d');
  const { pageId, loading: pageLoading, error: pageError } = useHomepageId(site.id);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const effectivePageId = selectedPageId ?? pageId; // default homepage
  const pagesState = usePages(site.id, strategy);
  const sinceIso = useMemo(() => sinceIsoForRange(range, new Date()), [range]);
  const { history, latest, loading: dataLoading, error: dataError } = usePerfData(effectivePageId, strategy, sinceIso);
  // Kým sa resolvuje homepage id → skeleton (nie falošný prázdny stav).
  const loading = pageLoading || dataLoading;
  const error = pageError ?? dataError;

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
  // Menej než MIN_CHART_POINTS bodov = chudobná/škaredá čiara → radšej info hláška
  // s konkrétnym počtom (PSI meria denne, takže body ≈ dni). Doplnia sa denným zberom.
  const MIN_CHART_POINTS = 3;
  const enoughHistory = history.length >= MIN_CHART_POINTS;
  const chartHint = `Graf sa zobrazí po aspoň ${MIN_CHART_POINTS} meraniach — PSI meria denne (zatiaľ ${history.length}).`;

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
              : <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{chartHint}</div>}
          </div>

          <div style={{ ...card, padding: 20 }}>
            <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 14 }}>Web Vitals · {source === 'lab' ? 'Lighthouse (lab)' : 'CrUX (reálni návštevníci)'}</h3>
            {source === 'crux' && !hasCrux ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Žiadne dáta z reálnych návštevníkov (CrUX) — málo návštevnosti.</div>
              : enoughHistory ? <LineChart series={vitalsSeries} labels={labels} />
              : <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{chartHint}</div>}
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

      <PagesTable site={{ id: site.id, orgId: site.orgId, domain: site.domain }} pages={pagesState.pages} loading={pagesState.loading} error={pagesState.error} refresh={pagesState.refresh} selectedPageId={effectivePageId} onSelect={setSelectedPageId} strategy={strategy} />
    </div>
  );
}
