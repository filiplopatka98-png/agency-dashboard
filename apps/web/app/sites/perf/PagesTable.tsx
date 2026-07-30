'use client';
import { useState, type CSSProperties } from 'react';
import { supabase } from '../../lib/supabase';
import { WORKER_URL } from '../../lib/worker';
import { scoreColor } from '../../lib/design';
import { card, mono } from './ui';
import { normalizePageUrl } from './pageUrl';
import type { PageRow } from './usePages';

const MAX_PAGES = 10; // musí zodpovedať MAX_PAGES_PER_SITE v tools/psi-probe/index.mjs

export function PagesTable({ site, pages, loading, error, refresh, selectedPageId, onSelect, strategy }: {
  site: { id: string; orgId: string; domain: string };
  pages: PageRow[]; loading: boolean; error: string | null; refresh: () => void;
  selectedPageId: string | null; onSelect: (id: string | null) => void;
  strategy: 'mobile' | 'desktop';
}) {
  const [input, setInput] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);           // page_id ktorý sa práve skenuje
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({}); // per-riadok hláška
  const atCap = pages.length >= MAX_PAGES;
  const setMsg = (id: string, m: string | null) => setRowMsg((r) => ({ ...r, [id]: m ?? '' }));

  async function add() {
    const n = normalizePageUrl(input, site.domain);
    if (!n.ok) { setAddErr(n.reason); return; }
    const { error: e } = await supabase.from('monitored_pages').insert({ site_id: site.id, org_id: site.orgId, url: n.url, is_homepage: false });
    if (e) { setAddErr(e.code === '23505' ? 'Táto stránka je už pridaná.' : 'Nepodarilo sa pridať.'); return; }
    setInput(''); setAddErr(null); refresh();
  }

  async function remove(id: string, url: string) {
    if (!confirm(`Odstrániť ${url}?\nZmaže sa aj história meraní tejto stránky.`)) return;
    const { error: e } = await supabase.from('monitored_pages').delete().eq('id', id);
    if (e) { setMsg(id, 'Nepodarilo sa odstrániť.'); return; }
    if (selectedPageId === id) onSelect(null);
    refresh();
  }

  async function scan(id: string) {
    setBusy(id); setMsg(id, '');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) { setMsg(id, 'Prihlásenie vypršalo.'); setBusy(null); return; }
    try {
      const res = await fetch(`${WORKER_URL}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: id, strategy }) });
      if (res.status === 429) { setMsg(id, 'Sken práve beží alebo dobehol pred chvíľou.'); setBusy(null); return; }
      if (res.status === 503) { setMsg(id, 'On-demand sken nie je nakonfigurovaný.'); setBusy(null); return; }
      if (res.status !== 202) { setMsg(id, 'Nepodarilo sa spustiť sken.'); setBusy(null); return; }
      const { job_id } = (await res.json()) as { job_id: string };
      const started = Date.now();
      const poll = async () => {
        const { data: job } = await supabase.from('scan_jobs').select('status, error').eq('id', job_id).maybeSingle();
        if (job?.status === 'done') { setBusy(null); setMsg(id, ''); refresh(); return; }
        if (job?.status === 'error') { setBusy(null); setMsg(id, `Sken zlyhal: ${job.error ?? ''}`); return; }
        if (Date.now() - started > 180_000) { setBusy(null); setMsg(id, 'Sken trvá dlho — obnov neskôr.'); return; }
        setTimeout(() => void poll(), 2500);
      };
      setTimeout(() => void poll(), 2500);
    } catch { setMsg(id, 'Nepodarilo sa spustiť sken.'); setBusy(null); }
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
          <button onClick={add} disabled={atCap || !input.trim()} style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: atCap ? 'not-allowed' : 'pointer', background: 'var(--accent-primary)', color: '#fff', opacity: atCap || !input.trim() ? 0.5 : 1 }}>Pridať</button>
        </div>
      </div>
      {addErr && <div style={{ fontSize: 12.5, color: 'var(--critical-color)', marginBottom: 8 }}>{addErr}</div>}
      {error ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Nepodarilo sa načítať stránky: {error}</div>
        : loading ? <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Načítavam…</div>
        : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th scope="col" style={th}>URL</th><th scope="col" style={th}>Perf</th><th scope="col" style={th}>A11y</th>
            <th scope="col" style={th}>BP</th><th scope="col" style={th}>SEO</th><th scope="col" style={th}>Posledný sken</th><th scope="col" style={th}></th>
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
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => scan(p.id)} disabled={busy === p.id} aria-label={`Skenovať ${p.url}`} style={{ padding: '5px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-secondary)', color: 'var(--text-secondary)', cursor: busy === p.id ? 'wait' : 'pointer', marginRight: 6 }}>{busy === p.id ? 'Skenujem…' : 'Skenuj'}</button>
                    {!p.is_homepage && <button onClick={() => remove(p.id, p.url)} aria-label={`Odstrániť ${p.url}`} style={{ padding: '5px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--critical-color)', cursor: 'pointer' }}>Odstrániť</button>}
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
