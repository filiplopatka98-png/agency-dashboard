# WP e-mail deliverability monitoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect silent outbound-email failures on monitored WordPress sites and alert into the dashboard + e-mail within minutes of an acute failure.

**Architecture:** The WordPress agent (v2.2.0) aggregates FluentSMTP / WP Mail Logging counters via `$wpdb` and pushes an `email_health` object to `/wp-ingest` — event-driven on `wp_mail_failed` (debounced, ~1–5 min acute detection) plus a hourly heartbeat. The Worker validates the payload with Zod, stores a reading in a new `wp_email_health` table, evaluates the high-fail-rate rule at ingest time, and evaluates the stuck-queue / silence rules on its existing 5-min tick. Alerts land in the existing `alerts` table → dashboard + Resend e-mail. No new Cloudflare cron trigger, no new Worker dependency.

**Tech Stack:** TypeScript (strict), Zod (already a monorepo dep via `packages/shared`), Cloudflare Worker (`apps/scheduler`), Supabase Postgres + RLS, PHP (WP agent), Next.js (dashboard UI), Vitest.

## Global Constraints

- TypeScript `strict: true` — no `any`, no `@ts-ignore`.
- Zod validation at the agent boundary (`email_health` payload is untrusted WP input).
- No collector may crash the job runner — wrap in try/catch, log and continue; the ingest must still persist `wp_snapshots` even if `email_health` handling fails.
- Cloudflare **Free** plan, 3 MiB bundle — no new Worker dependencies (Zod already bundled).
- Cron cap 5 → **no new cron trigger**; branch inside `runTick`.
- Idempotent alerts: `dedupe_key` unique + `upsert(..., { onConflict: 'dedupe_key', ignoreDuplicates: true })`.
- RLS on the new table; multi-tenant `org_id` NOT NULL + `site_id` FK cascade.
- New migration file only (`0039_wp_email_health.sql`) — never edit an existing migration.
- Structured JSON logs including `site_id`.
- DB stores UTC; UI renders `Europe/Bratislava`, dates `D. M. RRRR`.
- UI copy in Slovak; code and commit messages in English.
- **No e-mail addresses or message bodies in the dashboard DB** — aggregates + a truncated, address-stripped error string only.
- Scoring/eval logic as pure functions with unit tests.
- `alerts.severity` is a Postgres enum `alert_severity ('critical','warning','info')` — only these values.
- `alerts.type` is free `text` — new types (`email_fail_rate`, `email_stuck`, `email_silent`) need no migration.

## File Structure

- **Create** `packages/db/supabase/migrations/0039_wp_email_health.sql` — new append-only table + RLS + retention.
- **Create** `packages/core/src/emailHealth.ts` — types, Zod payload schema, `readingFromPayload`, pure rule functions. The one place thresholds live.
- **Create** `packages/core/src/emailHealth.test.ts` — unit tests for the pure rules.
- **Modify** `packages/core/src/index.ts` — export the new module.
- **Modify** `packages/core/package.json` — add `zod` dependency (already in the monorepo; core needs it directly).
- **Modify** `packages/db/src/types.generated.ts` — hand-add `wp_email_health` row types.
- **Modify** `apps/scheduler/src/wpIngest.ts` — parse+validate `email_health`, insert reading, eval Rule 1.
- **Create** `apps/scheduler/src/runEmailHealth.ts` — tick collector: eval Rules 2 & 3.
- **Create** `apps/scheduler/src/runEmailHealth.test.ts` — unit test with `fakeSupabase`.
- **Modify** `apps/scheduler/src/fakeSupabase.ts` — add `wp_email_health` + `sites` to `FakeStore`.
- **Modify** `apps/scheduler/src/index.ts` — add `step('email_health', …)` to `runTick`.
- **Modify** `tools/wp-agent/monitorix-agent.php` — v2.2.0: provider detection, aggregation, `wp_mail_failed` hook + debounce, `email_health` in payload.
- **Modify** `apps/web/app/sites/TabInfra.tsx` (exact name TBD in Task 6) — new "Doručovanie e-mailov" panel.
- **Modify** `packages/core/src/digest.ts` + `tools/weekly-digest/index.mjs` — weekly e-mail-health line.

---

### Task 1: Migration `0039_wp_email_health`

**Files:**
- Create: `packages/db/supabase/migrations/0039_wp_email_health.sql`
- Modify: `packages/db/src/types.generated.ts`

**Interfaces:**
- Produces: table `wp_email_health` with columns `id, site_id, org_id, provider, sent_1h, failed_1h, failed_pct_1h, sent_24h, failed_24h, last_success_at, last_failure_at, last_failure_message, queue_depth, source, measured_at`.

- [ ] **Step 1: Write the migration** (mirrors `0036_perf_pages_history.sql` idioms — RLS helpers `private.user_orgs()` / `private.user_write_orgs()`, named retention cron)

```sql
-- WP e-mail deliverability monitoring. Append-only readings pushed by the WP
-- agent (event-driven on wp_mail_failed + hourly heartbeat). Aggregates only —
-- NO recipient addresses or message bodies (GDPR); last_failure_message is a
-- truncated, address-stripped string produced agent-side.
create table if not exists wp_email_health (
  id                   uuid primary key default gen_random_uuid(),
  site_id              uuid not null references sites on delete cascade,
  org_id               uuid not null references organizations on delete cascade,
  provider             text,
  sent_1h              int,
  failed_1h            int,
  failed_pct_1h        numeric,
  sent_24h             int,
  failed_24h           int,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  last_failure_message text,
  queue_depth          int,
  source               text not null,           -- 'event' | 'heartbeat'
  measured_at          timestamptz not null default now()
);
create index if not exists wp_email_health_site_measured_idx
  on wp_email_health (site_id, measured_at desc);

alter table wp_email_health enable row level security;
drop policy if exists "org members read" on wp_email_health;
drop policy if exists "staff write" on wp_email_health;
create policy "org members read" on wp_email_health for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on wp_email_health for all
  using (org_id in (select private.user_write_orgs()))
  with check (
    org_id in (select private.user_write_orgs())
    and site_id in (select id from sites where org_id in (select private.user_write_orgs()))
  );
grant select, insert, update, delete on wp_email_health to authenticated;
grant all on wp_email_health to service_role;

-- Retention: 90 days (rolling readings). Named job → re-run updates, not duplicates.
select cron.schedule('wp_email_health_retention', '40 2 * * *', $job$
  delete from wp_email_health where measured_at < now() - interval '90 days';
$job$);
```

- [ ] **Step 2: Verify idempotency by reading the file** — confirm every statement is `if not exists` / `drop policy if exists` / `create or replace` / named `cron.schedule`. No bare `create type`, no `alter … add column` without guard.

- [ ] **Step 3: Add DB row types** to `packages/db/src/types.generated.ts` (hand-added, mirroring the existing `perf_runs` block). Add a `wp_email_health` entry to the `Tables` interface with `Row`/`Insert`/`Update` shapes matching the columns above (all nullable except `id`, `site_id`, `org_id`, `source`, `measured_at`).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @agency/db typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/0039_wp_email_health.sql packages/db/src/types.generated.ts
git commit -m "feat(db): wp_email_health table + RLS + retention (migration 0039)"
```

> **Manual test (deploy time, Phase 3 rollout):** migration applies via `migrate.yml` (push to `packages/db/supabase/migrations/**`). Verify with `select count(*) from wp_email_health;` returns 0 and `\d wp_email_health` shows RLS enabled.

---

### Task 2: Core `emailHealth.ts` — types, Zod schema, pure rules

**Files:**
- Create: `packages/core/src/emailHealth.ts`
- Test: `packages/core/src/emailHealth.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './emailHealth.js';`)
- Modify: `packages/core/package.json` (add `"zod": "^3.25.76"` to `dependencies`)

**Interfaces:**
- Produces:
  - `emailHealthPayloadSchema` (Zod) and `EmailHealthPayload = z.infer<...>`
  - `interface EmailHealthReading` (DB-shaped; adds derived `failed_pct_1h`)
  - `readingFromPayload(p: EmailHealthPayload): EmailHealthReading`
  - `interface EmailHealthContext { siteId: string; domain: string; now: Date }`
  - `type EmailHealthAlertType = 'email_fail_rate' | 'email_stuck' | 'email_silent'`
  - `interface EmailHealthAlert { type: EmailHealthAlertType; severity: 'critical' | 'warning'; title: string; body: string; dedupeKey: string }`
  - `evaluateIngest(r: EmailHealthReading, ctx: EmailHealthContext): EmailHealthAlert[]` — Rule 1
  - `evaluatePeriodic(r: EmailHealthReading, typicalDaily14d: number, ctx: EmailHealthContext): EmailHealthAlert[]` — Rules 2 & 3
  - threshold constants (exported)

- [ ] **Step 1: Add zod to core deps**

Edit `packages/core/package.json` `dependencies` to include `"zod": "^3.25.76"`, then:

Run: `pnpm install`
Expected: lockfile updates, `@agency/core` resolves zod.

- [ ] **Step 2: Write the failing test** `packages/core/src/emailHealth.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  emailHealthPayloadSchema, readingFromPayload,
  evaluateIngest, evaluatePeriodic, type EmailHealthContext, type EmailHealthReading,
} from './emailHealth';

const CTX: EmailHealthContext = { siteId: 'site-1', domain: 'example.com', now: new Date('2026-08-12T12:00:00Z') };
const base: EmailHealthReading = {
  provider: 'FluentSMTP', sent_1h: 0, failed_1h: 0, failed_pct_1h: 0,
  sent_24h: 0, failed_24h: 0, last_success_at: null, last_failure_at: null,
  last_failure_message: null, queue_depth: 0,
};
const h = (n: number) => new Date(CTX.now.getTime() - n * 3_600_000).toISOString();

describe('emailHealthPayloadSchema', () => {
  it('rejects extra keys (strict) and wrong types', () => {
    expect(emailHealthPayloadSchema.safeParse({ provider: 'x', evil: 1 }).success).toBe(false);
    expect(emailHealthPayloadSchema.safeParse({ sent_1h: 'nope' }).success).toBe(false);
  });
  it('accepts nullable aggregates and derives failed_pct_1h', () => {
    const p = emailHealthPayloadSchema.parse({ provider: null, sent_1h: 9, failed_1h: 1 });
    const r = readingFromPayload(p);
    expect(r.failed_pct_1h).toBeCloseTo(0.1);
    expect(r.sent_24h).toBeNull();
  });
});

describe('Rule 1 — high fail rate (evaluateIngest)', () => {
  it('fires critical at >=10% with volume>=5', () => {
    const r = { ...base, sent_1h: 5, failed_1h: 5, failed_pct_1h: 0.5 };
    const a = evaluateIngest(r, CTX);
    expect(a).toHaveLength(1);
    expect(a[0]!.type).toBe('email_fail_rate');
    expect(a[0]!.severity).toBe('critical');
    expect(a[0]!.dedupeKey).toBe('email_fail_rate:site-1:2026-08-12');
  });
  it('does NOT fire below min volume (1 of 2)', () => {
    const r = { ...base, sent_1h: 1, failed_1h: 1, failed_pct_1h: 0.5 };
    expect(evaluateIngest(r, CTX)).toHaveLength(0);
  });
  it('does NOT fire below 10%', () => {
    const r = { ...base, sent_1h: 95, failed_1h: 5, failed_pct_1h: 0.05 };
    expect(evaluateIngest(r, CTX)).toHaveLength(0);
  });
  it('null provider → never fires', () => {
    expect(evaluateIngest({ ...base, provider: null, sent_1h: 5, failed_1h: 5, failed_pct_1h: 0.5 }, CTX)).toHaveLength(0);
  });
});

describe('Rule 2 — stuck with evidence (evaluatePeriodic)', () => {
  it('fires when last success >6h AND queue_depth>0', () => {
    const r = { ...base, last_success_at: h(7), queue_depth: 3 };
    const a = evaluatePeriodic(r, 0, CTX).filter((x) => x.type === 'email_stuck');
    expect(a).toHaveLength(1);
    expect(a[0]!.severity).toBe('warning');
  });
  it('fires when last success >6h AND failed_1h>0', () => {
    const r = { ...base, last_success_at: h(7), failed_1h: 2 };
    expect(evaluatePeriodic(r, 0, CTX).filter((x) => x.type === 'email_stuck')).toHaveLength(1);
  });
  it('does NOT fire for a quiet site at night (no evidence)', () => {
    const r = { ...base, last_success_at: h(9), queue_depth: 0, failed_1h: 0 };
    expect(evaluatePeriodic(r, 0, CTX).filter((x) => x.type === 'email_stuck')).toHaveLength(0);
  });
  it('does NOT fire when last success is recent', () => {
    const r = { ...base, last_success_at: h(2), queue_depth: 5 };
    expect(evaluatePeriodic(r, 0, CTX).filter((x) => x.type === 'email_stuck')).toHaveLength(0);
  });
});

describe('Rule 3 — total silence backstop (evaluatePeriodic)', () => {
  it('fires when typically active (>=3/day) but 0 sent in 24h', () => {
    const r = { ...base, sent_24h: 0, last_success_at: h(30) };
    expect(evaluatePeriodic(r, 12, CTX).filter((x) => x.type === 'email_silent')).toHaveLength(1);
  });
  it('does NOT fire for a permanently quiet site (baseline <3/day)', () => {
    const r = { ...base, sent_24h: 0 };
    expect(evaluatePeriodic(r, 1, CTX).filter((x) => x.type === 'email_silent')).toHaveLength(0);
  });
  it('does NOT fire when the site did send in 24h', () => {
    const r = { ...base, sent_24h: 4 };
    expect(evaluatePeriodic(r, 12, CTX).filter((x) => x.type === 'email_silent')).toHaveLength(0);
  });
  it('null provider → never fires either rule', () => {
    expect(evaluatePeriodic({ ...base, provider: null, sent_24h: 0 }, 12, CTX)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @agency/core test -- emailHealth`
Expected: FAIL (module not found)

- [ ] **Step 4: Implement `packages/core/src/emailHealth.ts`**

```ts
import { z } from 'zod';

// Thresholds — single source of truth. Tune here.
export const EMAIL_FAIL_PCT_THRESHOLD = 0.1;   // Rule 1: >=10% failure
export const EMAIL_MIN_VOLUME = 5;             // Rule 1: min sent+failed in 1h
export const EMAIL_STUCK_HOURS = 6;            // Rule 2: last success older than
export const EMAIL_SILENCE_HOURS = 24;         // Rule 3: window with 0 sent
export const EMAIL_SILENCE_MIN_DAILY = 3;      // Rule 3: baseline "typically active"

// Untrusted WP payload (agent boundary). `.strict()` rejects unknown keys.
// failed_pct is DERIVED server-side (never trust agent math).
export const emailHealthPayloadSchema = z
  .object({
    provider: z.string().max(120).nullable().optional(),
    sent_1h: z.number().int().nonnegative().nullable().optional(),
    failed_1h: z.number().int().nonnegative().nullable().optional(),
    sent_24h: z.number().int().nonnegative().nullable().optional(),
    failed_24h: z.number().int().nonnegative().nullable().optional(),
    last_success_at: z.string().max(40).nullable().optional(),
    last_failure_at: z.string().max(40).nullable().optional(),
    last_failure_message: z.string().max(300).nullable().optional(),
    queue_depth: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();
export type EmailHealthPayload = z.infer<typeof emailHealthPayloadSchema>;

export interface EmailHealthReading {
  provider: string | null;
  sent_1h: number | null;
  failed_1h: number | null;
  failed_pct_1h: number | null;
  sent_24h: number | null;
  failed_24h: number | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_message: string | null;
  queue_depth: number | null;
}

const n = (v: number | null | undefined): number | null => (v ?? null);

export function readingFromPayload(p: EmailHealthPayload): EmailHealthReading {
  const sent1 = n(p.sent_1h);
  const failed1 = n(p.failed_1h);
  const total1 = (sent1 ?? 0) + (failed1 ?? 0);
  const failedPct = sent1 === null && failed1 === null ? null : total1 === 0 ? 0 : (failed1 ?? 0) / total1;
  return {
    provider: p.provider ?? null,
    sent_1h: sent1,
    failed_1h: failed1,
    failed_pct_1h: failedPct,
    sent_24h: n(p.sent_24h),
    failed_24h: n(p.failed_24h),
    last_success_at: p.last_success_at ?? null,
    last_failure_at: p.last_failure_at ?? null,
    last_failure_message: p.last_failure_message ?? null,
    queue_depth: n(p.queue_depth),
  };
}

export interface EmailHealthContext {
  siteId: string;
  domain: string;
  now: Date;
}

export type EmailHealthAlertType = 'email_fail_rate' | 'email_stuck' | 'email_silent';
export interface EmailHealthAlert {
  type: EmailHealthAlertType;
  severity: 'critical' | 'warning';
  title: string;
  body: string;
  dedupeKey: string;
}

const day = (now: Date): string => now.toISOString().slice(0, 10);
const hoursSince = (iso: string | null, now: Date): number | null =>
  iso ? (now.getTime() - Date.parse(iso)) / 3_600_000 : null;

// Rule 1 — high failure rate. Runs at ingest (event-driven → fastest).
export function evaluateIngest(r: EmailHealthReading, ctx: EmailHealthContext): EmailHealthAlert[] {
  if (r.provider === null) return [];
  const sent = r.sent_1h ?? 0;
  const failed = r.failed_1h ?? 0;
  const total = sent + failed;
  if (total < EMAIL_MIN_VOLUME) return [];
  const pct = r.failed_pct_1h ?? (total === 0 ? 0 : failed / total);
  if (pct < EMAIL_FAIL_PCT_THRESHOLD) return [];
  return [
    {
      type: 'email_fail_rate',
      severity: 'critical',
      title: `${ctx.domain}: e-maily zlyhávajú`,
      body: `Za poslednú hodinu zlyhalo ${failed} z ${total} e-mailov (${Math.round(pct * 100)} %). Používatelia nemusia dostávať resety hesiel ani platobné notifikácie.${r.last_failure_message ? ` Chyba: ${r.last_failure_message}` : ''}`,
      dedupeKey: `email_fail_rate:${ctx.siteId}:${day(ctx.now)}`,
    },
  ];
}

// Rules 2 & 3 — stuck-with-evidence and total-silence backstop. Runs on the tick.
export function evaluatePeriodic(
  r: EmailHealthReading,
  typicalDaily14d: number,
  ctx: EmailHealthContext,
): EmailHealthAlert[] {
  if (r.provider === null) return [];
  const out: EmailHealthAlert[] = [];

  const sinceSuccess = hoursSince(r.last_success_at, ctx.now);
  const hasEvidence = (r.queue_depth ?? 0) > 0 || (r.failed_1h ?? 0) > 0;
  if (sinceSuccess !== null && sinceSuccess > EMAIL_STUCK_HOURS && hasEvidence) {
    out.push({
      type: 'email_stuck',
      severity: 'warning',
      title: `${ctx.domain}: e-maily sa neodosielajú`,
      body: `Posledný úspešný e-mail bol pred ${Math.round(sinceSuccess)} h, no ${(r.queue_depth ?? 0) > 0 ? `vo fronte čaká ${r.queue_depth} správ` : `pribúdajú zlyhania (${r.failed_1h} za hodinu)`}. Odosielanie je pravdepodobne zaseknuté.`,
      dedupeKey: `email_stuck:${ctx.siteId}:${day(ctx.now)}`,
    });
  }

  if (typicalDaily14d >= EMAIL_SILENCE_MIN_DAILY && (r.sent_24h ?? 0) === 0) {
    out.push({
      type: 'email_silent',
      severity: 'warning',
      title: `${ctx.domain}: žiadne odoslané e-maily`,
      body: `Web zvyčajne posiela ~${Math.round(typicalDaily14d)} e-mailov denne, no za posledných ${EMAIL_SILENCE_HOURS} h neodoslal ani jeden. Overte odosielanie e-mailov.`,
      dedupeKey: `email_silent:${ctx.siteId}:${day(ctx.now)}`,
    });
  }

  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @agency/core test -- emailHealth`
Expected: PASS (all cases)

- [ ] **Step 6: Export from the barrel** — add `export * from './emailHealth.js';` to `packages/core/src/index.ts`.

- [ ] **Step 7: Build + typecheck core**

Run: `pnpm --filter @agency/core build && pnpm --filter @agency/core typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/emailHealth.ts packages/core/src/emailHealth.test.ts packages/core/src/index.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): emailHealth rules + Zod payload schema (pure, tested)"
```

---

### Task 3: Ingest wiring — `wpIngest.ts` validates + stores + evaluates Rule 1

**Files:**
- Modify: `apps/scheduler/src/wpIngest.ts`

**Interfaces:**
- Consumes: `emailHealthPayloadSchema`, `readingFromPayload`, `evaluateIngest`, `EmailHealthReading` from `@agency/core`.
- Produces: rows in `wp_email_health` and `alerts` (type `email_fail_rate`).

- [ ] **Step 1: Extend `WpPayload`** — add one optional field (the sub-object stays untyped here; Zod validates it):

```ts
interface WpPayload {
  // …existing fields…
  email_health?: unknown;
}
```

- [ ] **Step 2: Add the email-health block** after the successful `wp_snapshots` upsert (after line 96, before the `change_log` block). It must be fully wrapped so it can never fail the ingest response:

```ts
  // E-mail deliverability (best-effort; must never fail the ingest). The payload
  // is untrusted → Zod at the boundary. source distinguishes the wp_mail_failed
  // event push from the hourly heartbeat.
  if (body.email_health !== undefined) {
    const parsed = emailHealthPayloadSchema.safeParse(body.email_health);
    if (!parsed.success) {
      console.log(JSON.stringify({ ev: 'wp.email_health_invalid', site_id: site.id, issues: parsed.error.issues.length }));
    } else {
      const reading = readingFromPayload(parsed.data);
      const source = request.headers.get('x-monitorix-source') === 'event' ? 'event' : 'heartbeat';
      const { error: ehErr } = await db.from('wp_email_health').insert({
        site_id: site.id,
        org_id: site.org_id,
        provider: reading.provider,
        sent_1h: reading.sent_1h,
        failed_1h: reading.failed_1h,
        failed_pct_1h: reading.failed_pct_1h,
        sent_24h: reading.sent_24h,
        failed_24h: reading.failed_24h,
        last_success_at: reading.last_success_at,
        last_failure_at: reading.last_failure_at,
        last_failure_message: reading.last_failure_message,
        queue_depth: reading.queue_depth,
        source,
      });
      if (ehErr) console.log(JSON.stringify({ ev: 'wp.email_health_insert_fail', site_id: site.id, message: ehErr.message }));

      // Rule 1 at ingest → fastest path for the acute case.
      const alerts = evaluateIngest(reading, { siteId: site.id, domain: site.domain, now: new Date() });
      if (alerts.length) {
        const { error: aErr } = await db.from('alerts').upsert(
          alerts.map((a) => ({ org_id: site.org_id, site_id: site.id, type: a.type, severity: a.severity, title: a.title, body: a.body, dedupe_key: a.dedupeKey })),
          { onConflict: 'dedupe_key', ignoreDuplicates: true },
        );
        if (aErr) console.log(JSON.stringify({ ev: 'wp.email_alert_fail', site_id: site.id, message: aErr.message }));
        else console.log(JSON.stringify({ ev: 'wp.email_alert', site_id: site.id, types: alerts.map((a) => a.type) }));
      }
    }
  }
```

- [ ] **Step 3: Add the import** at the top of `wpIngest.ts`:

```ts
import { diffCore, diffPlugins, emailHealthPayloadSchema, readingFromPayload, evaluateIngest, type ChangeEvent } from '@agency/core';
```

- [ ] **Step 4: Typecheck the worker**

Run: `pnpm --filter @agency/scheduler typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/scheduler/src/wpIngest.ts
git commit -m "feat(scheduler): ingest email_health — Zod validate, store reading, eval Rule 1"
```

> **Manual test (deployed Worker):** POST a crafted `email_health` (sent_1h=5, failed_1h=5) with header `X-Monitorix-Source: event` to `/wp-ingest` for a known domain → a `wp_email_health` row and an `email_fail_rate` alert appear; malformed `email_health` logs `wp.email_health_invalid` and still returns `{ ok: true }`.

---

### Task 4: Tick collector — `runEmailHealth.ts` (Rules 2 & 3) + wire into `runTick`

**Files:**
- Create: `apps/scheduler/src/runEmailHealth.ts`
- Test: `apps/scheduler/src/runEmailHealth.test.ts`
- Modify: `apps/scheduler/src/fakeSupabase.ts` (add `wp_email_health` + `sites` to `FakeStore`)
- Modify: `apps/scheduler/src/index.ts` (add `step('email_health', …)` before `alerts`)

**Interfaces:**
- Consumes: `evaluatePeriodic`, `EmailHealthReading` from `@agency/core`; `serviceClient` from `./supabase`.
- Produces: `export async function runEmailHealth(env: Env, deps?: { supabase?: SupabaseClient; now?: Date }): Promise<void>`; inserts `email_stuck` / `email_silent` alerts.

- [ ] **Step 1: Extend `FakeStore`** in `fakeSupabase.ts` — add to the interface:

```ts
  wp_email_health?: Record<string, unknown>[];
  sites?: Record<string, unknown>[];
```

- [ ] **Step 2: Write the failing test** `apps/scheduler/src/runEmailHealth.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { runEmailHealth } from './runEmailHealth';
import { fakeSupabase, type FakeStore } from './fakeSupabase';
import type { Env } from './env';

const env = {} as Env;
const NOW = new Date('2026-08-12T12:00:00Z');
const h = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

function store(readings: Record<string, unknown>[]): FakeStore {
  return {
    alerts: [], job_runs: [], organizations: [{ id: 'org-1' }],
    sites: [{ id: 'site-1', org_id: 'org-1', domain: 'example.com', is_active: true }],
    wp_email_health: readings,
  };
}
const overdue = (s: FakeStore) => (s.alerts as { type: string }[]).filter((a) => a.type === 'email_stuck');

describe('runEmailHealth — Rule 2 (stuck)', () => {
  it('inserts email_stuck when latest reading is stuck with evidence', async () => {
    const s = store([{ site_id: 'site-1', org_id: 'org-1', provider: 'FluentSMTP', last_success_at: h(8), queue_depth: 4, sent_24h: 0, failed_1h: 0, measured_at: h(0.1) }]);
    await runEmailHealth(env, { supabase: fakeSupabase(s), now: NOW });
    expect(overdue(s)).toHaveLength(1);
  });
  it('does not alert a quiet site (no evidence)', async () => {
    const s = store([{ site_id: 'site-1', org_id: 'org-1', provider: 'FluentSMTP', last_success_at: h(8), queue_depth: 0, sent_24h: 0, failed_1h: 0, measured_at: h(0.1) }]);
    await runEmailHealth(env, { supabase: fakeSupabase(s), now: NOW });
    expect(overdue(s)).toHaveLength(0);
  });
  it('skips sites with provider null', async () => {
    const s = store([{ site_id: 'site-1', org_id: 'org-1', provider: null, last_success_at: h(8), queue_depth: 4, measured_at: h(0.1) }]);
    await runEmailHealth(env, { supabase: fakeSupabase(s), now: NOW });
    expect(overdue(s)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @agency/scheduler test -- runEmailHealth`
Expected: FAIL (module not found)

- [ ] **Step 4: Implement `apps/scheduler/src/runEmailHealth.ts`**

```ts
import { evaluatePeriodic, EMAIL_SILENCE_HOURS, type EmailHealthReading } from '@agency/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { serviceClient } from './supabase';

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Tick collector: evaluates the slow-burn e-mail rules (2 stuck, 3 silence) from
 * the LATEST wp_email_health reading per active site. Rule 1 (high fail rate) is
 * handled at ingest (event-driven), not here. Never throws — collector-safe.
 */
export async function runEmailHealth(env: Env, deps: { supabase?: SupabaseClient; now?: Date } = {}): Promise<void> {
  const db = deps.supabase ?? serviceClient(env);
  const now = deps.now ?? new Date();

  const { data: sites, error: sErr } = await db.from('sites').select('id, org_id, domain').eq('is_active', true);
  if (sErr) {
    console.log(JSON.stringify({ ev: 'email_health.sites_fail', message: sErr.message }));
    return;
  }

  const rows: { type: string; severity: string; title: string; body: string; dedupe_key: string; org_id: string; site_id: string }[] = [];

  for (const site of sites ?? []) {
    // Latest reading (Rule 2) + 14d window of sent_24h (Rule 3 baseline).
    const { data: latest } = await db
      .from('wp_email_health')
      .select('provider, sent_1h, failed_1h, failed_pct_1h, sent_24h, failed_24h, last_success_at, last_failure_at, last_failure_message, queue_depth')
      .eq('site_id', site.id)
      .order('measured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest || latest.provider === null) continue;

    const since = new Date(now.getTime() - 14 * 24 * 3_600_000).toISOString();
    const { data: hist } = await db
      .from('wp_email_health')
      .select('sent_24h, measured_at')
      .eq('site_id', site.id)
      .gte('measured_at', since);
    const typicalDaily14d = median((hist ?? []).map((r) => (r.sent_24h ?? 0) as number).filter((v) => v > 0));

    const reading = latest as unknown as EmailHealthReading;
    const alerts = evaluatePeriodic(reading, typicalDaily14d, { siteId: site.id, domain: site.domain, now });
    for (const a of alerts) rows.push({ ...a, dedupe_key: a.dedupeKey, org_id: site.org_id, site_id: site.id });
  }

  if (!rows.length) {
    console.log(JSON.stringify({ ev: 'email_health.ok', sites: (sites ?? []).length }));
    return;
  }
  const { error: aErr } = await db.from('alerts').upsert(
    rows.map(({ dedupeKey: _drop, ...r }: { dedupeKey?: string } & Record<string, unknown>) => r),
    { onConflict: 'dedupe_key', ignoreDuplicates: true },
  );
  if (aErr) console.log(JSON.stringify({ ev: 'email_health.alert_fail', message: aErr.message }));
  else console.log(JSON.stringify({ ev: 'email_health.alert', count: rows.length }));
}
```

> Note: `EMAIL_SILENCE_HOURS` import is illustrative of the `sent_24h`-as-24h-window assumption; the value lives in core. The `.gte` chain must exist in `fakeSupabase` — add a `gte` method mirroring `eq` (push `['gte', col, val]` and compare with `>=` on ISO strings) in Step 1 if not already present.

- [ ] **Step 5: Add `gte` to `fakeSupabase`** — extend the `Filter` type to `['is'|'eq'|'gte', string, unknown]`, add a `gte(col, val)` method, and in `matches` handle `gte` as `String(row[col]) >= String(val)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @agency/scheduler test -- runEmailHealth`
Expected: PASS

- [ ] **Step 7: Wire into `runTick`** in `apps/scheduler/src/index.ts`. Add to the `TickSteps` interface (optional injectable) and the resolver default, then insert the step BEFORE the final `alerts` step:

```ts
// in the steps block (after job_health, before alerts):
await step('email_health', () => emailHealth(env)); // e-mail deliverability (Rules 2 & 3)
```

Add the resolver default alongside the others (mirroring `jobHealth`):

```ts
const emailHealth = steps.runEmailHealth ?? ((e: Env) => runEmailHealth(e));
```

and `import { runEmailHealth } from './runEmailHealth';` at the top, plus `runEmailHealth?: (env: Env) => Promise<unknown>;` in `TickSteps`.

- [ ] **Step 8: Run the full scheduler suite**

Run: `pnpm --filter @agency/scheduler test`
Expected: PASS (existing + new)

- [ ] **Step 9: Commit**

```bash
git add apps/scheduler/src/runEmailHealth.ts apps/scheduler/src/runEmailHealth.test.ts apps/scheduler/src/fakeSupabase.ts apps/scheduler/src/index.ts
git commit -m "feat(scheduler): runEmailHealth tick collector (Rules 2 & 3) + wire into runTick"
```

---

### Task 5: WP agent v2.2.0 — provider detection, aggregation, `wp_mail_failed` event

**Files:**
- Modify: `tools/wp-agent/monitorix-agent.php`

**Interfaces:**
- Produces: `email_health` object in the push payload; an event-driven push with header `X-Monitorix-Source: event`.

- [ ] **Step 1: Bump version** — `Version: 2.2.0` in the header and `define('MONITORIX_AGENT_VERSION', '2.2.0');`.

- [ ] **Step 2: Add provider detection + aggregation** — a new function that returns the `email_health` array or `null`. It probes FluentSMTP first, then WP Mail Logging, else returns `null`:

```php
/**
 * E-mail deliverability aggregates from the SMTP log plugin. Read-only.
 * Returns null if no supported log table exists. NO recipient addresses or
 * bodies leave the site — only counts + a sanitized last error.
 */
function monitorix_agent_email_health()
{
    global $wpdb;

    // FluentSMTP — verify the real table name at runtime (do not assume).
    $fsmtp = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}fsmpt_email_logs'");
    if ($fsmtp) {
        return monitorix_agent_agg($wpdb->prefix . 'fsmpt_email_logs', 'status', 'created_at', "status = 'failed'", "status = 'sent'", 'FluentSMTP');
    }
    // WP Mail Logging fallback.
    $wpml = $wpdb->get_var("SHOW TABLES LIKE '{$wpdb->prefix}wpml_mails'");
    if ($wpml) {
        // WP Mail Logging does not always record status; treat presence as sent, error column as failure if available.
        return monitorix_agent_agg($wpdb->prefix . 'wpml_mails', null, 'timestamp', null, null, 'WP Mail Logging');
    }
    return null; // no provider → dashboard shows "not monitored", NOT zero.
}

/** Windowed counts + last success/failure from a log table. */
function monitorix_agent_agg($table, $statusCol, $timeCol, $failedWhere, $sentWhere, $providerName)
{
    global $wpdb;
    $now = current_time('timestamp', true); // UTC
    $win1h  = gmdate('Y-m-d H:i:s', $now - HOUR_IN_SECONDS);
    $win24h = gmdate('Y-m-d H:i:s', $now - DAY_IN_SECONDS);

    $count = function ($where, $sinceCol) use ($wpdb, $table, $timeCol) {
        $sql = "SELECT COUNT(*) FROM `$table` WHERE `$timeCol` >= %s" . ($where ? " AND $where" : '');
        return (int) $wpdb->get_var($wpdb->prepare($sql, $sinceCol));
    };

    $sent1h   = $sentWhere   ? $count($sentWhere, $win1h)   : $count('1=1', $win1h);
    $failed1h = $failedWhere ? $count($failedWhere, $win1h) : 0;
    $sent24h  = $sentWhere   ? $count($sentWhere, $win24h)  : $count('1=1', $win24h);
    $failed24h= $failedWhere ? $count($failedWhere, $win24h): 0;

    $lastSuccess = $sentWhere
        ? $wpdb->get_var("SELECT MAX(`$timeCol`) FROM `$table` WHERE $sentWhere")
        : $wpdb->get_var("SELECT MAX(`$timeCol`) FROM `$table`");
    $lastFailAt = $failedWhere ? $wpdb->get_var("SELECT MAX(`$timeCol`) FROM `$table` WHERE $failedWhere") : null;

    // Last failure message — sanitized: strip anything that looks like an e-mail address.
    $lastFailMsg = null;
    if ($failedWhere) {
        $raw = $wpdb->get_var("SELECT `response` FROM `$table` WHERE $failedWhere ORDER BY `$timeCol` DESC LIMIT 1");
        if ($raw) {
            $raw = preg_replace('/[\w.+-]+@[\w.-]+/', '[email]', (string) $raw);
            $lastFailMsg = mb_substr(trim($raw), 0, 200);
        }
    }

    $iso = function ($v) { return $v ? gmdate('c', strtotime($v . ' UTC')) : null; };

    return [
        'provider'             => $providerName,
        'sent_1h'              => $sent1h,
        'failed_1h'            => $failed1h,
        'sent_24h'             => $sent24h,
        'failed_24h'           => $failed24h,
        'last_success_at'      => $iso($lastSuccess),
        'last_failure_at'      => $iso($lastFailAt),
        'last_failure_message' => $lastFailMsg,
        'queue_depth'          => null, // best-effort; FluentSMTP queue not reliably exposed
    ];
}
```

> The `response` column and `status` values (`'sent'`/`'failed'`) MUST be verified on a live FluentSMTP install during rollout (Task 7 manual step). If they differ, adjust `$failedWhere`/`$sentWhere`/`response` here — this is the one place with a runtime-schema assumption.

- [ ] **Step 3: Add `email_health` to the payload** in `monitorix_agent_do_push` — after `$payload` is built, add:

```php
    $payload['email_health'] = monitorix_agent_email_health();
```

- [ ] **Step 4: Add the event-driven push** — hook WordPress core `wp_mail_failed`, debounced to at most one event push per 10 min via a transient:

```php
// Event-driven: the instant a send fails, push immediately (debounced) so the
// dashboard sees an acute outage within minutes — not at the next hourly beat.
add_action('wp_mail_failed', function ($wp_error) {
    if (get_transient('monitorix_agent_mail_fail_kick')) {
        return; // debounce: at most one event push / 10 min
    }
    set_transient('monitorix_agent_mail_fail_kick', 1, 10 * MINUTE_IN_SECONDS);
    monitorix_agent_do_push('event');
});
```

- [ ] **Step 5: Thread the `source` header** — change `monitorix_agent_do_push` to accept an optional source and send it:

```php
function monitorix_agent_do_push($source = 'heartbeat')
{
    // …existing collection…
    wp_remote_post(MONITORIX_INGEST_URL, [
        'timeout'  => 15,
        'blocking' => false,
        'headers'  => [
            'Content-Type'      => 'application/json',
            'X-Monitorix-Token' => MONITORIX_INGEST_TOKEN,
            'X-Monitorix-Source'=> is_string($source) ? $source : 'heartbeat',
        ],
        'body'     => wp_json_encode($payload),
    ]);
}
```

> Note: `wp_mail_failed` passes a `WP_Error`; the hook signature above accepts it but the agent recomputes aggregates from the log table (does not trust the single error) — the event is only a *trigger*. `do_action` callbacks receive one arg, matching `monitorix_agent_do_push`'s optional param default when called by cron.

- [ ] **Step 6: Change the hourly heartbeat** — the daily schedule becomes hourly for fresher email-health (still cheap; single wp_remote_post). In the `init` action, replace `'daily'` with `'hourly'`:

```php
        wp_schedule_event(time() + 60, 'hourly', 'monitorix_agent_push');
```

- [ ] **Step 7: Lint the PHP** (syntax check)

Run: `php -l tools/wp-agent/monitorix-agent.php`
Expected: `No syntax errors detected`

- [ ] **Step 8: Commit**

```bash
git add tools/wp-agent/monitorix-agent.php
git commit -m "feat(wp-agent): v2.2.0 email deliverability — provider detect, aggregates, wp_mail_failed event push"
```

> **Manual test (rollout):** on a real WP site with FluentSMTP, deactivate/misconfigure SMTP, send a test mail → within ~1–5 min an `email_fail_rate` alert appears in the dashboard and an e-mail arrives. Verify NO recipient addresses appear in `wp_email_health.last_failure_message`.

---

### Task 6: UI — "Doručovanie e-mailov" panel in the Infra tab

**Files:**
- Modify: the Infra tab component under `apps/web/app/sites/` (identify the exact file first, e.g. `TabInfra.tsx`)

**Interfaces:**
- Consumes: `wp_email_health` latest row per site via client-side Supabase (RLS).

- [ ] **Step 1: Locate the Infra tab component**

Run: `grep -rln "Infra" apps/web/app/sites/`
Expected: the tab component file (note its exact name for the steps below).

- [ ] **Step 2: Add a client hook** that reads the latest `wp_email_health` row for the site:

```ts
// query: from('wp_email_health').select('*').eq('site_id', siteId).order('measured_at', { ascending: false }).limit(1).maybeSingle()
```

- [ ] **Step 3: Render the panel** following the existing Infra panel styles. Show: `provider` (or the "agent nenašiel FluentSMTP ani WP Mail Logging" empty state when `provider` is null), `sent_1h`/`failed_1h` and `sent_24h`/`failed_24h` (failed in red when >0), `last_success_at` and `last_failure_at` formatted `Europe/Bratislava` as `D. M. RRRR`, truncated `last_failure_message`, and a status badge (green when `failed_pct_1h < 0.1`, red at/above). Dates use the existing date formatter used elsewhere in the app (find via `grep -rn "Europe/Bratislava" apps/web`).

- [ ] **Step 4: Visual verification** — run the dev server, open a site detail → Infra tab, confirm the panel renders for a site with data and shows the empty state for a site without a provider.

Run: (Browser preview) start dev server, navigate to a site detail, screenshot.

- [ ] **Step 5: Typecheck + lint web**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/sites/
git commit -m "feat(web): e-mail deliverability panel in Infra tab"
```

---

### Task 7: Weekly digest — e-mail health line

**Files:**
- Modify: `packages/core/src/digest.ts`
- Modify: `packages/core/src/digest.test.ts`
- Modify: `tools/weekly-digest/index.mjs`

**Interfaces:**
- Consumes: latest `wp_email_health` per site (in the collector).
- Produces: a new `DigestSite.email` field rendered in HTML + text.

- [ ] **Step 1: Write the failing test** — extend `digest.test.ts` to assert the e-mail line renders when `email` is present:

```ts
it('renders e-mail health line when present', () => {
  const out = renderDigest({
    weekLabel: 't', orgName: 'o',
    sites: [{ domain: 'x.sk', status: 'up', uptime30: 100, openIssues: 0, vulns: 0, criticalVulns: 0, attention: [], email: { sent: 40, failed: 3 } }],
  });
  expect(out.text).toContain('odoslaných 40');
  expect(out.html).toContain('40');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @agency/core test -- digest`
Expected: FAIL (type error: `email` not on `DigestSite`)

- [ ] **Step 3: Extend `DigestSite`** in `digest.ts`:

```ts
export interface DigestSite {
  // …existing…
  email?: { sent: number; failed: number } | null; // týždenné odoslané/zlyhané; null = nemonitorované
}
```

- [ ] **Step 4: Render it** — in the HTML `badges` block add (after SEO issues), and in the text `extra` block:

```ts
// HTML (inside the row builder):
if (s.email) badges.push(`<span style="color:${s.email.failed > 0 ? '#dc2626' : '#6b7280'}">e-maily: ${s.email.sent} odoslaných${s.email.failed ? `, ${s.email.failed} zlyhaných` : ''}</span>`);
// text (inside extra array):
s.email ? `e-maily: odoslaných ${s.email.sent}${s.email.failed ? `, zlyhaných ${s.email.failed}` : ''}` : '',
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @agency/core test -- digest`
Expected: PASS

- [ ] **Step 6: Populate in the collector** `tools/weekly-digest/index.mjs` — add `wp_email_health` to the per-site `Promise.all` fetch (latest row per site), then in the site-mapping loop set `email: eh ? { sent: eh.sent_24h ?? 0, failed: eh.failed_24h ?? 0 } : null`. (Use the existing `by(...)` map pattern for latest-per-site.)

- [ ] **Step 7: Build core + run core tests**

Run: `pnpm --filter @agency/core build && pnpm --filter @agency/core test -- digest`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/digest.ts packages/core/src/digest.test.ts tools/weekly-digest/index.mjs
git commit -m "feat(digest): weekly e-mail deliverability line per site"
```

---

## Final verification (before deploy)

- [ ] `pnpm run test` (whole workspace) — PASS
- [ ] `pnpm typecheck` — PASS
- [ ] `pnpm lint` — PASS
- [ ] `php -l tools/wp-agent/monitorix-agent.php` — no syntax errors

## Deploy sequence (Phase 3 rollout — owner "go" required)

1. Push `main` + `v*` tag → CI deploys Worker (ingest + tick) and web.
2. `migrate.yml` applies `0039` (push to `migrations/**`).
3. Re-upload `monitorix-agent.php` v2.2.0 to each monitored WP site (manual/owner).
4. If `soccercoacheshub.com` is to be monitored: add it as a `sites` row + install the agent.
5. Verify on the deployed Worker (wrangler dev lies): real agent push → `wp_email_health` row → alert → Resend e-mail; UI panel; next Monday digest line.

## Self-review notes

- **Spec coverage:** metrics (Task 5), 2 alert rules + evidence-based stuck + silence backstop (Task 2), event-driven ~1–5 min (Tasks 3+5), Zod boundary (Tasks 2+3), collector-safe (Tasks 3+4), no new cron/dep (Task 4, zod pre-bundled), RLS table (Task 1), UI Infra panel (Task 6), weekly digest (Task 7), GDPR sanitization (Tasks 1+5). All covered.
- **Thresholds** all live in `emailHealth.ts` constants (Task 2).
- **Type consistency:** `EmailHealthReading`, `EmailHealthAlert`, `evaluateIngest`, `evaluatePeriodic`, `readingFromPayload`, `emailHealthPayloadSchema` used identically across Tasks 2/3/4.
