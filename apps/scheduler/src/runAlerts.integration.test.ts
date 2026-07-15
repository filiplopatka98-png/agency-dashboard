import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Alert } from '@agency/shared';
import type { Notifier } from '@agency/core';
import { runUptime } from './runUptime';
import { runAlerts } from './runAlerts';
import type { Env } from './env';

/**
 * Integračný test kroku 5 proti LOKÁLNEMU Supabase.
 * Overuje: dedupe (jeden mail na výpadok, žiadny druhý po „reštarte" workera),
 * site_up po zotavení, a nočné odloženie site_up.
 */
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL_ && KEY);

const ORG = '22222222-2222-2222-2222-222222222222';
const SITE = '22222222-0000-0000-0000-0000000000a1';

const DAY = new Date('2026-07-15T12:00:00Z'); // 14:00 lokál → deň
const NIGHT = new Date('2026-07-15T23:30:00Z'); // 01:30 lokál → noc

describe.skipIf(!enabled)('runAlerts + dedupe (integration)', () => {
  let db: SupabaseClient;
  let env: Env;
  let server: Server;
  let base: string;
  let down = true;
  const sent: Alert[] = [];
  const recording: Notifier = { send: async (a) => void sent.push(a) };

  beforeAll(async () => {
    server = createServer((_req, res) => {
      if (down) res.writeHead(503).end('down');
      else res.writeHead(200).end('OK');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}`;

    db = createClient(URL_!, KEY!, { auth: { persistSession: false } });
    env = {
      SUPABASE_URL: URL_!,
      SUPABASE_SERVICE_ROLE_KEY: KEY!,
      RESEND_API_KEY: '',
      ALERT_EMAIL_TO: 'to@lopatka.sk',
      ALERT_EMAIL_FROM: 'from@lopatka.sk',
      UPTIME_PROVIDER: 'local',
      WP_INGEST_TOKEN: '',
      GH_DISPATCH_TOKEN: '',
      GH_REPO: '',
      SUPABASE_JWT_SECRET: '',
    };

    await db.from('organizations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('organizations').insert({ id: ORG, name: 'Alert Test Org' });
    await db.from('sites').insert({ id: SITE, org_id: ORG, name: 'Test web', url: `${base}/`, domain: 'test.local' });
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const downAlerts = async () =>
    (await db.from('alerts').select('id, sent_at').eq('site_id', SITE).eq('type', 'site_down')).data ?? [];
  const upAlerts = async () =>
    (await db.from('alerts').select('id, sent_at').eq('site_id', SITE).eq('type', 'site_up')).data ?? [];

  it('dva behy výpadku → PRÁVE jeden site_down alert (dedupe cez unique index)', async () => {
    await runUptime(env); // fail #1 — žiadny incident, žiadny alert
    await runUptime(env); // fail #2 — incident + site_down alert
    const alerts = await downAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.sent_at).toBeNull();
  }, 60_000);

  it('„reštart" workera (ďalší beh výpadku) nevyrobí druhý site_down alert', async () => {
    await runUptime(env); // stále down, incident už otvorený → žiadny nový alert
    expect((await downAlerts()).length).toBe(1);
  }, 60_000);

  it('runAlerts (deň) pošle site_down práve raz; druhý beh už neposiela', async () => {
    await runAlerts(env, { supabase: db, notifier: recording, now: DAY });
    expect(sent.filter((a) => a.type === 'site_down').length).toBe(1);
    expect((await downAlerts())[0]!.sent_at).not.toBeNull();

    await runAlerts(env, { supabase: db, notifier: recording, now: DAY });
    expect(sent.filter((a) => a.type === 'site_down').length).toBe(1); // žiadny druhý mail
  }, 60_000);

  it('zotavenie → site_up alert; v noci sa NEpošle, cez deň áno', async () => {
    down = false;
    await runUptime(env); // úspech → zatvorí incident + site_up alert
    expect((await upAlerts()).length).toBe(1);

    // noc: site_up sa odloží
    await runAlerts(env, { supabase: db, notifier: recording, now: NIGHT });
    expect(sent.filter((a) => a.type === 'site_up').length).toBe(0);
    expect((await upAlerts())[0]!.sent_at).toBeNull();

    // deň: site_up sa pošle
    await runAlerts(env, { supabase: db, notifier: recording, now: DAY });
    expect(sent.filter((a) => a.type === 'site_up').length).toBe(1);
    expect((await upAlerts())[0]!.sent_at).not.toBeNull();
  }, 60_000);
});
