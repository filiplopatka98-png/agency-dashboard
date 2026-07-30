'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { supabase } from '../../lib/supabase';
import { WORKER_URL } from '../../lib/worker';
import { scoreColor } from '../../lib/design';
import { card, mono } from './ui';
import { normalizePageUrl } from './pageUrl';
import type { PageRow } from './usePages';

const MAX_PAGES = 10; // musí zodpovedať MAX_PAGES_PER_SITE v tools/psi-probe/index.mjs

// Kompaktné ikonkové akcie (namiesto textových tlačidiel). aria-label + title
// zachovávajú prístupnosť aj tooltip. Spinner cez SVG SMIL (bez CSS keyframes).
const iconBtn = (extra?: CSSProperties): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30,
  borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-secondary)',
  color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, ...extra,
});
const PlayIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">
    <path d="M4.5 3.2c0-.5.5-.8 1-.5l7 4.8c.4.3.4.9 0 1.1l-7 4.8c-.5.3-1 0-1-.5V3.2z" />
  </svg>
);
const SpinnerIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="12">
      <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite" />
    </circle>
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4h10M6.5 4V3h3v1M5 4l.5 8.5a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9L11 4" />
  </svg>
);

export function PagesTable({ site, pages, loading, error, refresh, selectedPageId, onSelect, strategy }: {
  site: { id: string; orgId: string; domain: string };
  pages: PageRow[]; loading: boolean; error: string | null; refresh: () => void;
  selectedPageId: string | null; onSelect: (id: string | null) => void;
  strategy: 'mobile' | 'desktop';
}) {
  const [input, setInput] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);                      // insert prebieha (guard proti cap-10 race)
  const [busy, setBusy] = useState<Set<string>>(new Set());         // page_id-y ktoré sa práve skenujú
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({}); // per-riadok hláška
  const atCap = pages.length >= MAX_PAGES;
  const setMsg = (id: string, m: string | null) => setRowMsg((r) => ({ ...r, [id]: m ?? '' }));
  const startBusy = (id: string) => setBusy((b) => new Set(b).add(id));
  const endBusy = (id: string) => setBusy((b) => { const n = new Set(b); n.delete(id); return n; });

  // Komponent sa odmountuje pri prepnutí tabu/návrate na zoznam — poll timery
  // (až 3 min) potom nesmú volať setState na odmountovanom komponente.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  async function add() {
    if (adding) return;
    const n = normalizePageUrl(input, site.domain);
    if (!n.ok) { setAddErr(n.reason); return; }
    setAdding(true);
    try {
      const { error: e } = await supabase.from('monitored_pages').insert({ site_id: site.id, org_id: site.orgId, url: n.url, is_homepage: false });
      if (!mounted.current) return;
      if (e) { setAddErr(e.code === '23505' ? 'Táto stránka je už pridaná.' : 'Nepodarilo sa pridať.'); return; }
      setInput(''); setAddErr(null); refresh();
    } finally {
      if (mounted.current) setAdding(false);
    }
  }

  async function remove(id: string, url: string) {
    if (!confirm(`Odstrániť ${url}?\nZmaže sa aj história meraní tejto stránky.`)) return;
    const { error: e } = await supabase.from('monitored_pages').delete().eq('id', id);
    if (e) { setMsg(id, 'Nepodarilo sa odstrániť.'); return; }
    if (selectedPageId === id) onSelect(null);
    refresh();
  }

  async function scan(id: string) {
    startBusy(id); setMsg(id, '');
    const { data } = await supabase.auth.getSession();
    if (!mounted.current) return;
    const token = data.session?.access_token;
    if (!token) { setMsg(id, 'Prihlásenie vypršalo.'); endBusy(id); return; }
    try {
      const res = await fetch(`${WORKER_URL}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: id, strategy }) });
      if (!mounted.current) return;
      if (res.status === 429) { setMsg(id, 'Sken práve beží alebo dobehol pred chvíľou.'); endBusy(id); return; }
      if (res.status === 503) { setMsg(id, 'On-demand sken nie je nakonfigurovaný.'); endBusy(id); return; }
      if (res.status !== 202) { setMsg(id, 'Nepodarilo sa spustiť sken.'); endBusy(id); return; }
      const { job_id } = (await res.json()) as { job_id: string };
      const started = Date.now();
      const poll = async () => {
        if (!mounted.current) return;
        const { data: job } = await supabase.from('scan_jobs').select('status, error').eq('id', job_id).maybeSingle();
        if (!mounted.current) return;
        if (job?.status === 'done') { endBusy(id); setMsg(id, ''); refresh(); return; }
        if (job?.status === 'error') { endBusy(id); setMsg(id, `Sken zlyhal: ${job.error ?? ''}`); return; }
        if (Date.now() - started > 180_000) { endBusy(id); setMsg(id, 'Sken trvá dlho — obnov neskôr.'); return; }
        setTimeout(() => void poll(), 2500);
      };
      setTimeout(() => void poll(), 2500);
    } catch {
      if (!mounted.current) return;
      setMsg(id, 'Nepodarilo sa spustiť sken.'); endBusy(id);
    }
  }

  const th: CSSProperties = { textAlign: 'left', fontSize: 11.5, color: 'var(--text-tertiary)', fontWeight: 600, padding: '6px 8px', textTransform: 'uppercase' };
  const td: CSSProperties = { padding: '8px', fontSize: 13, borderTop: '1px solid var(--border)' };
  const scoreCell = (s: number | null) => <span style={{ ...mono, color: s === null ? 'var(--text-tertiary)' : scoreColor(s), fontWeight: 700 }}>{s ?? '—'}</span>;

  return (
    <div style={{ ...card, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Stránky ({pages.length})</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={input} onChange={(e) => { setInput(e.target.value); setAddErr(null); }} disabled={atCap}
            placeholder={atCap ? 'Max 10 stránok' : `https://${site.domain}/…`} aria-label="URL novej stránky"
            style={{ padding: '7px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-secondary)', color: 'var(--text-primary)', minWidth: 220 }} />
          <button onClick={add} disabled={atCap || adding || !input.trim()} style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: atCap || adding ? 'not-allowed' : 'pointer', background: 'var(--accent-primary)', color: '#fff', opacity: atCap || adding || !input.trim() ? 0.5 : 1 }}>Pridať</button>
        </div>
      </div>
      {addErr && <div style={{ fontSize: 12.5, color: 'var(--critical-color)', marginBottom: 8 }}>{addErr}</div>}
      {error ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Nepodarilo sa načítať stránky: {error}</div>
        : loading ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Načítavam…</div>
        : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th scope="col" style={th}>URL</th><th scope="col" style={th}>Perf</th><th scope="col" style={th}>A11y</th>
            <th scope="col" style={th}>BP</th><th scope="col" style={th}>SEO</th><th scope="col" style={th}>Posledný sken</th><th scope="col" style={{ ...th, textAlign: 'right' }}></th>
          </tr></thead>
          <tbody>
            {pages.map((p) => {
              const sel = (selectedPageId ?? pages.find((x) => x.is_homepage)?.id) === p.id;
              return (
                <tr key={p.id} style={{ background: sel ? 'var(--surface-secondary)' : 'transparent' }}>
                  <td style={td}>
                    <button onClick={() => onSelect(p.id)} aria-pressed={sel} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: sel ? 'var(--accent-primary)' : 'var(--text-primary)', fontWeight: sel ? 700 : 500, fontSize: 13, textAlign: 'left' }}>
                      {p.url.replace(/^https:\/\//, '')}{p.is_homepage ? ' · domov' : ''}
                    </button>
                    {rowMsg[p.id] ? <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2 }}>{rowMsg[p.id]}</div> : null}
                  </td>
                  <td style={td}>{scoreCell(p.performance_score)}</td>
                  <td style={td}>{scoreCell(p.accessibility)}</td>
                  <td style={td}>{scoreCell(p.best_practices)}</td>
                  <td style={td}>{scoreCell(p.seo)}</td>
                  <td style={{ ...td, color: 'var(--text-tertiary)', fontSize: 12 }}>{p.measured_at ? new Date(p.measured_at).toLocaleDateString('sk') : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button onClick={() => scan(p.id)} disabled={busy.has(p.id)} title={busy.has(p.id) ? 'Skenuje sa…' : 'Skenovať teraz'} aria-label={`Skenovať ${p.url}`}
                      style={iconBtn({ cursor: busy.has(p.id) ? 'wait' : 'pointer', marginRight: 6, color: busy.has(p.id) ? 'var(--accent-primary)' : 'var(--text-secondary)' })}>
                      {busy.has(p.id) ? <SpinnerIcon /> : <PlayIcon />}
                    </button>
                    {!p.is_homepage && (
                      <button onClick={() => remove(p.id, p.url)} title="Odstrániť stránku" aria-label={`Odstrániť ${p.url}`} style={iconBtn({ color: 'var(--critical-color)' })}>
                        <TrashIcon />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
