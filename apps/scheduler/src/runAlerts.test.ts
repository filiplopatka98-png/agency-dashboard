import { describe, expect, it } from 'vitest';
import type { Alert } from '@agency/shared';
import type { Notifier } from '@agency/core';
import { runAlerts } from './runAlerts';
import { fakeSupabase, type FakeAlertRow, type FakeStore } from './fakeSupabase';
import type { Env } from './env';

const env: Env = {
  SUPABASE_URL: 'http://local',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  RESEND_API_KEY: 're_fake',
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
