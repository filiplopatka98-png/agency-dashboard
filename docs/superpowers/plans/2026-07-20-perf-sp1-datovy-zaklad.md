# Performance SP1 — dátový základ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-page PSI monitoring s dennou históriou: nová `monitored_pages` entita + append-only `perf_runs` (skóre + vitals + FCP + CrUX + opportunities), homepage ostáva spätne kompatibilná cez `perf_snapshots`.

**Architecture:** Čistá parse logika v `packages/core/src/psi.ts` (fcp + opportunities, testované). Migrácia pridá `monitored_pages` + `perf_runs` + retenciu + seed homepage. `tools/psi-probe/index.mjs` prepísaný na iteráciu stránok (concurrency-limited), zapisuje `perf_runs` pre všetky stránky a pre homepage aj `perf_snapshots` (back-compat). Bez UI, bez on-demand skenu.

**Tech Stack:** Node ESM collector (GitHub Actions), TypeScript `@agency/core` (tsc→dist), vitest, Supabase Postgres/PostgREST.

Spec: `docs/superpowers/specs/2026-07-20-perf-sp1-datovy-zaklad-design.md`

---

### Task 1: core — parsePsi pridá FCP

**Files:**
- Modify: `packages/core/src/psi.ts`
- Test: `packages/core/src/psi.test.ts`

- [ ] **Step 1: Write the failing test** (pridaj do `psi.test.ts`)

```ts
it('parsePsi extrahuje FCP z first-contentful-paint auditu', () => {
  const json = {
    lighthouseResult: {
      categories: { performance: { score: 0.9 } },
      audits: { 'first-contentful-paint': { numericValue: 1234.6 } },
    },
  };
  const r = parsePsi(json as never);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.snap.fcpMs).toBe(1235);
});
it('parsePsi fcpMs = null keď audit chýba', () => {
  const json = { lighthouseResult: { categories: { performance: { score: 0.5 } }, audits: {} } };
  const r = parsePsi(json as never);
  if (r.ok) expect(r.snap.fcpMs).toBeNull();
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm --filter @agency/core exec vitest run src/psi.test.ts`
Expected: FAIL — `fcpMs` neexistuje na `snap`.

- [ ] **Step 3: Implement**

V `packages/core/src/psi.ts`, do interface `PerfSnap` pridaj pole (za `ttfbMs`):
```ts
  fcpMs: number | null;
```
V `parsePsi`, do vráteného `snap` objektu pridaj (za `ttfbMs` riadok):
```ts
      fcpMs: num('first-contentful-paint') !== null ? Math.round(num('first-contentful-paint')!) : null,
```
(`num` helper už v parsePsi existuje.)

- [ ] **Step 4: Run test — verify it passes**

Run: `pnpm --filter @agency/core exec vitest run src/psi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/psi.ts packages/core/src/psi.test.ts
git commit -m "feat(core): parsePsi captures FCP"
```

---

### Task 2: core — parsePsi pridá opportunities

**Files:**
- Modify: `packages/core/src/psi.ts`
- Test: `packages/core/src/psi.test.ts`

- [ ] **Step 1: Write the failing test** (pridaj do `psi.test.ts`)

```ts
it('parsePsi zoberie len opportunity audity, zoradí podľa úspory, cap 8', () => {
  const audits: Record<string, unknown> = {
    'unused-css': { title: 'Reduce unused CSS', score: 0.5, details: { type: 'opportunity', overallSavingsMs: 300, overallSavingsBytes: 12000 } },
    'unused-js': { title: 'Reduce unused JavaScript', score: 0.2, details: { type: 'opportunity', overallSavingsMs: 900 } },
    'ok-audit': { title: 'Perfektné', score: 1, details: { type: 'opportunity', overallSavingsMs: 0 } },
    'not-opp': { title: 'Diagnostika', score: 0.3, details: { type: 'table' } },
  };
  const json = { lighthouseResult: { categories: { performance: { score: 0.4 } }, audits } };
  const r = parsePsi(json as never);
  if (!r.ok) throw new Error('má byť ok');
  expect(r.snap.opportunities.map((o) => o.id)).toEqual(['unused-js', 'unused-css']); // score<1, opportunity, zoradené savingsMs desc
  expect(r.snap.opportunities[0]).toEqual({ id: 'unused-js', title: 'Reduce unused JavaScript', savingsMs: 900, savingsBytes: null, score: 0.2 });
});
it('parsePsi opportunities = [] keď žiadne', () => {
  const json = { lighthouseResult: { categories: { performance: { score: 1 } }, audits: {} } };
  const r = parsePsi(json as never);
  if (r.ok) expect(r.snap.opportunities).toEqual([]);
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `pnpm --filter @agency/core exec vitest run src/psi.test.ts`
Expected: FAIL — `opportunities` neexistuje.

- [ ] **Step 3: Implement**

V `packages/core/src/psi.ts`:

Pridaj exportovaný typ (nad `PerfSnap`):
```ts
export interface PsiOpportunity {
  id: string;
  title: string;
  savingsMs: number | null;
  savingsBytes: number | null;
  score: number | null;
}
```
Do `PerfSnap` pridaj:
```ts
  opportunities: PsiOpportunity[];
```
Rozšír typ auditu v `PsiJson` (interface hore), aby mal `title`, `score`, `details.type`, `overallSavings*`:
```ts
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null } | undefined>;
    audits?: Record<string, {
      numericValue?: number;
      title?: string;
      score?: number | null;
      details?: { type?: string; items?: unknown[]; overallSavingsMs?: number; overallSavingsBytes?: number };
    } | undefined>;
  };
```
V `parsePsi`, pred `return`, poskladaj opportunities:
```ts
  // Len sekcia „Opportunities" (details.type === 'opportunity'), čo reálne majú
  // čo zlepšiť (score < 1). Diagnostiku zámerne neberieme (fuzzy). Top 8 podľa
  // úspory ms; chýbajúca úspora = null (bez fabrikácie).
  const opportunities: PsiOpportunity[] = Object.entries(audits)
    .filter(([, a]) => !!a && a.details?.type === 'opportunity' && typeof a.score === 'number' && a.score < 1)
    .map(([id, a]) => ({
      id,
      title: a!.title ?? id,
      savingsMs: typeof a!.details?.overallSavingsMs === 'number' ? Math.round(a!.details.overallSavingsMs) : null,
      savingsBytes: typeof a!.details?.overallSavingsBytes === 'number' ? Math.round(a!.details.overallSavingsBytes) : null,
      score: typeof a!.score === 'number' ? a!.score : null,
    }))
    .sort((x, y) => (y.savingsMs ?? -1) - (x.savingsMs ?? -1))
    .slice(0, 8);
```
Do vráteného `snap` pridaj `opportunities,`.

- [ ] **Step 4: Run test — verify it passes**

Run: `pnpm --filter @agency/core exec vitest run src/psi.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + full core test + commit**

Run: `pnpm --filter @agency/core build && pnpm --filter @agency/core test`
Expected: build OK, všetky zelené.
```bash
git add packages/core/src/psi.ts packages/core/src/psi.test.ts
git commit -m "feat(core): parsePsi captures Lighthouse opportunities"
```

---

### Task 3: migrácia — monitored_pages + perf_runs + retencia + seed

**Files:**
- Create: `packages/db/supabase/migrations/0036_perf_pages_history.sql`

- [ ] **Step 1: Napíš migráciu**

```sql
-- Per-page PSI monitoring + denná história (Performance overhaul SP1).
-- monitored_pages = entita stránky (homepage auto + ručne pridané); perf_runs =
-- append-only história meraní (skóre + vitals + FCP + CrUX + opportunities).
-- perf_snapshots (latest, per-web) ostáva NEZMENENÉ — psi-probe ho pre homepage
-- naďalej upsertuje kvôli spätnej kompatibilite existujúcich konzumentov.

create table if not exists monitored_pages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  url text not null,                       -- plná URL vrátane https://
  is_homepage boolean not null default false,
  active boolean not null default true,
  added_at timestamptz not null default now(),
  unique (site_id, url)
);

alter table monitored_pages enable row level security;
drop policy if exists "org members read" on monitored_pages;
drop policy if exists "staff write" on monitored_pages;
create policy "org members read" on monitored_pages for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on monitored_pages for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));
grant select, insert, update, delete on monitored_pages to authenticated;
grant all on monitored_pages to service_role;

-- Seed homepage pre každý web (idempotentné). sites.url je plná URL.
insert into monitored_pages (site_id, org_id, url, is_homepage)
  select s.id, s.org_id, s.url, true from sites s
  on conflict (site_id, url) do nothing;

create table if not exists perf_runs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references monitored_pages on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  strategy text not null,                  -- 'mobile' | 'desktop'
  performance_score int, accessibility int, best_practices int, seo int,
  lcp_ms int, fcp_ms int, inp_ms int, cls numeric, tbt_ms int, ttfb_ms int,
  page_weight_kb int, requests int,
  field_lcp_ms int, field_inp_ms int, field_cls numeric,
  opportunities jsonb not null default '[]' check (jsonb_typeof(opportunities) = 'array'),
  measured_at timestamptz not null default now(),
  error text
);
create index if not exists perf_runs_page_strategy_measured_idx
  on perf_runs (page_id, strategy, measured_at desc);

alter table perf_runs enable row level security;
drop policy if exists "org members read" on perf_runs;
drop policy if exists "staff write" on perf_runs;
create policy "org members read" on perf_runs for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on perf_runs for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));
grant select, insert, update, delete on perf_runs to authenticated;
grant all on perf_runs to service_role;

-- Retencia: denné záznamy, drž 1 rok (owner rozhodnutie). Pomenovaný job →
-- re-run migrácie aktualizuje, nezduplikuje.
select cron.schedule('perf_runs_retention', '35 2 * * *', $job$
  delete from perf_runs where measured_at < now() - interval '365 days';
$job$);
```

- [ ] **Step 2: Over idempotenciu (čítaním)**

Skontroluj: `create table if not exists` ×2, `if not exists` index, `insert … on conflict do nothing` (re-run nevloží duplikát homepage), `cron.schedule` upsert podľa mena, RLS policy `drop … if exists` pred `create`. Migrácia je bezpečná na opakované spustenie.

- [ ] **Step 3: Commit** (NEaplikuj na prod — to je krok pri deployi)

```bash
git add packages/db/supabase/migrations/0036_perf_pages_history.sql
git commit -m "feat(db): monitored_pages + perf_runs history + 1y retention (perf SP1)"
```

---

### Task 4: collector — psi-probe iteruje stránky, píše perf_runs (+ homepage back-compat)

**Files:**
- Modify: `tools/psi-probe/index.mjs`

- [ ] **Step 1: Prepíš `run()` + pridaj helper/konštanty**

Nad `run()` pridaj:
```js
const MAX_PAGES_PER_SITE = 10; // cap kvôli času behu (owner-adjustable)
const CONCURRENCY = 4;         // súbežných PSI volaní; PSI to znesie

// concurrency-limited map (worker-pool). Zachová poradie výsledkov.
async function mapLimit(items, limit, fn) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
```

Nahraď celé telo `run()` týmto (zachováva drop-detekciu + perf_snapshots LEN pre homepage):
```js
async function run() {
  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sites = await (await fetch(`${url}/rest/v1/sites?select=id,org_id,url,domain&is_active=eq.true`, { headers: restHeaders(srv) })).json();

  // Baseline pre drop-detekciu (per-web homepage) — nezmenené oproti pôvodnému.
  const baseRows = await (await fetch(`${url}/rest/v1/metric_history?select=site_id,metric,value&metric=in.(perf_mobile,perf_desktop)&order=captured_at.desc`, { headers: restHeaders(srv) })).json();
  const baseline = new Map();
  for (const r of Array.isArray(baseRows) ? baseRows : []) {
    const k = `${r.site_id}|${r.metric}`;
    if (!baseline.has(k) && r.value !== null) baseline.set(k, Number(r.value));
  }

  // Monitorované stránky pre všetky aktívne weby (homepage prvá vďaka order).
  const siteIds = (Array.isArray(sites) ? sites : []).map((s) => s.id);
  const pagesRes = siteIds.length
    ? await (await fetch(`${url}/rest/v1/monitored_pages?select=id,site_id,org_id,url,is_homepage&active=eq.true&site_id=in.(${siteIds.join(',')})&order=is_homepage.desc,added_at.asc`, { headers: restHeaders(srv) })).json()
    : [];
  const pagesBySite = new Map();
  for (const p of Array.isArray(pagesRes) ? pagesRes : []) {
    const arr = pagesBySite.get(p.site_id) ?? [];
    if (arr.length < MAX_PAGES_PER_SITE) arr.push(p);
    else console.log(JSON.stringify({ ev: 'psi.page_cap', site_id: p.site_id, skipped: p.url }));
    pagesBySite.set(p.site_id, arr);
  }

  // Jednotky práce: stránka × stratégia.
  const units = [];
  for (const s of Array.isArray(sites) ? sites : []) {
    for (const p of pagesBySite.get(s.id) ?? []) {
      for (const strategy of ['mobile', 'desktop']) units.push({ s, p, strategy });
    }
  }

  const now = new Date().toISOString();
  const wk = isoWeek(new Date());
  let ok = 0;
  let failed = 0;
  const perfRuns = [];
  const snapshotRows = []; // homepage → perf_snapshots (back-compat)
  const alertRows = [];

  await mapLimit(units, CONCURRENCY, async ({ s, p, strategy }) => {
    const r = await fetchPsi(p.url, KEY, strategy);
    if (r.ok) {
      const x = r.snap;
      perfRuns.push({
        page_id: p.id, org_id: p.org_id, strategy,
        performance_score: x.performanceScore, accessibility: x.accessibility, best_practices: x.bestPractices, seo: x.seo,
        lcp_ms: x.lcpMs, fcp_ms: x.fcpMs, inp_ms: x.inpMs, cls: x.cls, tbt_ms: x.tbtMs, ttfb_ms: x.ttfbMs,
        page_weight_kb: x.pageWeightKb, requests: x.requests,
        field_lcp_ms: x.fieldLcpMs, field_inp_ms: x.fieldInpMs, field_cls: x.fieldCls,
        opportunities: x.opportunities, measured_at: now, error: null,
      });
      ok++;
      console.log(JSON.stringify({ ev: 'psi.ok', url: p.url, strategy, perf: x.performanceScore }));

      if (p.is_homepage) {
        snapshotRows.push({
          site_id: s.id, org_id: s.org_id, strategy,
          performance_score: x.performanceScore, accessibility: x.accessibility, best_practices: x.bestPractices, seo: x.seo,
          lcp_ms: x.lcpMs, inp_ms: x.inpMs, cls: x.cls, tbt_ms: x.tbtMs, ttfb_ms: x.ttfbMs,
          page_weight_kb: x.pageWeightKb, requests: x.requests,
          field_lcp_ms: x.fieldLcpMs, field_inp_ms: x.fieldInpMs, field_cls: x.fieldCls,
          measured_at: now, error: null,
        });
        const meta = PERF_METRIC[strategy];
        const before = baseline.get(`${s.id}|${meta.metric}`);
        const cur = x.performanceScore;
        if (typeof cur === 'number' && typeof before === 'number' && isDrop(before, cur, PERF_DROP_TH)) {
          const dom = s.domain ?? s.url ?? 'web';
          alertRows.push({
            org_id: s.org_id, site_id: s.id, type: 'metric_drop', severity: 'warning',
            title: `${dom}: ${meta.label} kleslo`, body: `${meta.label}: ${Math.round(before)} → ${Math.round(cur)}`,
            dedupe_key: `proactive:${s.id}:${meta.metric}:${wk}`,
          });
        }
      }
    } else {
      perfRuns.push({
        page_id: p.id, org_id: p.org_id, strategy,
        performance_score: null, accessibility: null, best_practices: null, seo: null,
        lcp_ms: null, fcp_ms: null, inp_ms: null, cls: null, tbt_ms: null, ttfb_ms: null,
        page_weight_kb: null, requests: null, field_lcp_ms: null, field_inp_ms: null, field_cls: null,
        opportunities: [], measured_at: now, error: r.error,
      });
      if (p.is_homepage) {
        snapshotRows.push({
          site_id: s.id, org_id: s.org_id, strategy,
          performance_score: null, accessibility: null, best_practices: null, seo: null,
          lcp_ms: null, inp_ms: null, cls: null, tbt_ms: null, ttfb_ms: null,
          page_weight_kb: null, requests: null, field_lcp_ms: null, field_inp_ms: null, field_cls: null,
          measured_at: now, error: r.error,
        });
      }
      failed++;
      console.log(JSON.stringify({ ev: 'psi.fail', url: p.url, strategy, error: r.error }));
    }
  });

  // Batch append do perf_runs (jeden POST).
  if (perfRuns.length) {
    const ins = await fetch(`${url}/rest/v1/perf_runs`, { method: 'POST', headers: { ...restHeaders(srv), Prefer: 'return=minimal' }, body: JSON.stringify(perfRuns) });
    if (!ins.ok) console.log(JSON.stringify({ ev: 'psi.perf_runs_fail', status: ins.status, body: (await ins.text()).slice(0, 200) }));
  }
  // Homepage → perf_snapshots (back-compat, per riadok upsert ako doteraz).
  for (const row of snapshotRows) {
    const up = await fetch(`${url}/rest/v1/perf_snapshots?on_conflict=site_id,strategy`, { method: 'POST', headers: { ...restHeaders(srv), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
    if (!up.ok) console.log(JSON.stringify({ ev: 'psi.upsert_fail', status: up.status, body: (await up.text()).slice(0, 200) }));
  }
  await raiseAlerts(url, srv, alertRows, 'psi.alerts_fail');
  console.log(JSON.stringify({ ev: 'psi.done', ok, failed, runs: perfRuns.length, alerts: alertRows.length }));
  return { ok, failed };
}
```

- [ ] **Step 2: Odstráň nepoužité**

Ak `sleep` import/definícia zostane nepoužitá (per-call sleep sme nahradili concurrency-limitom), odstráň ju. Skontroluj, že `isoWeek`, `isDrop`, `fetchPsi`, `raiseAlerts`, `restHeaders`, `KEY`, `PERF_METRIC`, `PERF_DROP_TH` sú stále importované/definované (používajú sa).

- [ ] **Step 3: node --check**

Run: `node --check tools/psi-probe/index.mjs`
Expected: bez výstupu (OK).

- [ ] **Step 4: Commit**

```bash
git add tools/psi-probe/index.mjs
git commit -m "feat(psi): per-page perf_runs history; homepage keeps perf_snapshots (SP1)"
```

---

### Task 5: Finálne overenie + poznámky k nasadeniu

- [ ] **Step 1: Celá suita + lint + node --check**

Run:
```bash
pnpm -r test && pnpm -r lint && pnpm --filter @agency/core build && node --check tools/psi-probe/index.mjs
```
Expected: testy zelené (vrátane nových psi.test), lint bez errorov (pre-existing web font warning OK), build OK, node --check OK.

- [ ] **Step 2: Dry-run parseru proti reálnym dátam (mimo commitu)**

V scratchpade napíš skript, čo pre `https://soccercoacheshub.com` a `https://natur-life.sk` zavolá PSI (potrebuje PSI_API_KEY z env alebo z workflow logu) a cez `parsePsi` vypíše `fcpMs` + počet a top opportunities. Cieľ: potvrdiť, že FCP je číslo a opportunities sa extrahujú z reálneho Lighthouse výstupu. Skript nekomituj. (Ak PSI kľúč nie je po ruke, preskoč — overí sa to pri prvom prod behu.)

- [ ] **Step 3: Deployment (až na „go")**

Poradie (ako 0034/0035): kód najprv, potom DB.
1. `git push origin main` — collector + core (psi-probe.yml už builduje core). Web/Worker sa netýka.
2. **Migrácia 0036** cez pg pooler (session pooler, port 5432) — vytvorí `monitored_pages` (+ seed homepage), `perf_runs`, retenciu.
3. Manuálny psi beh (Actions → „psi-probe" → Run workflow), potom over:
   - `perf_runs` má riadky per stránka×stratégia (zatiaľ len homepage, kým SP3 nepridá ďalšie), s vyplneným `fcp_ms` a `opportunities`.
   - `perf_snapshots` homepage má čerstvý `measured_at` (back-compat drží).
   - Žiadny existujúci report/alert/UI sa nezmenil.

---

## Poznámky
- Bez migrácie sa `perf_runs` insert v collectore nezapíše (tabuľka neexistuje) → beh by logoval `psi.perf_runs_fail`, ale `perf_snapshots` (homepage) by stále fungoval. Preto poradie: migráciu aplikuj hneď po push, pred (alebo tesne pri) prvom behu.
- SP1 nepridáva žiadny nový secret ani workflow. Worker sa nemení.
- Ďalšie stránky (nad homepage) sa merať začnú, keď ich SP3 UI (alebo ručný SQL insert do `monitored_pages`) pridá.
