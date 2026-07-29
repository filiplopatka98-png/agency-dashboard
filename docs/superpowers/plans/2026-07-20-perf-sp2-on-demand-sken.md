# Performance SP2 — on-demand PSI sken — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worker `/scan` endpoint, čo na požiadanie (autentifikovaný admin) premeria jednu stránku+stratégiu cez PSI, zapíše `perf_runs` a stav do `scan_jobs`, s rate-limitom 60 s.

**Architecture:** Zdieľaný builder `perf_runs` riadku v core (DRY medzi collectorom a Workerom). Nová `scan_jobs` tabuľka (in-flight zámok + stav pre UI). Worker `/scan` reuse ES256 auth z `trigger.ts`, spustí PSI na pozadí (`ctx.waitUntil`). On-demand píše LEN `perf_runs` (žiadny perf_snapshots, žiadne alerty).

**Tech Stack:** Cloudflare Worker (TS), `@agency/core` (parsePsi/fetchPsi + builder), vitest + fake Supabase, Supabase/PostgREST.

Spec: `docs/superpowers/specs/2026-07-20-perf-sp2-on-demand-sken-design.md`. Stavia na SP1.

---

### Task 1: core — zdieľaný `perfRunRow` builder + prepoj collector

**Files:**
- Create: `packages/core/src/perfRow.ts`
- Test: `packages/core/src/perfRow.test.ts`
- Modify: `packages/core/src/index.ts` (barrel)
- Modify: `tools/psi-probe/index.mjs` (použi builder)

- [ ] **Step 1: Write the failing test** (`perfRow.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { perfRunRow } from './perfRow';
import type { PerfSnap } from './psi';

const snap: PerfSnap = {
  performanceScore: 90, accessibility: 92, bestPractices: 100, seo: 88,
  lcpMs: 2300, fcpMs: 2000, inpMs: 120, cls: 0.01, tbtMs: 150, ttfbMs: 300,
  pageWeightKb: 1024, requests: 42,
  fieldLcpMs: 2500, fieldInpMs: 130, fieldCls: 0.02,
  opportunities: [{ id: 'unused-js', title: 'X', savingsMs: 900, savingsBytes: null, score: 0.2 }],
};

describe('perfRunRow', () => {
  it('poskladá perf_runs riadok z PerfSnap (bez measured_at/error)', () => {
    const row = perfRunRow(snap, { id: 'page-1', org_id: 'org-1' }, 'mobile');
    expect(row).toEqual({
      page_id: 'page-1', org_id: 'org-1', strategy: 'mobile',
      performance_score: 90, accessibility: 92, best_practices: 100, seo: 88,
      lcp_ms: 2300, fcp_ms: 2000, inp_ms: 120, cls: 0.01, tbt_ms: 150, ttfb_ms: 300,
      page_weight_kb: 1024, requests: 42,
      field_lcp_ms: 2500, field_inp_ms: 130, field_cls: 0.02,
      opportunities: [{ id: 'unused-js', title: 'X', savingsMs: 900, savingsBytes: null, score: 0.2 }],
    });
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm --filter @agency/core exec vitest run src/perfRow.test.ts`
Expected: FAIL — `perfRow` module missing.

- [ ] **Step 3: Implement** (`perfRow.ts`)

```ts
import type { PerfSnap, PsiOpportunity } from './psi.js';

// Riadok pre `perf_runs` (bez `measured_at`/`error` — tie dopĺňa volajúci per
// beh). ZDIEĽANÝ medzi denným collectorom (tools/psi-probe) a on-demand skenom
// (Worker /scan), nech oba produkujú IDENTICKÝ tvar a nedivergujú.
export interface PerfRunRow {
  page_id: string;
  org_id: string;
  strategy: string;
  performance_score: number | null;
  accessibility: number | null;
  best_practices: number | null;
  seo: number | null;
  lcp_ms: number | null;
  fcp_ms: number | null;
  inp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  ttfb_ms: number | null;
  page_weight_kb: number | null;
  requests: number | null;
  field_lcp_ms: number | null;
  field_inp_ms: number | null;
  field_cls: number | null;
  opportunities: PsiOpportunity[];
}

export function perfRunRow(snap: PerfSnap, page: { id: string; org_id: string }, strategy: string): PerfRunRow {
  return {
    page_id: page.id,
    org_id: page.org_id,
    strategy,
    performance_score: snap.performanceScore,
    accessibility: snap.accessibility,
    best_practices: snap.bestPractices,
    seo: snap.seo,
    lcp_ms: snap.lcpMs,
    fcp_ms: snap.fcpMs,
    inp_ms: snap.inpMs,
    cls: snap.cls,
    tbt_ms: snap.tbtMs,
    ttfb_ms: snap.ttfbMs,
    page_weight_kb: snap.pageWeightKb,
    requests: snap.requests,
    field_lcp_ms: snap.fieldLcpMs,
    field_inp_ms: snap.fieldInpMs,
    field_cls: snap.fieldCls,
    opportunities: snap.opportunities,
  };
}
```

Do `packages/core/src/index.ts` pridaj:
```ts
export { perfRunRow, type PerfRunRow } from './perfRow';
```

- [ ] **Step 4: Run — verify pass + build**

Run: `pnpm --filter @agency/core exec vitest run src/perfRow.test.ts && pnpm --filter @agency/core build`
Expected: PASS, build OK (`dist/perfRow.js` existuje).

- [ ] **Step 5: Prepoj collector na builder**

V `tools/psi-probe/index.mjs`: pridaj import
```js
import { perfRunRow } from '../../packages/core/dist/perfRow.js';
```
V úspešnej vetve nahraď inline `perfRuns.push({ page_id: p.id, … opportunities: x.opportunities, measured_at: now, error: null })` za:
```js
      perfRuns.push({ ...perfRunRow(x, p, strategy), measured_at: now, error: null });
```
(Fail-path null riadok NEmeň — builder je len pre úspech.)

Run: `node --check tools/psi-probe/index.mjs`
Expected: OK.

- [ ] **Step 6: Full core test + commit**

Run: `pnpm --filter @agency/core test`
Expected: green.
```bash
git add packages/core/src/perfRow.ts packages/core/src/perfRow.test.ts packages/core/src/index.ts tools/psi-probe/index.mjs
git commit -m "feat(core): shared perfRunRow builder; psi-probe uses it (SP2)"
```

---

### Task 2: migrácia 0037 — scan_jobs + retencia

**Files:**
- Create: `packages/db/supabase/migrations/0037_scan_jobs.sql`

- [ ] **Step 1: Napíš migráciu**

```sql
-- On-demand PSI sken (Performance SP2). scan_jobs = stav manuálneho skenu:
-- in-flight zámok proti dvojkliku + rate-limit (60 s) + status pre UI polling.
-- Worker (/scan) píše service_role; UI číta cez JWT (org members read).

create table if not exists scan_jobs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references monitored_pages on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  strategy text not null,                  -- 'mobile' | 'desktop'
  status text not null default 'pending',  -- 'pending' | 'done' | 'error'
  error text,
  requested_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists scan_jobs_page_strategy_requested_idx
  on scan_jobs (page_id, strategy, requested_at desc);

alter table scan_jobs enable row level security;
drop policy if exists "org members read" on scan_jobs;
drop policy if exists "staff write" on scan_jobs;
create policy "org members read" on scan_jobs for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on scan_jobs for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));
grant select, insert, update, delete on scan_jobs to authenticated;
grant all on scan_jobs to service_role;

-- Retencia: len operačné stavy, drž 7 dní. Pomenovaný job → re-run migrácie aktualizuje.
select cron.schedule('scan_jobs_retention', '45 2 * * *', $job$
  delete from scan_jobs where requested_at < now() - interval '7 days';
$job$);
```

- [ ] **Step 2: Over idempotenciu (čítaním)** — `create table if not exists`, `if not exists` index, RLS `drop policy if exists` + create, `cron.schedule` podľa mena. OK.

- [ ] **Step 3: Commit** (auto-aplikuje sa cez migrate.yml pri deployi)

```bash
git add packages/db/supabase/migrations/0037_scan_jobs.sql
git commit -m "feat(db): scan_jobs table for on-demand PSI scan (SP2)"
```

---

### Task 3: Worker — zdieľaný `authenticateAdmin` helper

**Files:**
- Modify: `apps/scheduler/src/trigger.ts` (extrahuj + exportuj auth; refaktor triggerJob)

- [ ] **Step 1: Pridaj exportovaný helper do `trigger.ts`**

Nad `triggerJob` pridaj (používa existujúce `verifyJwt` + `isOwnerOrStaff` v tom istom súbore):
```ts
// Overí prihláseného admina (owner/staff) z Bearer JWT. Vráti `{ sub }` alebo
// `Response` s chybou (401) — jednotné pre /trigger aj /scan (DRY, rovnaký
// fail-closed vzor). `role: 'authenticated'` je len globálna Supabase rola;
// appková autorizácia žije v `memberships` cez `sub` (user id).
export async function authenticateAdmin(request: Request, env: Env): Promise<{ sub: string } | { error: Response }> {
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = token ? await verifyJwt(token, env) : null;
  if (!payload || payload.role !== 'authenticated' || typeof payload.sub !== 'string' || !payload.sub) {
    return { error: json({ error: 'Neplatný alebo expirovaný token.' }, 401) };
  }
  if (!(await isOwnerOrStaff(env, payload.sub))) {
    return { error: json({ error: 'Účet nemá owner/staff oprávnenie.' }, 401) };
  }
  return { sub: payload.sub };
}
```

- [ ] **Step 2: Refaktor `triggerJob` nech ho použije**

V `triggerJob` nahraď blok od `const auth = request.headers.get('Authorization')` po `if (!(await isOwnerOrStaff(env, payload.sub))) { return json(... 401); }` za:
```ts
  const authed = await authenticateAdmin(request, env);
  if ('error' in authed) return authed.error;
```
A ďalej používaj `authed.sub` namiesto `payload.sub` (v `trigger.ok` logu). Zvyšok (GH dispatch) nemeň.

- [ ] **Step 3: Overenie**

Run: `pnpm --filter @agency/scheduler typecheck && pnpm --filter @agency/scheduler test`
Expected: čisté, existujúce testy zelené (správanie /trigger nezmenené).

- [ ] **Step 4: Commit**

```bash
git add apps/scheduler/src/trigger.ts
git commit -m "refactor(scheduler): shared authenticateAdmin for /trigger + /scan (SP2)"
```

---

### Task 4: Worker — `/scan` endpoint (`runScan.ts`) + wiring + PSI_API_KEY

**Files:**
- Create: `apps/scheduler/src/runScan.ts`
- Test: `apps/scheduler/src/runScan.test.ts`
- Modify: `apps/scheduler/src/env.ts` (PSI_API_KEY)
- Modify: `apps/scheduler/src/index.ts` (route + ctx)

- [ ] **Step 1: Pridaj `PSI_API_KEY` do `Env`** (`env.ts`), za `RESEND_API_KEY`:
```ts
  PSI_API_KEY: string;
```

- [ ] **Step 2: Write the failing test** (`runScan.test.ts`)

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleScan } from './runScan';
import { fakeSupabase, type FakeStore } from './fakeSupabase';
import type { Env } from './env';

const env = { PSI_API_KEY: 'k' } as Env;
const PAGE = { id: 'page-1', org_id: 'org-1', url: 'https://x.sk', active: true };
function store(): FakeStore {
  return { alerts: [], job_runs: [], organizations: [{ id: 'org-1' }], monitored_pages: [PAGE], scan_jobs: [], perf_runs: [] };
}
function req(body: unknown) {
  return new Request('https://w/scan', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) });
}
const okAuth = async () => ({ sub: 'u1' } as const);
const collectWaitUntil = () => { const ps: Promise<unknown>[] = []; return { ctx: { waitUntil: (p: Promise<unknown>) => ps.push(p) }, done: () => Promise.all(ps) }; };

describe('handleScan', () => {
  it('zlá strategy → 400', async () => {
    const s = store();
    const res = await handleScan(req({ page_id: 'page-1', strategy: 'x' }), env, { waitUntil() {} }, { supabase: fakeSupabase(s), auth: okAuth });
    expect(res.status).toBe(400);
  });
  it('neznáma page → 404', async () => {
    const s = store(); s.monitored_pages = [];
    const res = await handleScan(req({ page_id: 'nope', strategy: 'mobile' }), env, { waitUntil() {} }, { supabase: fakeSupabase(s), auth: okAuth });
    expect(res.status).toBe(404);
  });
  it('in-flight (pending) → 429', async () => {
    const s = store(); s.scan_jobs = [{ id: 'j0', page_id: 'page-1', org_id: 'org-1', strategy: 'mobile', status: 'pending', requested_at: new Date().toISOString() }];
    const res = await handleScan(req({ page_id: 'page-1', strategy: 'mobile' }), env, { waitUntil() {} }, { supabase: fakeSupabase(s), auth: okAuth });
    expect(res.status).toBe(429);
  });
  it('happy path → 202 + scan_job pending + po dobehnutí done + perf_runs riadok', async () => {
    const s = store();
    const { ctx, done } = collectWaitUntil();
    const fakePsi = async () => ({ ok: true as const, snap: { performanceScore: 90, accessibility: 90, bestPractices: 100, seo: 90, lcpMs: 2000, fcpMs: 1800, inpMs: 100, cls: 0.01, tbtMs: 100, ttfbMs: 200, pageWeightKb: 500, requests: 30, fieldLcpMs: null, fieldInpMs: null, fieldCls: null, opportunities: [] } });
    const res = await handleScan(req({ page_id: 'page-1', strategy: 'mobile' }), env, ctx, { supabase: fakeSupabase(s), auth: okAuth, fetchPsi: fakePsi });
    expect(res.status).toBe(202);
    expect(s.scan_jobs).toHaveLength(1);
    await done();
    expect(s.scan_jobs[0]!.status).toBe('done');
    expect(s.perf_runs).toHaveLength(1);
    expect(s.perf_runs[0]!.performance_score).toBe(90);
  });
  it('PSI zlyhá → scan_job error, žiadny perf_runs', async () => {
    const s = store();
    const { ctx, done } = collectWaitUntil();
    const failPsi = async () => ({ ok: false as const, error: 'psi 500' });
    await handleScan(req({ page_id: 'page-1', strategy: 'mobile' }), env, ctx, { supabase: fakeSupabase(s), auth: okAuth, fetchPsi: failPsi });
    await done();
    expect(s.scan_jobs[0]!.status).toBe('error');
    expect(s.perf_runs).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Rozšír `fakeSupabase.ts`** — pridaj do `FakeStore` typu polia `monitored_pages`, `scan_jobs`, `perf_runs` (ako `Record<string, unknown>[]`), ak tam nie sú. (Fake už modeluje select/insert/update/order/eq — over, že podporuje `.update().eq()` a `.insert().select()`. Ak `insert` nevie vrátiť vložený riadok so `select('id')`, doplň minimálnu podporu.)

- [ ] **Step 4: Implement** (`runScan.ts`)

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateAdmin } from './trigger';
import { serviceClient } from './supabase';
import { perfRunRow, fetchPsi as coreFetchPsi } from '@agency/core';
import type { Env } from './env';

const RATE_LIMIT_MS = 60_000;

type Ctx = { waitUntil(p: Promise<unknown>): void };
type Deps = {
  supabase?: SupabaseClient;
  auth?: (request: Request, env: Env) => Promise<{ sub: string } | { error: Response }>;
  fetchPsi?: typeof coreFetchPsi;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleScan(request: Request, env: Env, ctx: Ctx, deps: Deps = {}): Promise<Response> {
  if (!env.PSI_API_KEY) return json({ error: 'On-demand sken nie je nakonfigurovaný (chýba PSI_API_KEY).' }, 503);
  const supabase = deps.supabase ?? serviceClient(env);
  const authenticate = deps.auth ?? authenticateAdmin;
  const fetchPsi = deps.fetchPsi ?? coreFetchPsi;

  const authed = await authenticate(request, env);
  if ('error' in authed) return authed.error;

  let body: { page_id?: string; strategy?: string } = {};
  try { body = (await request.json()) as typeof body; } catch { /* ignore */ }
  const strategy = body.strategy;
  if (strategy !== 'mobile' && strategy !== 'desktop') return json({ error: 'Neplatná strategy (mobile|desktop).' }, 400);
  if (!body.page_id) return json({ error: 'Chýba page_id.' }, 400);

  const { data: page } = await supabase
    .from('monitored_pages').select('id, org_id, url, active').eq('id', body.page_id).maybeSingle();
  if (!page || page.active === false) return json({ error: 'Stránka neexistuje alebo je neaktívna.' }, 404);

  // Rate-limit: najnovší scan_job pre (page, strategy) — pending alebo < 60 s → 429.
  const { data: last } = await supabase
    .from('scan_jobs').select('status, requested_at').eq('page_id', page.id).eq('strategy', strategy)
    .order('requested_at', { ascending: false }).limit(1).maybeSingle();
  if (last && (last.status === 'pending' || Date.now() - Date.parse(last.requested_at) < RATE_LIMIT_MS)) {
    return json({ error: 'Sken pre túto stránku práve beží alebo dobehol pred chvíľou. Skús o chvíľu.' }, 429);
  }

  const { data: job, error: insErr } = await supabase
    .from('scan_jobs').insert({ page_id: page.id, org_id: page.org_id, strategy, status: 'pending' }).select('id').single();
  if (insErr || !job) return json({ error: 'Nepodarilo sa spustiť sken.' }, 500);

  ctx.waitUntil(performScan(env, supabase, fetchPsi, page, strategy, job.id));
  return json({ job_id: job.id, status: 'pending' }, 202);
}

async function performScan(
  env: Env,
  supabase: SupabaseClient,
  fetchPsi: typeof coreFetchPsi,
  page: { id: string; org_id: string; url: string },
  strategy: 'mobile' | 'desktop',
  jobId: string,
): Promise<void> {
  try {
    const r = await fetchPsi(page.url, env.PSI_API_KEY, strategy);
    if (r.ok) {
      await supabase.from('perf_runs').insert({ ...perfRunRow(r.snap, page, strategy), measured_at: new Date().toISOString(), error: null });
      await supabase.from('scan_jobs').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', jobId);
    } else {
      // Zlyhanie PSI = žiadne dáta → NEpíš perf_runs (manuálny sken nezanáša
      // históriu chybami). Len stav pre UI. Zero-fabrication.
      await supabase.from('scan_jobs').update({ status: 'error', error: r.error, finished_at: new Date().toISOString() }).eq('id', jobId);
    }
  } catch (e) {
    await supabase.from('scan_jobs').update({ status: 'error', error: String((e as Error)?.message ?? e), finished_at: new Date().toISOString() }).eq('id', jobId);
  }
}
```

- [ ] **Step 5: Wire route + ctx v `index.ts`**

Import:
```ts
import { handleScan } from './runScan';
```
V `CORS` nie je zmena. Uprav `fetch` signatúru na `async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>` a pridaj vetvy (za `/trigger` blok, pred `return new Response('Monitorix scheduler'…)`):
```ts
    if (request.method === 'OPTIONS' && url.pathname === '/scan') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'POST' && url.pathname === '/scan') {
      const res = await handleScan(request, env, ctx);
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @agency/scheduler test && pnpm --filter @agency/scheduler typecheck && pnpm --filter @agency/core build`
Expected: green (nové runScan testy + existujúce), typecheck čistý.

- [ ] **Step 7: Commit**

```bash
git add apps/scheduler/src/runScan.ts apps/scheduler/src/runScan.test.ts apps/scheduler/src/env.ts apps/scheduler/src/index.ts apps/scheduler/src/fakeSupabase.ts
git commit -m "feat(scheduler): POST /scan on-demand PSI scan endpoint (SP2)"
```

---

### Task 5: Finálne overenie + nasadenie

- [ ] **Step 1: Celá suita + lint + typecheck**

Run: `pnpm -r test && pnpm -r lint && pnpm --filter @agency/scheduler typecheck && node --check tools/psi-probe/index.mjs`
Expected: všetko zelené (pre-existing web font warning OK).

- [ ] **Step 2: Deployment (až na „go")**

1. `git push origin main` — core builder + collector + migrácia 0037. **migrate.yml** aplikuje 0037 sám (scan_jobs).
2. **`PSI_API_KEY` ako Worker secret** — owner cez Cloudflare dashboard → Worker `agency-dashboard-scheduler` → Settings → Variables and Secrets → Add `PSI_API_KEY` (hodnota z Google Cloud console). Jednorazovo.
3. **Worker deploy** cez `v*` tag (deploy.yml) — bundluje `/scan`.
4. Over: `curl -X POST .../scan` bez tokenu → 401; s platným admin JWT + `{page_id,strategy}` → 202 a po ~2 min `scan_jobs` done + nový `perf_runs` riadok (skontroluje sa v SP3 UI, alebo dočasne cez read).

---

## Poznámky
- On-demand sken NEspúšťa `metric_drop` alerty ani nepíše `perf_snapshots` — to ostáva dennému zberu (owner rozhodnutie).
- Bez `PSI_API_KEY` secretu `/scan` vráti 503 (fail-closed, ako `/trigger` bez GH tokenu).
- UI button + polling = SP3.
