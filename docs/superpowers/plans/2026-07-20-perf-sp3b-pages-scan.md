# Performance SP3b — pages table + on-demand scan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pridať do Performance tabu tabuľku stránok (homepage + pridané) s výberom stránky (prepne graf), pridaním/odstránením a buttonom „skenuj teraz" (volá `/scan` z SP2, polluje `scan_jobs`).

**Architecture:** Čistý `pageUrl.ts` (validácia URL, testovaný). `usePages` hook číta `monitored_pages` + latest `perf_runs` per stránka. `PagesTable.tsx` rieši add (supabase insert) / delete / scan (Worker `/scan` + poll). `TabPerformance` dostane `selectedPageId` stav a renderuje tabuľku pod grafmi. Bez migrácie/Worker/secret.

**Tech Stack:** Next.js client components, supabase-js browser client, fetch → Worker `/scan`, vitest (pure helper).

Spec: `docs/superpowers/specs/2026-07-20-perf-sp3b-pages-scan-design.md`. Stavia na SP1/SP2/SP3a.

---

### Task 1: presun `WORKER_URL` do `lib/worker.ts`

**Files:**
- Create: `apps/web/app/lib/worker.ts`
- Modify: `apps/web/app/settings/page.tsx`

- [ ] **Step 1: Vytvor `lib/worker.ts`**

```ts
// URL Cloudflare Worker schedulera (ručné spustenie jobu /trigger, on-demand /scan).
export const WORKER_URL = 'https://agency-dashboard-scheduler.filip-lopatka98.workers.dev';
```

- [ ] **Step 2: settings importuje odtiaľ**

V `apps/web/app/settings/page.tsx` odstráň riadok `const WORKER_URL = '…';` (~68) a pridaj k importom `import { WORKER_URL } from '../lib/worker';`.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter web typecheck` → čisté.
```bash
git add apps/web/app/lib/worker.ts apps/web/app/settings/page.tsx
git commit -m "refactor(web): extract WORKER_URL to lib/worker (SP3b)"
```

---

### Task 2: čistý `pageUrl.ts` (TDD)

**Files:**
- Create: `apps/web/app/sites/perf/pageUrl.ts`
- Test: `apps/web/app/sites/perf/pageUrl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { normalizePageUrl } from './pageUrl';

describe('normalizePageUrl', () => {
  it('doplní https a normalizuje na doménu webu', () => {
    expect(normalizePageUrl('example.sk/sluzby', 'example.sk')).toEqual({ ok: true, url: 'https://example.sk/sluzby' });
  });
  it('zachová https + path + query, odreže trailing slash', () => {
    expect(normalizePageUrl('https://example.sk/a/?x=1', 'example.sk')).toEqual({ ok: true, url: 'https://example.sk/a?x=1' });
  });
  it('www sa ignoruje (rovnaká doména)', () => {
    expect(normalizePageUrl('https://www.example.sk/a', 'example.sk')).toEqual({ ok: true, url: 'https://example.sk/a' });
  });
  it('root → /', () => {
    expect(normalizePageUrl('example.sk', 'example.sk')).toEqual({ ok: true, url: 'https://example.sk/' });
  });
  it('iná doména → chyba', () => {
    const r = normalizePageUrl('https://iny.sk/a', 'example.sk');
    expect(r.ok).toBe(false);
  });
  it('prázdne / nezmysel → chyba', () => {
    expect(normalizePageUrl('', 'example.sk').ok).toBe(false);
    expect(normalizePageUrl('http://', 'example.sk').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm --filter web exec vitest run app/sites/perf/pageUrl.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// Validácia + normalizácia URL pridávanej stránky. Musí byť na rovnakej doméne
// ako web (sú to jeho podstránky). Normalizuje na https://<doména><path><query>,
// bez fragmentu, bez trailing slash (okrem roota). Čisté (testovateľné).
export type NormResult = { ok: true; url: string } | { ok: false; reason: string };

const stripWww = (h: string) => h.replace(/^www\./i, '');

export function normalizePageUrl(input: string, siteDomain: string): NormResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'Zadaj URL.' };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'Neplatná URL.' };
  }
  if (!u.hostname) return { ok: false, reason: 'Neplatná URL.' };
  const dom = stripWww(siteDomain);
  if (stripWww(u.hostname) !== dom) return { ok: false, reason: `URL musí byť na doméne ${siteDomain}.` };
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return { ok: true, url: `https://${dom}${path}${u.search}` };
}
```

- [ ] **Step 4: Run — verify pass + commit**

Run: `pnpm --filter web exec vitest run app/sites/perf/pageUrl.test.ts` → PASS.
```bash
git add apps/web/app/sites/perf/pageUrl.ts apps/web/app/sites/perf/pageUrl.test.ts
git commit -m "feat(web): pure page-URL validation/normalization (SP3b)"
```

---

### Task 3: hook `usePages.ts`

**Files:**
- Create: `apps/web/app/sites/perf/usePages.ts`

- [ ] **Step 1: Implement**

```ts
'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface PageRow {
  id: string; url: string; is_homepage: boolean;
  performance_score: number | null; accessibility: number | null; best_practices: number | null; seo: number | null;
  measured_at: string | null;
}
export interface PagesState { pages: PageRow[]; loading: boolean; error: string | null; refresh: () => void }

// monitored_pages (aktívne, homepage prvá) + latest perf_runs per stránka pre `strategy`.
// Pri refresh/zmene NEprepína na skeleton (necháva starú tabuľku, aktualizuje po dobehnutí)
// — vyhýba sa synchronnému setState v efekte (eslint react-hooks/set-state-in-effect).
export function usePages(siteId: string, strategy: 'mobile' | 'desktop'): PagesState {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<PagesState, 'refresh'>>({ pages: [], loading: true, error: null });
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: pagesData, error: pErr } = await supabase
        .from('monitored_pages').select('id, url, is_homepage').eq('site_id', siteId).eq('active', true)
        .order('is_homepage', { ascending: false }).order('added_at', { ascending: true });
      if (cancelled) return;
      if (pErr) { setState({ pages: [], loading: false, error: pErr.message }); return; }
      const rows = pagesData ?? [];
      const ids = rows.map((p) => p.id);
      const latest = new Map<string, { performance_score: number | null; accessibility: number | null; best_practices: number | null; seo: number | null; measured_at: string }>();
      if (ids.length) {
        const { data: runs } = await supabase
          .from('perf_runs').select('page_id, performance_score, accessibility, best_practices, seo, measured_at')
          .in('page_id', ids).eq('strategy', strategy).order('measured_at', { ascending: false }).limit(500);
        for (const r of runs ?? []) if (!latest.has(r.page_id)) latest.set(r.page_id, r);
      }
      if (cancelled) return;
      const pages: PageRow[] = rows.map((p) => {
        const l = latest.get(p.id);
        return { id: p.id, url: p.url, is_homepage: p.is_homepage,
          performance_score: l?.performance_score ?? null, accessibility: l?.accessibility ?? null,
          best_practices: l?.best_practices ?? null, seo: l?.seo ?? null, measured_at: l?.measured_at ?? null };
      });
      setState({ pages, loading: false, error: null });
    })();
    return () => { cancelled = true; };
  }, [siteId, strategy, tick]);
  return { ...state, refresh };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter web typecheck` → čisté.
```bash
git add apps/web/app/sites/perf/usePages.ts
git commit -m "feat(web): usePages hook (monitored_pages + latest perf per page) (SP3b)"
```

---

### Task 4: `PagesTable.tsx` (tabuľka + add + scan + delete)

**Files:**
- Create: `apps/web/app/sites/perf/PagesTable.tsx`

- [ ] **Step 1: Implement**

```tsx
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
        setTimeout(poll, 2500);
      };
      setTimeout(poll, 2500);
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
```

- [ ] **Step 2: Typecheck + lint + commit**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: čisté (0 errors). Ak `setTimeout`/async v komponente trafí lint pravidlo, rieš minimálne (napr. `void poll()` namiesto floating promise) — zachovaj správanie.
```bash
git add apps/web/app/sites/perf/PagesTable.tsx
git commit -m "feat(web): PagesTable — add/select/scan/delete pages (SP3b)"
```

---

### Task 5: napojiť do `TabPerformance` (výber stránky + tabuľka)

**Files:**
- Modify: `apps/web/app/sites/TabPerformance.tsx`

- [ ] **Step 1: Pridaj výber stránky + render tabuľky**

V `TabPerformance.tsx`:
- pridaj importy:
```ts
import { usePages } from './perf/usePages';
import { PagesTable } from './perf/PagesTable';
```
- za existujúci `const { pageId, … } = useHomepageId(site.id);` pridaj stav a efektívne id:
```ts
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const effectivePageId = selectedPageId ?? pageId; // default homepage
  const pagesState = usePages(site.id, strategy);
```
- zmeň `usePerfData(pageId, …)` na `usePerfData(effectivePageId, strategy, sinceIso)`.
- na koniec vráteného JSX (za posledný `</div>` obsahu, vnútri hlavného kontajnera) pridaj tabuľku:
```tsx
      <PagesTable site={{ id: site.id, orgId: site.orgId, domain: site.domain }} pages={pagesState.pages} loading={pagesState.loading} error={pagesState.error} refresh={pagesState.refresh} selectedPageId={effectivePageId} onSelect={setSelectedPageId} strategy={strategy} />
```
(Tabuľka je vždy viditeľná — aj počas loading/empty hornej časti, lebo je to samostatná sekcia. Umiestni ju ako posledné dieťa root `<div style={{ display:'flex', flexDirection:'column', gap:16 }}>`.)

- [ ] **Step 2: Typecheck + build + lint**

Run: `pnpm --filter web typecheck && pnpm --filter web build && pnpm --filter web lint`
Expected: čisté (build môže v sandboxe padnúť na `/status/[slug]` kvôli chýbajúcemu service key — to je pre-existing, over že to je JEDINÁ chyba a nie z tvojho kódu; typecheck+lint musia byť čisté).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/sites/TabPerformance.tsx
git commit -m "feat(web): page selection + PagesTable in Performance tab (SP3b)"
```

---

### Task 6: Finálne overenie + nasadenie

- [ ] **Step 1: Celá suita + lint + typecheck**

Run: `pnpm -r test && pnpm -r lint && pnpm --filter web typecheck`
Expected: zelené (nové pageUrl testy + existujúce), lint 0 errors.

- [ ] **Step 2: Deployment (až na „go")** — `git push` + `v*` tag (deploy.yml). Len frontend, žiadna migrácia/secret. Owner vizuálne overí na živom webe: pridá stránku (same-domain check), vyberie ju (graf sa prepne), klikne „Skenuj" (202 → po ~2 min done → skóre + last-scan sa objaví — **prvý reálny end-to-end test `/scan`**), odstráni stránku (potvrdenie).

---

## Poznámky
- `/scan` + `scan_jobs` sú z SP2; toto je len UI navrch. `PSI_API_KEY` Worker secret musí byť nastavený (SP2), inak sken vráti 503 (UI to zobrazí).
- Cap `MAX_PAGES = 10` v UI musí ostať zhodný s `MAX_PAGES_PER_SITE` v collectore.
- Tým sa Performance overhaul (SP1→SP2→SP3a→SP3b) uzatvára.
