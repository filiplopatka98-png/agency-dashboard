import { describe, expect, it } from 'vitest';
import type { Alert } from '@agency/shared';
import type { Notifier } from '@agency/core';
import { MAX_SENDS_PER_TICK, runAlerts } from './runAlerts';
import { fakeSupabase, type FakeAlertRow, type FakeStore } from './fakeSupabase';
import type { Env } from './env';

const env: Env = {
  SUPABASE_URL: 'http://local',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 're_fake',
  PSI_API_KEY: '',
  ALERT_EMAIL_TO: 'to@lopatka.sk',
  ALERT_EMAIL_FROM: 'from@lopatka.sk',
  UPTIME_PROVIDER: 'local',
  WP_INGEST_TOKEN: '',
  GH_DISPATCH_TOKEN: '',
  GH_REPO: '',
};

const DAY = new Date('2026-07-15T12:00:00Z'); // 14:00 lokál → deň (nič sa neodkladá)

function alertRow(over: Partial<FakeAlertRow> & { id: string; created_at: string }): FakeAlertRow {
  return {
    org_id: 'org-1',
    site_id: null,
    type: 'site_down',
    severity: 'critical',
    title: 't',
    body: 'b',
    dedupe_key: `k:${over.id}`,
    sent_at: null,
    ...over,
  };
}

describe('runAlerts — poison-pill izolácia (FIX 1)', () => {
  it('jeden zlyhaný send neblokuje ostatné; sent_at sa nastaví len úspešným', async () => {
    const store: FakeStore = {
      alerts: [
        alertRow({ id: 'a', created_at: '2026-07-15T10:00:00Z', type: 'metric_drop', severity: 'warning' }),
        alertRow({ id: 'b', created_at: '2026-07-15T10:01:00Z', type: 'site_down', severity: 'critical' }),
        alertRow({ id: 'c', created_at: '2026-07-15T10:02:00Z', type: 'site_up', severity: 'info' }),
      ],
      job_runs: [],
      organizations: [],
    };
    const sent: Alert[] = [];
    // Prvý alert (poison) vždy hodí; ostatné prejdú.
    const notifier: Notifier = {
      send: async (a) => {
        if (a.type === 'metric_drop') throw new Error('Resend 422 bad recipient');
        sent.push(a);
      },
    };

    await runAlerts(env, { supabase: fakeSupabase(store), notifier, now: DAY });

    // Kritický site_down PRÍDE aj napriek poison alertu pred ním.
    expect(sent.map((a) => a.type).sort()).toEqual(['site_down', 'site_up']);
    // Poison ostáva nevyslaný, úspešné sú označené.
    const byId = Object.fromEntries(store.alerts.map((r) => [r.id, r.sent_at]));
    expect(byId.a).toBeNull();
    expect(byId.b).not.toBeNull();
    expect(byId.c).not.toBeNull();
  });
});

describe('runAlerts — strop MAX_SENDS_PER_TICK (dávka alertov nesmie zrušiť heartbeat)', () => {
  const many = (n: number, over: Partial<FakeAlertRow> = {}) =>
    Array.from({ length: n }, (_, i) =>
      alertRow({ id: `w${i}`, created_at: `2026-07-15T10:${String(i).padStart(2, '0')}:00Z`, type: 'metric_drop', severity: 'warning', ...over }),
    );

  it('15 čakajúcich → odošle 10, 5 ostane neodoslaných a odíde ďalší tick', async () => {
    const store: FakeStore = { alerts: many(15), job_runs: [], organizations: [] };
    const sent: Alert[] = [];
    const notifier: Notifier = { send: async (a) => void sent.push(a) };

    const first = await runAlerts(env, { supabase: fakeSupabase(store), notifier, now: DAY });
    expect(first).toMatchObject({ sent: MAX_SENDS_PER_TICK, postponed: 5 });
    expect(store.alerts.filter((a) => a.sent_at == null)).toHaveLength(5);

    const second = await runAlerts(env, { supabase: fakeSupabase(store), notifier, now: DAY });
    expect(second).toMatchObject({ sent: 5, postponed: 0 });
    expect(sent).toHaveLength(15);
  });

  it('pri strope ide critical (site_down) pred staršími warning alertmi', async () => {
    const store: FakeStore = {
      alerts: [...many(12), alertRow({ id: 'down', created_at: '2026-07-15T11:59:00Z' })],
      job_runs: [],
      organizations: [],
    };
    const sent: Alert[] = [];
    await runAlerts(env, { supabase: fakeSupabase(store), notifier: { send: async (a) => void sent.push(a) }, now: DAY });
    expect(sent[0]!.type).toBe('site_down');
    expect(sent).toHaveLength(MAX_SENDS_PER_TICK);
  });

  it('zlyhaný pokus sa do stropu ráta (tiež míňa subrequest)', async () => {
    const store: FakeStore = { alerts: many(12), job_runs: [], organizations: [] };
    const res = await runAlerts(env, {
      supabase: fakeSupabase(store),
      notifier: { send: async () => { throw new Error('Resend 500'); } },
      now: DAY,
    });
    expect(res).toMatchObject({ sent: 0, failed: MAX_SENDS_PER_TICK, postponed: 2 });
  });
});
