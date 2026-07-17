import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runUptime } from './runUptime';
import type { Env } from './env';

/**
 * Integračný test proti LOKÁLNEMU Supabase (supabase start).
 * Spustenie z rootu:
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   pnpm exec vitest run apps/scheduler/src/runUptime.integration.test.ts
 * Bez env premenných sa preskočí (nebeží v `pnpm -r test`).
 *
 * DETERMINISTICKÝ: test si spustí vlastný HTTP server (200 / 503) a vlastné
 * fixtures — žiadna závislosť na externej flaky službe. Overuje, že padnutý web
 * dostane incident až po DRUHOM behu (consecutive_failures >= 2), nie po prvom.
 */
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL_ && KEY);

const ORG = '11111111-1111-1111-1111-111111111111';
const SITE_OK = '11111111-0000-0000-0000-0000000000a1';
const SITE_DOWN = '11111111-0000-0000-0000-0000000000a2';

describe.skipIf(!enabled)('runUptime (integration)', () => {
  let db: SupabaseClient;
  let env: Env;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    // Lokálny server: /ok → 200, /down → 503.
    server = createServer((req, res) => {
      if (req.url === '/down') {
        res.writeHead(503).end('service unavailable');
      } else {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('OK healthy');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no server port');
    base = `http://127.0.0.1:${addr.port}`;

    db = createClient(URL_!, KEY!, { auth: { persistSession: false } });
    env = {
      SUPABASE_URL: URL_!,
      SUPABASE_SERVICE_ROLE_KEY: KEY!,
      RESEND_API_KEY: '',
      ALERT_EMAIL_TO: '',
      ALERT_EMAIL_FROM: '',
      UPTIME_PROVIDER: 'local',
      WP_INGEST_TOKEN: '',
      GH_DISPATCH_TOKEN: '',
      GH_REPO: '',
    };

    // Čistý stav: zmaž všetky orgs (cascade zmaže sites/checky/incidenty) a vlož vlastné.
    await db.from('organizations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('organizations').insert({ id: ORG, name: 'IT Test Org' });
    await db.from('sites').insert([
      { id: SITE_OK, org_id: ORG, name: 'OK web', url: `${base}/ok`, domain: 'ok.local', expected_string: 'healthy' },
      { id: SITE_DOWN, org_id: ORG, name: 'Down web', url: `${base}/down`, domain: 'down.local' },
    ]);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const cf = async (id: string): Promise<number> => {
    const { data } = await db.from('sites').select('consecutive_failures').eq('id', id).single();
    return data?.consecutive_failures as number;
  };
  const openIncidents = async (id: string): Promise<number> => {
    const { data } = await db.from('incidents').select('id').eq('site_id', id).is('resolved_at', null);
    return (data ?? []).length;
  };

  it('prvý beh: checky zapísané, down web má 1 fail, ŽIADNY incident; ok web má 0', async () => {
    await runUptime(env);

    const { data: checks } = await db.from('uptime_checks').select('site_id').eq('org_id', ORG);
    expect((checks ?? []).length).toBe(2);

    expect(await cf(SITE_DOWN)).toBe(1);
    expect(await openIncidents(SITE_DOWN)).toBe(0);
    expect(await cf(SITE_OK)).toBe(0);
  }, 60_000);

  it('druhý beh: down web má 2 faily → OTVORÍ sa presne jeden incident', async () => {
    await runUptime(env);

    expect(await cf(SITE_DOWN)).toBe(2);
    expect(await openIncidents(SITE_DOWN)).toBe(1);
    expect(await cf(SITE_OK)).toBe(0);
  }, 60_000);

  it('tretí beh po zotavení: ok web ostáva 0, down stále 1 otvorený incident (nie druhý)', async () => {
    await runUptime(env);
    expect(await openIncidents(SITE_DOWN)).toBe(1); // partial unique index → žiadny duplicitný
  }, 60_000);
});
