import { describe, expect, it } from 'vitest';
import { runJobHealth } from './runJobHealth';
import { fakeSupabase, type FakeStore } from './fakeSupabase';
import type { Env } from './env';

const env = {} as Env;
const NOW = new Date('2026-07-20T12:00:00Z');
const FRESH = '2026-07-20T11:55:00Z'; // pár minút dozadu → NIE overdue pre žiadny job

function baseStore(): FakeStore {
  return { alerts: [], job_runs: [], organizations: [{ id: 'org-1' }] };
}

const jobFailed = (store: FakeStore) => store.alerts.filter((a) => a.type === 'job_failed');

describe('runJobHealth — job_failed pri zlyhanom zbere (FIX 2)', () => {
  it('posledný beh error → vloží job_failed alert', async () => {
    const store = baseStore();
    store.job_runs.push({ job: 'psi', status: 'error', error: 'GSC token expired', finished_at: FRESH });
    await runJobHealth(env, { supabase: fakeSupabase(store), now: NOW });
    const rows = jobFailed(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupe_key).toBe('job_failed:psi:2026-07-20');
    expect(rows[0]!.severity).toBe('warning');
    expect(rows[0]!.body).toContain('GSC token expired');
  });

  it('posledný beh ok → žiadny job_failed', async () => {
    const store = baseStore();
    store.job_runs.push({ job: 'psi', status: 'ok', finished_at: FRESH });
    await runJobHealth(env, { supabase: fakeSupabase(store), now: NOW });
    expect(jobFailed(store)).toHaveLength(0);
  });

  it('posledný beh partial → vloží job_failed alert (N webov zlyhalo)', async () => {
    const store = baseStore();
    store.job_runs.push({ job: 'psi', status: 'partial', failed: 3, finished_at: FRESH });
    await runJobHealth(env, { supabase: fakeSupabase(store), now: NOW });
    const rows = jobFailed(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toContain('3');
  });

  it('dvakrát v ten istý deň → len jeden job_failed riadok (dedupe)', async () => {
    const store = baseStore();
    store.job_runs.push({ job: 'psi', status: 'error', error: 'boom', finished_at: FRESH });
    await runJobHealth(env, { supabase: fakeSupabase(store), now: NOW });
    await runJobHealth(env, { supabase: fakeSupabase(store), now: NOW });
    expect(jobFailed(store)).toHaveLength(1);
  });

  it('používa najNOVŠÍ beh: starý error + nový ok → žiadny job_failed', async () => {
    const store = baseStore();
    store.job_runs.push({ job: 'psi', status: 'error', error: 'old', finished_at: '2026-07-20T09:00:00Z' });
    store.job_runs.push({ job: 'psi', status: 'ok', finished_at: FRESH });
    await runJobHealth(env, { supabase: fakeSupabase(store), now: NOW });
    expect(jobFailed(store)).toHaveLength(0);
  });

  it('týždenný job: ten istý partial beh v dva rôzne dni → len JEDEN alert (dedupe na dátum behu)', async () => {
    // aeo/seo bežia týždenne — partial beh ostane najnovší 7 dní. Dedupe na
    // dátum BEHU (nie na dnešok) → jeden zlyhaný beh upozorní práve raz, nie
    // každý deň až do budúceho pondelka.
    const store = baseStore();
    store.job_runs.push({ job: 'aeo', status: 'partial', failed: 1, finished_at: '2026-07-20T06:34:00Z' });
    await runJobHealth(env, { supabase: fakeSupabase(store), now: new Date('2026-07-20T12:00:00Z') });
    await runJobHealth(env, { supabase: fakeSupabase(store), now: new Date('2026-07-21T12:00:00Z') });
    const rows = jobFailed(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupe_key).toBe('job_failed:aeo:2026-07-20');
  });

  it('meta-job „scheduler" so status=error NEgeneruje job_failed; collector áno (FIX A)', async () => {
    const store = baseStore();
    // scheduler=error je bežný dôsledok jedného transientného zlyhania kroku
    // (napr. runWpCronKick raz hodí na krátko nedostupnom WP webe) — nesmie
    // vyrobiť nezmyselný „scheduler: zber zlyhal" e-mail.
    store.job_runs.push({ job: 'scheduler', status: 'error', error: 'wp_cron_kick: boom', finished_at: FRESH });
    store.job_runs.push({ job: 'psi', status: 'error', error: 'real collector fail', finished_at: FRESH });
    await runJobHealth(env, { supabase: fakeSupabase(store), now: NOW });
    const rows = jobFailed(store);
    expect(rows.map((r) => r.dedupe_key)).toEqual(['job_failed:psi:2026-07-20']);
  });
});
