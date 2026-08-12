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
