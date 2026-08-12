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
