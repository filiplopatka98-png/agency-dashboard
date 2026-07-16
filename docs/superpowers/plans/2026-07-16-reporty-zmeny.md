# Reporty „čo sa zmenilo za obdobie" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weekly (admin) and monthly (client + admin) reports show what actually happened in the period — updates, fixes, score gains, caught outages — rendered in human Slovak for clients and terse technical lines for admin.

**Architecture:** Diff-at-measurement: each collector compares the previous stored snapshot with the incoming one *before* overwriting it, and writes structured events (`kind` + `payload jsonb`) into the existing `change_log`. Language is composed at render time by pure functions in `@agency/core`, so the same event yields a client sentence or an admin line. A new `work_log` table holds the operator's manual diary entries. Reports read events + diary + incidents + uptime rollups and render per audience.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, Supabase (Postgres + RLS), Cloudflare Workers (scheduler), Node collectors under `tools/`, Next.js static export (web).

**Spec:** `docs/superpowers/specs/2026-07-16-reporty-zmeny-design.md`

## Global Constraints

- **Zero fabricated data.** Every number and claim must come from a real measurement. If a value is unknown, say so — never estimate, never fill a gap.
- **User-facing text is Slovak. Code, identifiers and git commit messages are English.** Commit style: `typ(scope): vec`.
- **Performance threshold stays ±10 points.** PageSpeed varies ~±5 between runs on the same site; a lower threshold would report invented "speed-ups". AEO/Security use ±3 (deterministic checks).
- **Monthly report always goes out on the 1st**, cron `0 7 1 * *`, covering the previous full calendar month. **Do not change this cron.** Weekly digest stays Monday 08:00 UTC.
- **First ingest produces zero events.** With no previous snapshot, diffing must return `[]` — never log the whole plugin list as "updated".
- **A diff failure must never break its collector.** Log and continue; the snapshot write still succeeds.
- **Client audience never sees regressions**: `direction:'new'` (cve/seo) and `direction:'down'` (score) are admin-only.
- **The public status page must never expose** software versions, CVEs, SEO issues, scores, or diary text.
- Migrations are idempotent. New tables get RLS: `org members read` (`private.user_orgs()`) + `staff write` (`private.user_write_orgs()`), plus grants to `authenticated` and `service_role`.
- Core tests run with `pnpm --filter @agency/core test` (vitest, tests live beside source as `*.test.ts`).

---

## File Structure

**Create:**
- `packages/db/supabase/migrations/0022_report_events.sql` — `change_log.payload` + `work_log`
- `packages/db/supabase/migrations/0023_public_status_incidents.sql` — extend public RPC
- `packages/core/src/events.ts` — event types + pure diff functions
- `packages/core/src/events.test.ts`
- `packages/core/src/reportText.ts` — audience filter + Slovak renderers + label maps
- `packages/core/src/reportText.test.ts`
- `packages/core/src/clientReport.ts` — client monthly report renderer
- `packages/core/src/clientReport.test.ts`
- `apps/web/app/sites/TabDiary.tsx` — diary UI (own file; `sites/page.tsx` is already 1111 lines)

**Modify:**
- `packages/core/src/index.ts` — exports
- `packages/db/src/types.generated.ts` — `work_log`, `change_log.payload`
- `apps/scheduler/src/wpIngest.ts` — diff core+plugins before upsert
- `tools/wp-cve/index.mjs` — diff vulns
- `tools/seo-crawl/index.mjs` — diff issues
- `tools/history-snapshot/index.mjs` — scores only, thresholds, payload
- `tools/monthly-report/index.mjs` — client report wiring
- `apps/web/app/sites/page.tsx` — register Denník tab
- `apps/web/app/status/[slug]/StatusClient.tsx` — incident history + vigilance

---

### Task 1: Migration — `change_log.payload` + `work_log`

**Files:**
- Create: `packages/db/supabase/migrations/0022_report_events.sql`
- Modify: `packages/db/src/types.generated.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `change_log.payload jsonb` (nullable); table `work_log(id bigint, org_id uuid, site_id uuid NOT NULL, happened_at date, text text, created_at timestamptz)`

- [ ] **Step 1: Write the migration**

```sql
-- Štruktúrované fakty k udalostiam (jazyk sa skladá až pri renderovaní) +
-- pracovný denník operátora (manuálne záznamy o vykonanej práci).

alter table change_log add column if not exists payload jsonb;

create table if not exists work_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations on delete cascade,
  site_id uuid not null references sites on delete cascade,
  happened_at date not null default current_date,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists work_log_site_happened_idx on work_log (site_id, happened_at desc);

alter table work_log enable row level security;
drop policy if exists "org members read" on work_log;
drop policy if exists "staff write" on work_log;
create policy "org members read" on work_log for select using (org_id in (select private.user_orgs()));
create policy "staff write" on work_log for all using (org_id in (select private.user_write_orgs())) with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on work_log to authenticated;
grant all on work_log to service_role;
```

Note: `work_log` intentionally has **no retention job** — it records performed work.

- [ ] **Step 2: Add the types**

In `packages/db/src/types.generated.ts`, inside `change_log`, add `payload: Json | null` to `Row` and `payload?: Json | null` to `Insert` and `Update`. Then add a `work_log` table entry next to `change_log` (alphabetical position is not enforced in this file):

```ts
      work_log: {
        Row: {
          created_at: string
          happened_at: string
          id: number
          org_id: string
          site_id: string
          text: string
        }
        Insert: {
          created_at?: string
          happened_at?: string
          id?: never
          org_id: string
          site_id: string
          text: string
        }
        Update: {
          created_at?: string
          happened_at?: string
          id?: never
          org_id?: string
          site_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_log_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm --filter @agency/db typecheck && pnpm --filter web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/supabase/migrations/0022_report_events.sql packages/db/src/types.generated.ts
git commit -m "feat(db): change_log.payload + work_log table"
```

---

### Task 2: `core/events.ts` — event types + diff functions

**Files:**
- Create: `packages/core/src/events.ts`, `packages/core/src/events.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type EventKind = 'update' | 'cve' | 'seo' | 'score'`
  - `type Severity = 'info' | 'warning' | 'critical'`
  - `interface ChangeEvent { kind: EventKind; severity: Severity; message: string; payload: EventPayload }`
  - `interface UpdatePayload { target: 'plugin'|'core'; name: string; slug: string; from: string; to: string }`
  - `interface CvePayload { direction: 'fixed'|'new'; cve: string|null; target: string; severity: string }`
  - `interface SeoPayload { direction: 'fixed'|'new'; type: string; was_count: number }`
  - `interface ScorePayload { metric: string; from: number; to: number; direction: 'up'|'down' }`
  - `diffCore(prev, next): ChangeEvent[]`, `diffPlugins(prev, next): ChangeEvent[]`, `diffVulns(prev, next): ChangeEvent[]`, `diffSeoIssues(prev, next): ChangeEvent[]`
  - `interface PluginInfo { name: string; slug: string; version: string }`
  - `interface VulnInfo { cve: string|null; target: string; slug: string; title: string; severity: string }`
  - `interface SeoIssueInfo { type: string; count: number }`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffCore, diffPlugins, diffVulns, diffSeoIssues, type PluginInfo, type VulnInfo } from './events';

const plugin = (o: Partial<PluginInfo>): PluginInfo => ({ name: 'WooCommerce', slug: 'woocommerce', version: '5.1', ...o });
const vuln = (o: Partial<VulnInfo>): VulnInfo => ({ cve: 'CVE-2024-1', target: 'WooCommerce', slug: 'woocommerce', title: 'XSS', severity: 'high', ...o });

describe('diffCore', () => {
  it('zmena verzie → update udalosť', () => {
    const [ev] = diffCore('6.4', '6.5');
    expect(ev.kind).toBe('update');
    expect(ev.severity).toBe('info');
    expect(ev.payload).toEqual({ target: 'core', name: 'WordPress', slug: 'wordpress', from: '6.4', to: '6.5' });
  });
  it('prvý ingest (prev null) → žiadne udalosti', () => {
    expect(diffCore(null, '6.5')).toEqual([]);
  });
  it('bez zmeny → žiadne udalosti', () => {
    expect(diffCore('6.5', '6.5')).toEqual([]);
  });
});

describe('diffPlugins', () => {
  it('prvý ingest → žiadne udalosti (nelogujeme celý zoznam)', () => {
    expect(diffPlugins(null, [plugin({}), plugin({ slug: 'yoast', name: 'Yoast' })])).toEqual([]);
  });
  it('zmena verzie → update udalosť', () => {
    const evs = diffPlugins([plugin({ version: '5.1' })], [plugin({ version: '5.4' })]);
    expect(evs).toHaveLength(1);
    expect(evs[0].payload).toEqual({ target: 'plugin', name: 'WooCommerce', slug: 'woocommerce', from: '5.1', to: '5.4' });
  });
  it('nový plugin sa v1 ignoruje', () => {
    expect(diffPlugins([plugin({})], [plugin({}), plugin({ slug: 'yoast', name: 'Yoast' })])).toEqual([]);
  });
  it('bez zmeny → nič', () => {
    expect(diffPlugins([plugin({})], [plugin({})])).toEqual([]);
  });
});

describe('diffVulns', () => {
  it('prvý beh → nič', () => {
    expect(diffVulns(null, [vuln({})])).toEqual([]);
  });
  it('CVE zmizla → fixed (info)', () => {
    const [ev] = diffVulns([vuln({})], []);
    expect(ev.kind).toBe('cve');
    expect(ev.severity).toBe('info');
    expect(ev.payload).toMatchObject({ direction: 'fixed', cve: 'CVE-2024-1', target: 'WooCommerce', severity: 'high' });
  });
  it('CVE pribudla → new (critical)', () => {
    const [ev] = diffVulns([], [vuln({})]);
    expect(ev.severity).toBe('critical');
    expect(ev.payload).toMatchObject({ direction: 'new' });
  });
  it('CVE bez id sa páruje podľa title', () => {
    expect(diffVulns([vuln({ cve: null })], [vuln({ cve: null })])).toEqual([]);
  });
});

describe('diffSeoIssues', () => {
  it('prvý beh → nič', () => {
    expect(diffSeoIssues(null, [{ type: 'Duplicitný title', count: 3 }])).toEqual([]);
  });
  it('typ zmizol → fixed s pôvodným počtom', () => {
    const [ev] = diffSeoIssues([{ type: 'Duplicitný title', count: 12 }], []);
    expect(ev.payload).toEqual({ direction: 'fixed', type: 'Duplicitný title', was_count: 12 });
    expect(ev.severity).toBe('info');
  });
  it('typ pribudol → new (warning)', () => {
    const [ev] = diffSeoIssues([], [{ type: 'Duplicitný title', count: 2 }]);
    expect(ev.payload).toMatchObject({ direction: 'new' });
    expect(ev.severity).toBe('warning');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agency/core test events`
Expected: FAIL — `Failed to resolve import "./events"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/events.ts`:

```ts
// Udalosti „čo sa zmenilo" — štruktúrované fakty. Diff funkcie sú čisté (bez I/O),
// aby sa dali testovať a volať z ktoréhokoľvek collectora. Jazyk sa skladá až
// v reportText.ts — tu je len `message` pre admina.

export type EventKind = 'update' | 'cve' | 'seo' | 'score';
export type Severity = 'info' | 'warning' | 'critical';

export interface UpdatePayload { target: 'plugin' | 'core'; name: string; slug: string; from: string; to: string }
export interface CvePayload { direction: 'fixed' | 'new'; cve: string | null; target: string; severity: string }
export interface SeoPayload { direction: 'fixed' | 'new'; type: string; was_count: number }
export interface ScorePayload { metric: string; from: number; to: number; direction: 'up' | 'down' }
export type EventPayload = UpdatePayload | CvePayload | SeoPayload | ScorePayload;

export interface ChangeEvent {
  kind: EventKind;
  severity: Severity;
  message: string; // admin riadok (ukladá sa do change_log.message)
  payload: EventPayload;
}

export interface PluginInfo { name: string; slug: string; version: string }
export interface VulnInfo { cve: string | null; target: string; slug: string; title: string; severity: string }
export interface SeoIssueInfo { type: string; count: number }

// prev == null → prvý ingest: zámerne nič, inak by sme nahlásili celý stav ako zmenu.
export function diffCore(prev: string | null | undefined, next: string | null | undefined): ChangeEvent[] {
  if (!prev || !next || prev === next) return [];
  return [{
    kind: 'update',
    severity: 'info',
    message: `WordPress ${prev} → ${next}`,
    payload: { target: 'core', name: 'WordPress', slug: 'wordpress', from: prev, to: next },
  }];
}

export function diffPlugins(prev: PluginInfo[] | null | undefined, next: PluginInfo[]): ChangeEvent[] {
  if (!prev) return [];
  const before = new Map(prev.map((p) => [p.slug, p]));
  const out: ChangeEvent[] = [];
  for (const p of next) {
    const old = before.get(p.slug);
    if (!old || !old.version || !p.version) continue; // nový plugin → v1 ignoruje (YAGNI)
    if (old.version === p.version) continue;
    out.push({
      kind: 'update',
      severity: 'info',
      message: `${p.name} ${old.version} → ${p.version}`,
      payload: { target: 'plugin', name: p.name, slug: p.slug, from: old.version, to: p.version },
    });
  }
  return out;
}

const vulnKey = (v: VulnInfo) => `${v.cve ?? v.title}|${v.slug}`;

export function diffVulns(prev: VulnInfo[] | null | undefined, next: VulnInfo[]): ChangeEvent[] {
  if (!prev) return [];
  const before = new Map(prev.map((v) => [vulnKey(v), v]));
  const after = new Map(next.map((v) => [vulnKey(v), v]));
  const out: ChangeEvent[] = [];
  for (const [k, v] of before) {
    if (after.has(k)) continue;
    out.push({
      kind: 'cve',
      severity: 'info',
      message: `${v.cve ?? v.title} fixed (${v.target})`,
      payload: { direction: 'fixed', cve: v.cve, target: v.target, severity: v.severity },
    });
  }
  for (const [k, v] of after) {
    if (before.has(k)) continue;
    out.push({
      kind: 'cve',
      severity: 'critical',
      message: `${v.cve ?? v.title} new (${v.target})`,
      payload: { direction: 'new', cve: v.cve, target: v.target, severity: v.severity },
    });
  }
  return out;
}

export function diffSeoIssues(prev: SeoIssueInfo[] | null | undefined, next: SeoIssueInfo[]): ChangeEvent[] {
  if (!prev) return [];
  const before = new Map(prev.map((i) => [i.type, i.count]));
  const after = new Map(next.map((i) => [i.type, i.count]));
  const out: ChangeEvent[] = [];
  for (const [type, count] of before) {
    if (after.has(type)) continue;
    out.push({
      kind: 'seo',
      severity: 'info',
      message: `${type} — fixed (${count})`,
      payload: { direction: 'fixed', type, was_count: count },
    });
  }
  for (const [type, count] of after) {
    if (before.has(type)) continue;
    out.push({
      kind: 'seo',
      severity: 'warning',
      message: `${type} — new (${count})`,
      payload: { direction: 'new', type, was_count: count },
    });
  }
  return out;
}
```

- [ ] **Step 4: Export from the package index**

In `packages/core/src/index.ts`, append:

```ts
export {
  diffCore,
  diffPlugins,
  diffVulns,
  diffSeoIssues,
  type EventKind,
  type Severity,
  type ChangeEvent,
  type EventPayload,
  type UpdatePayload,
  type CvePayload,
  type SeoPayload,
  type ScorePayload,
  type PluginInfo,
  type VulnInfo,
  type SeoIssueInfo,
} from './events';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @agency/core test events`
Expected: PASS (16 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/events.ts packages/core/src/events.test.ts packages/core/src/index.ts
git commit -m "feat(core): change event types + pure diff functions"
```

---

### Task 3: `core/reportText.ts` — audience filter + Slovak renderers

**Files:**
- Create: `packages/core/src/reportText.ts`, `packages/core/src/reportText.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ChangeEvent`, payload types from `./events` (Task 2)
- Produces:
  - `isClientVisible(ev: ChangeEvent): boolean`
  - `renderClient(ev: ChangeEvent): string`
  - `renderIncident(startedAt: string, resolvedAt: string): string`
  - `interface Vigilance { checks: number; uptimePct: number | null; downtimeSeconds: number }`
  - `renderVigilance(v: Vigilance, periodLabel: string): string`
  - `interface TimedLine { at: string; text: string }`
  - `buildClientLines(input: { events: { at: string; ev: ChangeEvent }[]; diary: { happened_at: string; text: string }[]; incidents: { started_at: string; resolved_at: string }[] }): TimedLine[]`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/reportText.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isClientVisible, renderClient, renderIncident, renderVigilance, buildClientLines } from './reportText';
import type { ChangeEvent } from './events';

const ev = (o: Partial<ChangeEvent>): ChangeEvent => ({ kind: 'update', severity: 'info', message: 'm', payload: { target: 'plugin', name: 'WooCommerce', slug: 'woocommerce', from: '5.1', to: '5.4' }, ...o } as ChangeEvent);

describe('isClientVisible — test dôvery', () => {
  it('update vidí klient', () => {
    expect(isClientVisible(ev({}))).toBe(true);
  });
  it('opravená CVE áno, nová NIE', () => {
    expect(isClientVisible(ev({ kind: 'cve', payload: { direction: 'fixed', cve: 'CVE-1', target: 'X', severity: 'high' } }))).toBe(true);
    expect(isClientVisible(ev({ kind: 'cve', payload: { direction: 'new', cve: 'CVE-1', target: 'X', severity: 'high' } }))).toBe(false);
  });
  it('opravené SEO áno, nové NIE', () => {
    expect(isClientVisible(ev({ kind: 'seo', payload: { direction: 'fixed', type: 'T', was_count: 2 } }))).toBe(true);
    expect(isClientVisible(ev({ kind: 'seo', payload: { direction: 'new', type: 'T', was_count: 2 } }))).toBe(false);
  });
  it('zlepšenie skóre áno, zhoršenie NIE', () => {
    expect(isClientVisible(ev({ kind: 'score', payload: { metric: 'aeo', from: 48, to: 78, direction: 'up' } }))).toBe(true);
    expect(isClientVisible(ev({ kind: 'score', payload: { metric: 'aeo', from: 78, to: 48, direction: 'down' } }))).toBe(false);
  });
});

describe('renderClient', () => {
  it('update pluginu — vecný hlas, bez žargónu', () => {
    expect(renderClient(ev({}))).toBe('WooCommerce bol aktualizovaný na verziu 5.4.');
  });
  it('update jadra', () => {
    expect(renderClient(ev({ payload: { target: 'core', name: 'WordPress', slug: 'wordpress', from: '6.4', to: '6.5' } }))).toBe('WordPress bol aktualizovaný na verziu 6.5.');
  });
  it('opravená CVE — bez CVE identifikátora, so závažnosťou po slovensky', () => {
    const out = renderClient(ev({ kind: 'cve', payload: { direction: 'fixed', cve: 'CVE-2024-1', target: 'WooCommerce', severity: 'high' } }));
    expect(out).toBe('Odstránená bezpečnostná zraniteľnosť vysokej závažnosti v module WooCommerce.');
    expect(out).not.toContain('CVE');
  });
  it('opravené SEO — technický typ preložený', () => {
    expect(renderClient(ev({ kind: 'seo', payload: { direction: 'fixed', type: 'Chýbajúci canonical', was_count: 12 } })))
      .toBe('Opravené: chýbajúce označenie hlavnej verzie stránky — na 12 stránkach.');
  });
  it('neznámy SEO typ → fallback na pôvodný text (nespadne, nevymýšľa)', () => {
    expect(renderClient(ev({ kind: 'seo', payload: { direction: 'fixed', type: 'Nový typ XY', was_count: 1 } })))
      .toBe('Opravené: Nový typ XY — na 1 stránke.');
  });
  it('zlepšenie skóre — správny slovenský rod', () => {
    expect(renderClient(ev({ kind: 'score', payload: { metric: 'aeo', from: 48, to: 78, direction: 'up' } })))
      .toBe('Pripravenosť webu pre AI vyhľadávače sa zlepšila zo 48 na 78 bodov.');
    expect(renderClient(ev({ kind: 'score', payload: { metric: 'security', from: 70, to: 90, direction: 'up' } })))
      .toBe('Bezpečnostné nastavenia sa zlepšili zo 70 na 90 bodov.');
  });
  it('neznáma metrika → fallback', () => {
    expect(renderClient(ev({ kind: 'score', payload: { metric: 'xy', from: 1, to: 2, direction: 'up' } }))).toContain('xy');
  });
});

describe('renderIncident', () => {
  it('netvrdí, že sme to opravili — len že sme zachytili', () => {
    const out = renderIncident('2026-07-03T12:12:00Z', '2026-07-03T12:24:00Z');
    expect(out).toContain('Zachytili sme');
    expect(out).toContain('12 minút');
    expect(out).not.toContain('vyriešili sme');
  });
});

describe('renderVigilance', () => {
  it('reálne čísla, bez výpadku', () => {
    expect(renderVigilance({ checks: 8640, uptimePct: 100, downtimeSeconds: 0 }, 'V júli'))
      .toBe('V júli sme spravili 8 640 kontrol dostupnosti. Web bol dostupný 100 % času.');
  });
  it('s výpadkom pripojí trvanie', () => {
    expect(renderVigilance({ checks: 8640, uptimePct: 99.98, downtimeSeconds: 240 }, 'V júli'))
      .toBe('V júli sme spravili 8 640 kontrol dostupnosti. Web bol dostupný 99,98 % času, celkový výpadok 4 minúty.');
  });
});

describe('buildClientLines', () => {
  it('zlúči a zoradí chronologicky, zhoršenia vypustí', () => {
    const lines = buildClientLines({
      events: [
        { at: '2026-07-10T10:00:00Z', ev: ev({}) },
        { at: '2026-07-02T10:00:00Z', ev: ev({ kind: 'score', payload: { metric: 'aeo', from: 78, to: 48, direction: 'down' } }) },
      ],
      diary: [{ happened_at: '2026-07-05', text: 'Optimalizovali sme obrázky.' }],
      incidents: [{ started_at: '2026-07-03T12:12:00Z', resolved_at: '2026-07-03T12:24:00Z' }],
    });
    expect(lines.map((l) => l.text)).toEqual([
      'Zachytili sme krátky výpadok 3. 7. o 14:12, trval 12 minút.',
      'Optimalizovali sme obrázky.',
      'WooCommerce bol aktualizovaný na verziu 5.4.',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agency/core test reportText`
Expected: FAIL — `Failed to resolve import "./reportText"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/reportText.ts`:

```ts
// Jazyk reportov. Z tej istej udalosti vyrobí klientsku vetu (ľudská reč) alebo
// admin riadok (stručne). Klient nikdy nevidí zhoršenia — to zaisťuje isClientVisible.
// Hlas: auto-zistené udalosti = vecný („bol aktualizovaný"), denník = agentúrny
// (text píše operátor). Netvrdíme, kto výpadok opravil — len že sme ho zachytili.

import type { ChangeEvent, UpdatePayload, CvePayload, SeoPayload, ScorePayload } from './events';

export function isClientVisible(ev: ChangeEvent): boolean {
  const dir = (ev.payload as { direction?: string }).direction;
  switch (ev.kind) {
    case 'update':
      return true;
    case 'cve':
    case 'seo':
      return dir === 'fixed';
    case 'score':
      return dir === 'up';
    default:
      return false;
  }
}

// Vety per metrika — slovenský rod sa nedá skladať z holého labelu
// („Pripravenosť sa zlepšila" vs „Nastavenia sa zlepšili").
const METRIC_SENTENCE: Record<string, (from: number, to: number) => string> = {
  aeo: (f, t) => `Pripravenosť webu pre AI vyhľadávače sa zlepšila zo ${f} na ${t} bodov.`,
  security: (f, t) => `Bezpečnostné nastavenia sa zlepšili zo ${f} na ${t} bodov.`,
  perf_mobile: (f, t) => `Rýchlosť na mobile sa zlepšila zo ${f} na ${t} bodov.`,
  perf_desktop: (f, t) => `Rýchlosť na počítači sa zlepšila zo ${f} na ${t} bodov.`,
};

// SEO typy sú v seo.ts už po slovensky, ale technicky — preklad do klientskej reči.
// Fallback = pôvodný text (zrozumiteľný, nič si nevymýšľa).
export const SEO_CLIENT_LABELS: Record<string, string> = {
  'Nefunkčné odkazy (4xx/5xx)': 'nefunkčné odkazy',
  'Chýbajúci title / meta description': 'chýbajúce názvy a popisy stránok pre vyhľadávače',
  'Duplicitný title': 'rovnaké názvy na viacerých stránkach',
  'Obrázky bez alt atribútu': 'obrázky bez textového popisu',
  'Chýbajúci alebo viacnásobný H1': 'nesprávne hlavné nadpisy stránok',
  'Chýbajúci canonical': 'chýbajúce označenie hlavnej verzie stránky',
  'Mixed content (HTTP na HTTPS)': 'nezabezpečené prvky na zabezpečenej stránke',
};

const SEVERITY_SK: Record<string, string> = {
  critical: 'kritickej',
  high: 'vysokej',
  medium: 'strednej',
  low: 'nízkej',
};

const pages = (n: number) => (n === 1 ? 'stránke' : 'stránkach');
const minutes = (n: number) => (n === 1 ? 'minútu' : n < 5 ? 'minúty' : 'minút');

// Zdieľané formátovanie (importuje aj clientReport.ts — nech nie je na dvoch miestach).
// Tisícky s pevnou medzerou, percentá s desatinnou čiarkou a bez „,00".
export const fmtNum = (n: number): string => n.toLocaleString('sk-SK').replace(/\s/g, '\u00a0');
export const fmtPct = (p: number): string => p.toFixed(2).replace('.', ',').replace(',00', '');

export function renderClient(ev: ChangeEvent): string {
  switch (ev.kind) {
    case 'update': {
      const p = ev.payload as UpdatePayload;
      return `${p.name} bol aktualizovaný na verziu ${p.to}.`;
    }
    case 'cve': {
      const p = ev.payload as CvePayload;
      const sev = SEVERITY_SK[p.severity];
      return sev
        ? `Odstránená bezpečnostná zraniteľnosť ${sev} závažnosti v module ${p.target}.`
        : `Odstránená bezpečnostná zraniteľnosť v module ${p.target}.`;
    }
    case 'seo': {
      const p = ev.payload as SeoPayload;
      const label = SEO_CLIENT_LABELS[p.type] ?? p.type;
      return `Opravené: ${label} — na ${p.was_count} ${pages(p.was_count)}.`;
    }
    case 'score': {
      const p = ev.payload as ScorePayload;
      const sentence = METRIC_SENTENCE[p.metric];
      const from = Math.round(p.from);
      const to = Math.round(p.to);
      return sentence ? sentence(from, to) : `${p.metric}: zlepšenie zo ${from} na ${to} bodov.`;
    }
    default:
      return ev.message;
  }
}

const BRATISLAVA = 'Europe/Bratislava';
function localParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('sk-SK', { day: 'numeric', month: 'numeric', timeZone: BRATISLAVA }).format(d);
  const time = new Intl.DateTimeFormat('sk-SK', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BRATISLAVA }).format(d);
  return { date: date.replace(/\s/g, ' '), time };
}

// „Zachytili sme" je pravda (monitoring ho naozaj zachytil). Že sme ho opravili
// NEtvrdíme — web sa mohol obnoviť aj sám.
export function renderIncident(startedAt: string, resolvedAt: string): string {
  const mins = Math.max(1, Math.round((Date.parse(resolvedAt) - Date.parse(startedAt)) / 60000));
  const { date, time } = localParts(startedAt);
  return `Zachytili sme krátky výpadok ${date} o ${time}, trval ${mins} ${minutes(mins)}.`;
}

export interface Vigilance {
  checks: number;
  uptimePct: number | null;
  downtimeSeconds: number;
}

export function renderVigilance(v: Vigilance, periodLabel: string): string {
  const pct = v.uptimePct === null ? null : fmtPct(v.uptimePct);
  const head = `${periodLabel} sme spravili ${fmtNum(v.checks)} kontrol dostupnosti.`;
  if (pct === null) return head;
  const mins = Math.round(v.downtimeSeconds / 60);
  return mins > 0
    ? `${head} Web bol dostupný ${pct} % času, celkový výpadok ${mins} ${minutes(mins)}.`
    : `${head} Web bol dostupný ${pct} % času.`;
}

export interface TimedLine {
  at: string;
  text: string;
}

export function buildClientLines(input: {
  events: { at: string; ev: ChangeEvent }[];
  diary: { happened_at: string; text: string }[];
  incidents: { started_at: string; resolved_at: string }[];
}): TimedLine[] {
  const lines: TimedLine[] = [
    ...input.events.filter((e) => isClientVisible(e.ev)).map((e) => ({ at: e.at, text: renderClient(e.ev) })),
    ...input.diary.map((d) => ({ at: d.happened_at, text: d.text })),
    ...input.incidents.map((i) => ({ at: i.started_at, text: renderIncident(i.started_at, i.resolved_at) })),
  ];
  return lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
```

- [ ] **Step 4: Export from the package index**

In `packages/core/src/index.ts`, append:

```ts
export {
  isClientVisible,
  renderClient,
  renderIncident,
  renderVigilance,
  buildClientLines,
  fmtNum,
  fmtPct,
  SEO_CLIENT_LABELS,
  type Vigilance,
  type TimedLine,
} from './reportText';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @agency/core test reportText`
Expected: PASS. If `renderVigilance` or `renderIncident` fail on spacing, fix the implementation (not the test) — the expected strings are the spec.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/reportText.ts packages/core/src/reportText.test.ts packages/core/src/index.ts
git commit -m "feat(core): per-audience Slovak report renderers"
```

---

### Task 4: WP ingest — log core + plugin updates

**Files:**
- Modify: `apps/scheduler/src/wpIngest.ts`

**Interfaces:**
- Consumes: `diffCore`, `diffPlugins`, `type PluginInfo` from `@agency/core` (Task 2); `change_log.payload` (Task 1)
- Produces: `update` rows in `change_log`

- [ ] **Step 1: Read the current file**

Run: `cat apps/scheduler/src/wpIngest.ts`
Note the site lookup and the `db.from('wp_snapshots').upsert(...)` call. The diff must happen **before** the upsert (afterwards the old version is gone).

- [ ] **Step 2: Add the diff + log, before the upsert**

Add to the imports at the top of the file:

```ts
import { diffCore, diffPlugins, type PluginInfo, type ChangeEvent } from '@agency/core';
```

Immediately **before** the `const { error } = await db.from('wp_snapshots').upsert(` call, insert:

```ts
  // Diff pred prepísaním snapshotu — inak sa stará verzia stratí. Prvý ingest
  // (žiadny predchádzajúci riadok) zámerne nelogujeme.
  const { data: prevSnap } = await db
    .from('wp_snapshots')
    .select('wp_version, plugins')
    .eq('site_id', site.id)
    .maybeSingle();
  const events: ChangeEvent[] = prevSnap
    ? [
        ...diffCore(prevSnap.wp_version, body.wp_version ?? null),
        ...diffPlugins(prevSnap.plugins as unknown as PluginInfo[] | null, (body.plugins ?? []) as PluginInfo[]),
      ]
    : [];
```

Immediately **after** the upsert error check, insert:

```ts
  // Zápis udalostí je best-effort — nesmie zhodiť ingest (dáta > zoznam udalostí).
  if (events.length) {
    const { error: logErr } = await db.from('change_log').insert(
      events.map((e) => ({
        site_id: site.id,
        org_id: site.org_id,
        kind: e.kind,
        severity: e.severity,
        message: e.message,
        payload: e.payload as unknown as Record<string, unknown>,
      })),
    );
    if (logErr) console.log(JSON.stringify({ ev: 'wp.changelog_fail', message: logErr.message }));
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @agency/scheduler exec tsc --noEmit`
Expected: no errors. If `site.org_id` is not selected in the existing lookup query, add `org_id` to that `.select(...)`.

- [ ] **Step 4: Commit**

```bash
git add apps/scheduler/src/wpIngest.ts
git commit -m "feat(wp): log core + plugin updates on ingest"
```

---

### Task 5: CVE job — log fixed/new vulnerabilities

**Files:**
- Modify: `tools/wp-cve/index.mjs`

**Interfaces:**
- Consumes: `diffVulns` from `../../packages/core/dist/events.js` (Task 2)
- Produces: `cve` rows in `change_log`

- [ ] **Step 1: Import the diff and fetch previous vulns**

Add to the imports:

```js
import { diffVulns } from '../../packages/core/dist/events.js';
```

Change the snapshot query so the **old** vulns come along — find:

```js
  const rows = await (await fetch(`${url}/rest/v1/wp_snapshots?select=site_id,wp_version,plugins&wp_version=not.is.null`, { headers: restHeaders(srv) })).json();
```

and replace with:

```js
  const rows = await (await fetch(`${url}/rest/v1/wp_snapshots?select=site_id,org_id,wp_version,plugins,vulns&wp_version=not.is.null`, { headers: restHeaders(srv) })).json();
```

- [ ] **Step 2: Guard against the rate-limit trap, then diff**

**Why this guard matters:** when WPScan hits its 25/day free limit, `collectVulns` returns an incomplete (often empty) list. Writing that would wipe the stored CVEs, and diffing it would emit "vulnerability fixed" events for CVEs that are still there — fabricated good news, and the next run would then emit them all as "new". Both the write and the diff must be skipped.

In the `for (const wp of rows)` loop, right after `await enrichSeverity(vulns, nvdCache, nvdKey);`, add:

```js
      // Rate-limited beh = neúplný zoznam. Nezapisuj ani nediffuj — inak by sme
      // ohlásili „zraniteľnosť vyriešená" pri CVE, ktoré tam stále je.
      if (rateLimited) {
        console.log(JSON.stringify({ ev: 'cve.skip_rate_limited', site_id: wp.site_id }));
        continue;
      }
      // Diff proti uloženému zoznamu (prvý beh: vulns === null → žiadne udalosti).
      const events = diffVulns(wp.vulns ?? null, vulns);
```

After the PATCH `if (!up.ok) throw ...` line, add:

```js
      if (events.length) {
        const log = await fetch(`${url}/rest/v1/change_log`, {
          method: 'POST',
          headers: { ...restHeaders(srv), Prefer: 'return=minimal' },
          body: JSON.stringify(events.map((e) => ({
            site_id: wp.site_id, org_id: wp.org_id, kind: e.kind, severity: e.severity, message: e.message, payload: e.payload,
          }))),
        });
        if (!log.ok) console.log(JSON.stringify({ ev: 'cve.changelog_fail', site_id: wp.site_id, status: log.status }));
      }
```

- [ ] **Step 3: Verify syntax and the core build**

Run: `pnpm --filter @agency/core build && node --check tools/wp-cve/index.mjs`
Expected: no output from `node --check` (success).

- [ ] **Step 4: Commit**

```bash
git add tools/wp-cve/index.mjs
git commit -m "feat(cve): log fixed and new vulnerabilities as events"
```

---

### Task 6: SEO crawl — log fixed/new issue types

**Files:**
- Modify: `tools/seo-crawl/index.mjs`

**Interfaces:**
- Consumes: `diffSeoIssues` from `../../packages/core/dist/events.js` (Task 2)
- Produces: `seo` rows in `change_log`

**Why the success guard matters:** on a failed crawl the collector builds `row` **without** an `issues` field. Diffing that against the stored issues would emit "fixed" for every issue — inventing good news out of a crawl failure. Diff only when the crawl succeeded.

- [ ] **Step 1: Import the diff**

Add to the imports of `tools/seo-crawl/index.mjs`:

```js
import { diffSeoIssues } from '../../packages/core/dist/events.js';
```

- [ ] **Step 2: Replace the per-site loop in `main()`**

The loop currently reads:

```js
  for (const s of sites) {
    let row;
    try {
      const r = await crawlSite(s.domain);
      if (r.pages_crawled === 0) throw new Error('žiadna stránka sa nenačítala');
      row = { site_id: s.id, org_id: s.org_id, ...r, measured_at: now, error: null };
      ok++;
      console.log(JSON.stringify({ ev: 'seo.ok', domain: s.domain, pages: r.pages_crawled, issues: r.issues.length }));
    } catch (e) {
      row = { site_id: s.id, org_id: s.org_id, pages_crawled: 0, measured_at: now, error: String(e?.message ?? e) };
      failed++;
      console.log(JSON.stringify({ ev: 'seo.fail', domain: s.domain, error: String(e?.message ?? e) }));
    }
    const up = await fetch(`${url}/rest/v1/seo_snapshots?on_conflict=site_id`, { method: 'POST', headers: { ...restHeaders(key), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
    if (!up.ok) console.log(JSON.stringify({ ev: 'seo.upsert_fail', domain: s.domain, status: up.status, body: await up.text() }));
  }
```

Replace it with:

```js
  for (const s of sites) {
    // Starý zoznam issues PRED prepísaním (prvý beh → prevIssues null → žiadne udalosti).
    const prevRes = await fetch(`${url}/rest/v1/seo_snapshots?select=issues&site_id=eq.${s.id}`, { headers: restHeaders(key) });
    const prevRows = prevRes.ok ? await prevRes.json() : [];
    const prevIssues = prevRows[0]?.issues ?? null;

    let row;
    let events = [];
    try {
      const r = await crawlSite(s.domain);
      if (r.pages_crawled === 0) throw new Error('žiadna stránka sa nenačítala');
      row = { site_id: s.id, org_id: s.org_id, ...r, measured_at: now, error: null };
      // Diffujeme LEN pri úspešnom crawle — pri zlyhaní nemáme issues a hlásili by
      // sme „opravené" pre všetko, čo tam v skutočnosti stále je.
      events = diffSeoIssues(prevIssues, (r.issues ?? []).map((i) => ({ type: i.type, count: i.count })));
      ok++;
      console.log(JSON.stringify({ ev: 'seo.ok', domain: s.domain, pages: r.pages_crawled, issues: r.issues.length }));
    } catch (e) {
      row = { site_id: s.id, org_id: s.org_id, pages_crawled: 0, measured_at: now, error: String(e?.message ?? e) };
      failed++;
      console.log(JSON.stringify({ ev: 'seo.fail', domain: s.domain, error: String(e?.message ?? e) }));
    }
    const up = await fetch(`${url}/rest/v1/seo_snapshots?on_conflict=site_id`, { method: 'POST', headers: { ...restHeaders(key), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row) });
    if (!up.ok) console.log(JSON.stringify({ ev: 'seo.upsert_fail', domain: s.domain, status: up.status, body: await up.text() }));

    // Best-effort — zlyhanie zápisu udalostí nesmie zhodiť crawl.
    if (events.length) {
      const log = await fetch(`${url}/rest/v1/change_log`, {
        method: 'POST',
        headers: { ...restHeaders(key), Prefer: 'return=minimal' },
        body: JSON.stringify(events.map((e) => ({
          site_id: s.id, org_id: s.org_id, kind: e.kind, severity: e.severity, message: e.message, payload: e.payload,
        }))),
      });
      if (!log.ok) console.log(JSON.stringify({ ev: 'seo.changelog_fail', domain: s.domain, status: log.status }));
    }
  }
```

- [ ] **Step 3: Verify syntax**

Run: `node --check tools/seo-crawl/index.mjs`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add tools/seo-crawl/index.mjs
git commit -m "feat(seo): log fixed and new issue types as events"
```

---

### Task 7: History job — scores only, new thresholds, payload

**Files:**
- Modify: `tools/history-snapshot/index.mjs`

**Interfaces:**
- Consumes: `change_log.payload` (Task 1)
- Produces: `score` rows in `change_log` carrying `ScorePayload`

- [ ] **Step 1: Reduce METRICS to scores and set thresholds**

Replace the `METRICS` array with:

```js
// Len skóre — presné CVE/SEO udalosti teraz logujú wp-cve a seo-crawl.
// Prahy: AEO/Security ±3 (deterministické kontroly z HTML/robots.txt → zmena je
// skutočná). Výkon ostáva ±10 — PageSpeed dá tomu istému webu bežne ±5 medzi
// behmi a nižší prah by hlásil zlepšenia, ktoré sú len šum merania.
const METRICS = [
  { key: 'aeo', label: 'AEO skóre', kind: 'score', th: 3, dir: 'up_good' },
  { key: 'security', label: 'Security skóre', kind: 'score', th: 3, dir: 'up_good' },
  { key: 'perf_mobile', label: 'Výkon (mobil)', kind: 'score', th: 10, dir: 'up_good' },
  { key: 'perf_desktop', label: 'Výkon (desktop)', kind: 'score', th: 10, dir: 'up_good' },
];
// Trend bez logovania (týždenne šumové) — seo_issues a wp_vulns tu ostávajú
// kvôli histórii, ale udalosti k nim vyrábajú príslušné collectory.
const TREND_ONLY = ['gsc_clicks', 'gsc_impressions', 'gsc_position', 'seo_issues', 'wp_vulns'];
```

- [ ] **Step 2: Attach the payload to change rows**

In the change-detection loop, the `m.kind === 'cve'` branch is now unreachable (no cve metric remains) — remove it. Replace the message/severity block and the `changeRows.push(...)` with:

```js
      const improved = m.dir === 'up_good' ? diff > 0 : diff < 0;
      const message = `${m.label}: ${Math.round(before)} → ${Math.round(cur)}`;
      const severity = improved ? 'info' : 'warning';
      changeRows.push({
        site_id: s.id,
        org_id: s.org_id,
        kind: 'score',
        severity,
        message,
        payload: { metric: m.key, from: Math.round(before), to: Math.round(cur), direction: improved ? 'up' : 'down' },
        created_at: now,
      });
```

Keep the existing proactive-alert block that follows (`if (!improved) { ... alertRows.push(...) }`) unchanged, but since `m.kind` is always `'score'` now, simplify its type/title to:

```js
        alertRows.push({
          org_id: s.org_id,
          site_id: s.id,
          type: 'metric_drop',
          severity: 'warning',
          title: `${dom}: ${m.label} kleslo`,
          body: message,
          dedupe_key: `proactive:${s.id}:${m.key}:${wk}`,
        });
```

- [ ] **Step 3: Verify syntax and run against prod**

Run: `node --check tools/history-snapshot/index.mjs`
Expected: success.

Then (with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set):
Run: `node tools/history-snapshot/index.mjs`
Expected: JSON line `{"ev":"history.done",...}` with no `changelog insert` error.

- [ ] **Step 4: Commit**

```bash
git add tools/history-snapshot/index.mjs
git commit -m "feat(history): score events with payload; drop count-based cve/seo logging"
```

---

### Task 8: `core/clientReport.ts` — client monthly report renderer

**Files:**
- Create: `packages/core/src/clientReport.ts`, `packages/core/src/clientReport.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `Vigilance`, `renderVigilance` from `./reportText` (Task 3)
- Produces:
  - `interface ClientReportSite { domain: string; vigilance: Vigilance; lines: string[]; knownVulns: number | null; pluginsCurrent: boolean | null }`
  - `interface ClientReportData { monthLabel: string; periodLabel: string; clientName: string; sites: ClientReportSite[] }`
  - `renderClientReport(data: ClientReportData): { subject: string; html: string; text: string }`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/clientReport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderClientReport, type ClientReportSite } from './clientReport';

const site = (o: Partial<ClientReportSite>): ClientReportSite => ({
  domain: 'x.sk',
  vigilance: { checks: 8640, uptimePct: 100, downtimeSeconds: 0 },
  lines: [],
  knownVulns: 0,
  pluginsCurrent: true,
  ...o,
});

describe('renderClientReport', () => {
  it('predmet obsahuje mesiac a meno klienta', () => {
    const r = renderClientReport({ monthLabel: 'Júl 2026', periodLabel: 'V júli', clientName: 'Krivošík', sites: [site({})] });
    expect(r.subject).toContain('Júl 2026');
    expect(r.html).toContain('Krivošík');
  });

  it('tichý web → rámcuje ticho ako dohľad, nie prázdno', () => {
    const r = renderClientReport({ monthLabel: 'M', periodLabel: 'V júli', clientName: 'K', sites: [site({})] });
    expect(r.text).toContain('Stabilne bez problémov');
    expect(r.text).toContain('žiadne známe zraniteľnosti');
    expect(r.text).toContain('všetky pluginy aktuálne');
  });

  it('tichý web bez overených údajov netvrdí, čo nevie', () => {
    const r = renderClientReport({ monthLabel: 'M', periodLabel: 'V júli', clientName: 'K', sites: [site({ knownVulns: null, pluginsCurrent: null })] });
    expect(r.text).toContain('Stabilne bez problémov');
    expect(r.text).not.toContain('žiadne známe zraniteľnosti');
    expect(r.text).not.toContain('všetky pluginy aktuálne');
  });

  it('web s udalosťami ich vypíše', () => {
    const r = renderClientReport({ monthLabel: 'M', periodLabel: 'V júli', clientName: 'K', sites: [site({ lines: ['WooCommerce bol aktualizovaný na verziu 5.4.'] })] });
    expect(r.text).toContain('WooCommerce bol aktualizovaný na verziu 5.4.');
    expect(r.text).not.toContain('Stabilne bez problémov');
  });

  it('escapuje HTML v doméne aj v riadkoch', () => {
    const r = renderClientReport({ monthLabel: 'M', periodLabel: 'V júli', clientName: 'K', sites: [site({ domain: '<b>x</b>', lines: ['<script>'] })] });
    expect(r.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(r.html).toContain('&lt;script&gt;');
  });

  it('vigilance veta je v reporte', () => {
    const r = renderClientReport({ monthLabel: 'M', periodLabel: 'V júli', clientName: 'K', sites: [site({})] });
    expect(r.text).toContain('8 640 kontrol dostupnosti');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @agency/core test clientReport`
Expected: FAIL — `Failed to resolve import "./clientReport"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/clientReport.ts`:

```ts
// Klientsky mesačný report — len jeho weby, len pozitívne/neutrálne (filtrovanie
// zaisťuje buildClientLines). Tichý web nerámujeme ako prázdno, ale ako dôkaz
// dohľadu. Tvrdíme len to, čo vieme: knownVulns/pluginsCurrent === null → mlčíme.

import { renderVigilance, fmtNum, fmtPct, type Vigilance } from './reportText';

export interface ClientReportSite {
  domain: string;
  vigilance: Vigilance;
  lines: string[]; // už vyrenderované klientske vety, chronologicky
  knownVulns: number | null; // null = nevieme (agent nenainštalovaný)
  pluginsCurrent: boolean | null; // null = nevieme
}

export interface ClientReportData {
  monthLabel: string; // „Júl 2026"
  periodLabel: string; // „V júli"
  clientName: string;
  sites: ClientReportSite[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Veta pre web, na ktorom sa nič nedialo — bez tvrdení, ktoré nevieme doložiť.
function quietLine(s: ClientReportSite): string {
  const parts = [`${fmtNum(s.vigilance.checks)} kontrol`];
  if (s.vigilance.uptimePct !== null) parts.push(`${fmtPct(s.vigilance.uptimePct)} % dostupnosť`);
  if (s.knownVulns === 0) parts.push('žiadne známe zraniteľnosti');
  if (s.pluginsCurrent === true) parts.push('všetky pluginy aktuálne');
  return `Stabilne bez problémov — ${parts.join(', ')}.`;
}

export function renderClientReport(data: ClientReportData): { subject: string; html: string; text: string } {
  const subject = `Váš web v skratke — ${data.monthLabel}`;

  const siteHtml = data.sites
    .map((s) => {
      const body = s.lines.length
        ? `<ul style="margin:8px 0 0;padding-left:18px;color:#444;font-size:14px;line-height:1.7">${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
        : `<div style="margin-top:8px;color:#16a34a;font-size:14px">${esc(quietLine(s))}</div>`;
      return `<div style="padding:16px 0;border-bottom:1px solid #eee">
        <div style="font-weight:700;color:#111;font-size:15px">${esc(s.domain)}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:3px">${esc(renderVigilance(s.vigilance, data.periodLabel))}</div>
        ${body}
      </div>`;
    })
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #eee">
      <div style="font-size:13px;color:#6b7280;font-weight:600;letter-spacing:.3px">MONITORIX · ${esc(data.monthLabel)}</div>
      <h1 style="font-size:20px;color:#111;margin:6px 0 4px">Váš web v skratke</h1>
      <div style="font-size:14px;color:#444;margin-bottom:8px">${esc(data.clientName)}</div>
      ${siteHtml}
      <div style="font-size:12px;color:#9ca3af;margin-top:22px">Automatický mesačný prehľad z Monitorix. Všetko sú reálne merania — nič sa neodhaduje.</div>
    </div>
  </div></body></html>`;

  const text =
    `Váš web v skratke — ${data.monthLabel}\n${data.clientName}\n\n` +
    data.sites
      .map((s) => {
        const head = `${s.domain}\n${renderVigilance(s.vigilance, data.periodLabel)}`;
        const body = s.lines.length ? s.lines.map((l) => `  • ${l}`).join('\n') : `  ${quietLine(s)}`;
        return `${head}\n${body}`;
      })
      .join('\n\n');

  return { subject, html, text };
}
```

- [ ] **Step 4: Export from the package index**

In `packages/core/src/index.ts`, append:

```ts
export { renderClientReport, type ClientReportData, type ClientReportSite } from './clientReport';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @agency/core test`
Expected: PASS — the whole core suite, including the earlier tasks.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/clientReport.ts packages/core/src/clientReport.test.ts packages/core/src/index.ts
git commit -m "feat(core): client monthly report renderer"
```

---

### Task 9: Monthly report collector — wire events, diary, incidents, vigilance

**Files:**
- Modify: `tools/monthly-report/index.mjs`

**Interfaces:**
- Consumes: `buildClientLines` from `../../packages/core/dist/reportText.js` (Task 3), `renderClientReport` from `../../packages/core/dist/clientReport.js` (Task 8)
- Produces: client emails using the new renderer; admin aggregate unchanged

- [ ] **Step 1: Add imports and period label**

Add to the imports:

```js
import { buildClientLines } from '../../packages/core/dist/reportText.js';
import { renderClientReport } from '../../packages/core/dist/clientReport.js';
```

Add next to the existing `MONTHS` constant:

```js
// „V júli" — lokál pre vigilance vetu.
const MONTHS_IN = ['V januári', 'Vo februári', 'V marci', 'V apríli', 'V máji', 'V júni', 'V júli', 'V auguste', 'V septembri', 'V októbri', 'V novembri', 'V decembri'];
```

and after `const monthLabel = ...` add:

```js
  const periodLabel = MONTHS_IN[start.getUTCMonth()];
```

- [ ] **Step 2: Fetch the extra data for the period**

Extend the existing `Promise.all([...])` with three more queries (append them to the array and to the destructuring):

```js
    get(`change_log?select=site_id,kind,severity,message,payload,created_at&created_at=gte.${start.toISOString()}&created_at=lt.${end.toISOString()}&order=created_at.asc`),
    get(`work_log?select=site_id,happened_at,text&happened_at=gte.${startDay}&happened_at=lt.${endDay}&order=happened_at.asc`),
    get(`incidents?select=site_id,started_at,resolved_at&started_at=gte.${start.toISOString()}&started_at=lt.${end.toISOString()}&resolved_at=not.is.null`),
```

Destructure as `changeLog`, `workLog`, `resolvedIncidents` (the existing `incidents` variable holds all incidents started in the period and stays as is for the admin count).

Then group them per site:

```js
  const groupBy = (arr, key) => {
    const m = new Map();
    for (const r of arr) {
      const list = m.get(r[key]) ?? [];
      list.push(r);
      m.set(r[key], list);
    }
    return m;
  };
  const eventsBySite = groupBy(changeLog, 'site_id');
  const diaryBySite = groupBy(workLog, 'site_id');
  const resolvedBySite = groupBy(resolvedIncidents, 'site_id');
```

- [ ] **Step 3: Add per-site uptime rollup for vigilance**

The existing `upAcc` only accumulates `uptime_pct`. Change the `uptime_daily` query to also pull `checks` and `downtime_seconds`:

```js
    get(`uptime_daily?select=site_id,day,uptime_pct,checks,downtime_seconds&day=gte.${startDay}&day=lt.${endDay}`),
```

and replace the accumulator loop with:

```js
  const upAcc = new Map();
  for (const d of daily) {
    const a = upAcc.get(d.site_id) ?? { sum: 0, n: 0, checks: 0, downtime: 0 };
    if (d.uptime_pct != null) { a.sum += Number(d.uptime_pct); a.n++; }
    a.checks += Number(d.checks ?? 0);
    a.downtime += Number(d.downtime_seconds ?? 0);
    upAcc.set(d.site_id, a);
  }
  const vigilanceFor = (id) => {
    const a = upAcc.get(id);
    return { checks: a?.checks ?? 0, uptimePct: a && a.n ? a.sum / a.n : null, downtimeSeconds: a?.downtime ?? 0 };
  };
```

Keep the admin `buildSite` working: its `uptime` field becomes `const a = upAcc.get(s.id); a && a.n ? a.sum / a.n : null` (unchanged semantics).

- [ ] **Step 4: Replace the per-client send with the client renderer**

In the per-client loop (`for (const cl of clientsList)`), replace the `renderMonthlyReport({...})` call with:

```js
    const reportSites = clientSites.map((s) => {
      const wp = wpM.get(s.id);
      const vulnsArr = wp?.vulns ?? null;
      const plugins = wp?.plugins ?? null;
      return {
        domain: s.domain,
        vigilance: vigilanceFor(s.id),
        lines: buildClientLines({
          events: (eventsBySite.get(s.id) ?? []).filter((e) => e.payload).map((e) => ({
            at: e.created_at,
            ev: { kind: e.kind, severity: e.severity, message: e.message, payload: e.payload },
          })),
          diary: diaryBySite.get(s.id) ?? [],
          incidents: resolvedBySite.get(s.id) ?? [],
        }).map((l) => l.text),
        knownVulns: Array.isArray(vulnsArr) ? vulnsArr.length : null,
        pluginsCurrent: Array.isArray(plugins) ? plugins.every((p) => !p.update_version) : null,
      };
    });
    const label = cl.company || cl.name || 'Klient';
    const { subject, html, text } = renderClientReport({ monthLabel, periodLabel, clientName: label, sites: reportSites });
```

Note the `.filter((e) => e.payload)` — events logged before this feature have no payload and cannot be rendered; skipping them is correct (we never invent content).

The `wp_snapshots` query must now also select `plugins`:

```js
    get('wp_snapshots?select=site_id,vulns,plugins'),
```

- [ ] **Step 5: Verify syntax and dry-run**

Run: `pnpm --filter @agency/core build && node --check tools/monthly-report/index.mjs`
Expected: success.

Then, with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set (Resend intentionally unset):
Run: `node tools/monthly-report/index.mjs`
Expected: `{"ev":"report.skipped","scope":"client",...,"reason":"resend_not_ready"}` — proves composition ran without throwing.

- [ ] **Step 6: Commit**

```bash
git add tools/monthly-report/index.mjs
git commit -m "feat(report): client monthly report with events, diary and vigilance"
```

---

### Task 10: Diary UI — „Denník" tab

**Files:**
- Create: `apps/web/app/sites/TabDiary.tsx`
- Modify: `apps/web/app/sites/page.tsx` (TABS array + tab render)

**Interfaces:**
- Consumes: `work_log` table + types (Task 1)
- Produces: `<TabDiary siteId={string} orgId={string | null} />`

- [ ] **Step 1: Create the component**

Create `apps/web/app/sites/TabDiary.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Entry = { id: number; happened_at: string; text: string };

const card = {
  background: 'var(--surface-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-sm)',
} as const;

const todayIso = () => new Date().toISOString().slice(0, 10);

export function TabDiary({ siteId, orgId }: { siteId: string; orgId: string | null }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [text, setText] = useState('');
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('work_log')
      .select('id, happened_at, text')
      .eq('site_id', siteId)
      .order('happened_at', { ascending: false })
      .limit(100);
    setEntries((data ?? []) as Entry[]);
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const t = text.trim();
    if (!t || !orgId) return;
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from('work_log').insert({ site_id: siteId, org_id: orgId, happened_at: date, text: t });
    setSaving(false);
    if (error) {
      setErr(`Uloženie zlyhalo: ${error.message}`);
      return;
    }
    setText('');
    setDate(todayIso());
    await load();
  };

  const del = async (id: number) => {
    if (!window.confirm('Vymazať tento záznam?')) return;
    const { error } = await supabase.from('work_log').delete().eq('id', id);
    if (!error) await load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, padding: 20 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>Pracovný denník</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 14 }}>
          Zapíš, čo si na webe spravil. Záznamy sa objavia v mesačnom reporte pre klienta — tvojím hlasom, tak ako ich napíšeš.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: '10px 12px', background: 'var(--bg-base)', border: '1px solid var(--border-primary)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 13.5 }}
          />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
            placeholder="napr. Optimalizovali sme obrázky v e-shope"
            style={{ flex: 1, minWidth: 220, padding: '10px 12px', background: 'var(--bg-base)', border: '1px solid var(--border-primary)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 13.5 }}
          />
          <button
            onClick={() => void add()}
            disabled={saving || !text.trim()}
            style={{ padding: '10px 18px', background: saving || !text.trim() ? 'var(--text-tertiary)' : 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: saving || !text.trim() ? 'default' : 'pointer' }}
          >
            {saving ? 'Ukladám…' : 'Pridať'}
          </button>
        </div>
        {err && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--critical-color)', background: 'var(--critical-bg)', padding: '9px 13px', borderRadius: 10 }}>{err}</div>}
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        {entries === null ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text-tertiary)' }}>Načítavam…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
            Zatiaľ žiadne záznamy. Prvý pridaj vyššie — objaví sa v najbližšom mesačnom reporte.
          </div>
        ) : (
          entries.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: i < entries.length - 1 ? '1px solid var(--border-primary)' : 'none' }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: "'Geist Mono', monospace", whiteSpace: 'nowrap' }}>
                {new Date(e.happened_at).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric', year: '2-digit' })}
              </span>
              <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text-primary)' }}>{e.text}</span>
              <button
                onClick={() => void del(e.id)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontSize: 12, cursor: 'pointer' }}
              >
                Vymazať
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the tab**

In `apps/web/app/sites/page.tsx`, add the import near the other local imports:

```tsx
import { TabDiary } from './TabDiary';
```

Add to the `TABS` array, between `infra` and `client`:

```tsx
  { id: 'diary', label: 'Denník' },
```

Next to the other tab renders (e.g. after `{tab === 'infra' && <TabInfra site={site} />}`), add:

```tsx
        {tab === 'diary' && <TabDiary siteId={site.id} orgId={site.orgId ?? null} />}
```

If `SiteVM` has no `orgId`, add it: in `apps/web/app/lib/data.ts` add `orgId: string;` to the `SiteVM` interface and `orgId: s.org_id,` to the returned object.

- [ ] **Step 3: Typecheck and build**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

Run: `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… pnpm --filter web build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/sites/TabDiary.tsx apps/web/app/sites/page.tsx apps/web/app/lib/data.ts
git commit -m "feat(web): work log diary tab on site detail"
```

---

### Task 11: Public status page — incident history + vigilance

**Files:**
- Create: `packages/db/supabase/migrations/0023_public_status_incidents.sql`
- Modify: `apps/web/app/status/[slug]/StatusClient.tsx`

**Interfaces:**
- Consumes: existing `public_client_status(p_slug text)` RPC
- Produces: RPC response gains per site `incidents: [{started_at, minutes}]` and `vigilance: {checks, uptime_pct}`

**Constraint:** the RPC must expose **only** availability facts — no versions, CVEs, scores or diary. Only **resolved** incidents (an ongoing outage already shows in the current status).

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/0023_public_status_incidents.sql`:

```sql
-- Verejná status page: história vyriešených výpadkov (90 dní) + dôkaz dohľadu.
-- Naďalej LEN dostupnosť — žiadne verzie, CVE, skóre ani denník.

create or replace function public_client_status(p_slug text) returns json
language sql security definer set search_path = public stable as $$
  with c as (
    select id, coalesce(nullif(name,''), company, 'Klient') as label
    from clients where slug = p_slug and status_enabled = true
  ),
  s as (
    select st.id, st.domain, st.maintenance, st.consecutive_failures,
           exists (select 1 from incidents i where i.site_id = st.id and i.resolved_at is null) as has_incident,
           (select round(avg(ud.uptime_pct)::numeric, 2) from uptime_daily ud
              where ud.site_id = st.id and ud.day >= (current_date - 30)) as uptime30
    from sites st join c on st.client_id = c.id
    where st.is_active = true
  ),
  hist as (
    select ud.site_id,
           json_agg(json_build_object('d', to_char(ud.day, 'YYYY-MM-DD'), 'u', ud.uptime_pct) order by ud.day) as days
    from uptime_daily ud join s on s.id = ud.site_id
    where ud.day >= (current_date - 90)
    group by ud.site_id
  ),
  vig as (
    select ud.site_id, sum(ud.checks)::bigint as checks, round(avg(ud.uptime_pct)::numeric, 2) as uptime_pct
    from uptime_daily ud join s on s.id = ud.site_id
    where ud.day >= (current_date - 90)
    group by ud.site_id
  ),
  inc as (
    select i.site_id,
           json_agg(json_build_object(
             'started_at', i.started_at,
             'minutes', greatest(1, round(extract(epoch from (i.resolved_at - i.started_at)) / 60))
           ) order by i.started_at desc) as items
    from incidents i join s on s.id = i.site_id
    where i.resolved_at is not null and i.started_at >= (now() - interval '90 days')
    group by i.site_id
  )
  select case when not exists (select 1 from c) then null else json_build_object(
    'client', (select label from c),
    'generated_at', now(),
    'sites', coalesce((select json_agg(json_build_object(
        'domain', s.domain,
        'status', case when s.maintenance then 'maintenance'
                       when s.consecutive_failures >= 2 or s.has_incident then 'down'
                       else 'up' end,
        'uptime30', s.uptime30,
        'history', coalesce((select h.days from hist h where h.site_id = s.id), '[]'::json),
        'vigilance', (select json_build_object('checks', v.checks, 'uptime_pct', v.uptime_pct) from vig v where v.site_id = s.id),
        'incidents', coalesce((select i.items from inc i where i.site_id = s.id), '[]'::json)
      ) order by s.domain) from s), '[]'::json)
  ) end;
$$;

grant execute on function public_client_status(text) to anon, authenticated;
```

- [ ] **Step 2: Render them on the page**

In `apps/web/app/status/[slug]/StatusClient.tsx`, extend the types:

```tsx
type PublicIncident = { started_at: string; minutes: number };
type PublicVigilance = { checks: number; uptime_pct: number | null } | null;
type PublicSite = {
  domain: string;
  status: 'up' | 'down' | 'maintenance';
  uptime30: number | null;
  history?: DaySeg[];
  vigilance?: PublicVigilance;
  incidents?: PublicIncident[];
};
```

Add above the component:

```tsx
const fmtIncident = (i: PublicIncident) => {
  const d = new Date(i.started_at);
  const date = d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' });
  const time = d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });
  const m = Math.round(i.minutes);
  return `${date} o ${time} — výpadok ${m} ${m === 1 ? 'minúta' : m < 5 ? 'minúty' : 'minút'}, vyriešené`;
};
```

Inside the site card, after the daily strip block (`{hist.length > 0 && (…)}`), add:

```tsx
                  {s.vigilance && s.vigilance.checks > 0 && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#6b7280' }}>
                      Za 90 dní {s.vigilance.checks.toLocaleString('sk-SK').replace(/ /g, ' ')} kontrol dostupnosti
                      {s.vigilance.uptime_pct != null ? ` · ${Number(s.vigilance.uptime_pct).toFixed(2)} % dostupnosť` : ''}
                    </div>
                  )}
                  {(s.incidents?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f1f3' }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6b7280', marginBottom: 5 }}>História výpadkov (90 dní)</div>
                      {s.incidents!.slice(0, 10).map((i, idx) => (
                        <div key={idx} style={{ fontSize: 12, color: '#444', padding: '3px 0' }}>{fmtIncident(i)}</div>
                      ))}
                    </div>
                  )}
```

- [ ] **Step 3: Typecheck and build**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: no errors.

Run: `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… pnpm --filter web build`
Expected: `✓ Compiled successfully` and `/status/[slug]` in the generated route list.

- [ ] **Step 4: Verify the RPC leaks nothing**

After applying migration 0023 to the database, run:

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/public_client_status" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" -d '{"p_slug":"lopatka"}'
```

Expected: JSON containing `domain`, `status`, `uptime30`, `history`, `vigilance`, `incidents` — and **none** of: plugin names, versions, `cve`, `score`, `payload`, diary text.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/0023_public_status_incidents.sql apps/web/app/status/[slug]/StatusClient.tsx
git commit -m "feat(status): public incident history + vigilance proof"
```

---

## No task needed: weekly admin digest

The spec says the admin weekly digest gets richer. **No code change is required.**
`tools/weekly-digest/index.mjs` already reads `change_log` for the last 7 days and
passes `message` + `severity` into the digest's "Za posledný týždeň" section. The new
precise events (updates, fixed CVEs, fixed SEO types) are ordinary `change_log` rows
with a `message`, so they flow in automatically — including regressions, which is
correct for the admin audience.

**Verify after Task 7** rather than assuming: with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set,
run `node tools/weekly-digest/index.mjs` and confirm the log line reports a composed digest
(`digest.skipped` with `reason: resend_not_ready` is the expected outcome while Resend is unset).

## Deployment (after all tasks)

Migrations 0022 and 0023 must be applied to production, then the worker and web deployed:

```bash
pnpm --filter @agency/core test          # whole suite green
pnpm --filter web exec tsc --noEmit
pnpm --filter @agency/scheduler exec tsc --noEmit
# apply 0022 + 0023 to prod, then:
cd apps/scheduler && wrangler deploy      # wpIngest diff
pnpm --filter web build && wrangler pages deploy apps/web/out --project-name agency-dashboard --branch main
```

**Expect the first reports to be thin.** No update history exists retroactively; events accumulate only from deployment onward and the feature is fully visible after roughly a month.
