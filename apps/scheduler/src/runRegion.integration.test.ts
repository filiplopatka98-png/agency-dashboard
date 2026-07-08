import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runUptime } from './runUptime';
import type { Env } from './env';

/**
 * Integračný test region_outage (krok 8): 8 webov, všetky down (>50 % a N ≥ 8)
 * → 0 incidentov, 0 zapísaných checkov (nešpiní uptime), práve 1 region_outage alert.
 */
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL_ && KEY);
const ORG = '44444444-4444-4444-4444-444444444444';

describe.skipIf(!enabled)('region_outage (integration)', () => {
  let db: SupabaseClient;
  let env: Env;
  let server: Server;

  beforeAll(async () => {
    server = createServer((_req, res) => res.writeHead(503).end('down'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    const base = `http://127.0.0.1:${addr.port}`;

    db = createClient(URL_!, KEY!, { auth: { persistSession: false } });
    env = {
      SUPABASE_URL: URL_!,
      SUPABASE_SERVICE_ROLE_KEY: KEY!,
      RESEND_API_KEY: '',
      ALERT_EMAIL_TO: '',
      ALERT_EMAIL_FROM: '',
      UPTIME_PROVIDER: 'local',
    };
    await db.from('organizations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('organizations').insert({ id: ORG, name: 'Region Org' });
    const sites = Array.from({ length: 8 }, (_, i) => ({
      id: `44444444-0000-0000-0000-00000000000${i}`,
      org_id: ORG,
      name: `Web ${i}`,
      url: `${base}/`,
      domain: `w${i}.local`,
    }));
    await db.from('sites').insert(sites);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('8/8 down → 0 checkov, 0 incidentov, 1 region_outage alert', async () => {
    await runUptime(env);

    const { data: checks } = await db.from('uptime_checks').select('id').eq('org_id', ORG);
    expect((checks ?? []).length).toBe(0); // region outage: checky sa NEzapisujú

    const { data: incidents } = await db.from('incidents').select('id').eq('org_id', ORG);
    expect((incidents ?? []).length).toBe(0);

    const { data: alerts } = await db.from('alerts').select('id, severity').eq('type', 'region_outage');
    expect((alerts ?? []).length).toBe(1);
    expect(alerts![0]!.severity).toBe('warning');
  }, 60_000);

  it('druhý beh v tej istej hodine → žiadny druhý region alert (dedupe)', async () => {
    await runUptime(env);
    const { data: alerts } = await db.from('alerts').select('id').eq('type', 'region_outage');
    expect((alerts ?? []).length).toBe(1);
  }, 60_000);
});
