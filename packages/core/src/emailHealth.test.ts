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
