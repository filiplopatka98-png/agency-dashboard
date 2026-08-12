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
    // Strengthened: assert NO alert of any type fired (a spurious email_silent
    // would slip past an overdue()-only assertion — this reading also has
    // sent_24h: 0, and with no history rows typicalDaily14d is 0 < threshold,
    // so it must produce zero alerts, not just zero email_stuck alerts).
    expect(s.alerts).toHaveLength(0);
  });
  it('skips sites with provider null', async () => {
    const s = store([{ site_id: 'site-1', org_id: 'org-1', provider: null, last_success_at: h(8), queue_depth: 4, measured_at: h(0.1) }]);
    await runEmailHealth(env, { supabase: fakeSupabase(s), now: NOW });
    expect(overdue(s)).toHaveLength(0);
  });
});

describe('runEmailHealth — Rule 3 (silence) + typicalDaily14d median', () => {
  const silent = (s: FakeStore) => (s.alerts as { type: string }[]).filter((a) => a.type === 'email_silent');

  it('inserts email_silent when latest sent_24h is 0 but 14d history median is >= threshold', async () => {
    const s = store([
      // History: 3 readings over the last 3 days, sent_24h: 5 each → median 5 (>= EMAIL_SILENCE_MIN_DAILY of 3).
      { site_id: 'site-1', org_id: 'org-1', provider: 'FluentSMTP', last_success_at: h(25), queue_depth: 0, sent_24h: 5, failed_1h: 0, measured_at: h(24) },
      { site_id: 'site-1', org_id: 'org-1', provider: 'FluentSMTP', last_success_at: h(49), queue_depth: 0, sent_24h: 5, failed_1h: 0, measured_at: h(48) },
      { site_id: 'site-1', org_id: 'org-1', provider: 'FluentSMTP', last_success_at: h(73), queue_depth: 0, sent_24h: 5, failed_1h: 0, measured_at: h(72) },
      // Latest reading (most recent measured_at): went silent — no evidence of
      // a stuck queue (queue_depth 0, failed_1h 0, last_success_at recent),
      // so only Rule 3 (not Rule 2) should fire.
      { site_id: 'site-1', org_id: 'org-1', provider: 'FluentSMTP', last_success_at: h(1), queue_depth: 0, sent_24h: 0, failed_1h: 0, measured_at: h(0.1) },
    ]);
    await runEmailHealth(env, { supabase: fakeSupabase(s), now: NOW });
    expect(silent(s)).toHaveLength(1);
    expect(s.alerts).toHaveLength(1); // exactly one alert total — no spurious email_stuck alongside it
  });

  it('does not insert email_silent when the 14d history median is below the threshold', async () => {
    const s = store([
      // History: 3 readings with sent_24h: 1 each → median 1 (< EMAIL_SILENCE_MIN_DAILY of 3).
      { site_id: 'site-1', org_id: 'org-1', provider: 'FluentSMTP', last_success_at: h(25), queue_depth: 0, sent_24h: 1, failed_1h: 0, measured_at: h(24) },
      { site_id: 'site-1', org_id: 'org-1', provider: 'FluentSMTP', last_success_at: h(49), queue_depth: 0, sent_24h: 1, failed_1h: 0, measured_at: h(48) },
      { site_id: 'site-1', org_id: 'org-1', provider: 'FluentSMTP', last_success_at: h(73), queue_depth: 0, sent_24h: 1, failed_1h: 0, measured_at: h(72) },
      // Latest reading: also silent (sent_24h: 0), but baseline is too low to
      // call it unusual, so Rule 3 must NOT fire.
      { site_id: 'site-1', org_id: 'org-1', provider: 'FluentSMTP', last_success_at: h(1), queue_depth: 0, sent_24h: 0, failed_1h: 0, measured_at: h(0.1) },
    ]);
    await runEmailHealth(env, { supabase: fakeSupabase(s), now: NOW });
    expect(silent(s)).toHaveLength(0);
    expect(s.alerts).toHaveLength(0);
  });
});
