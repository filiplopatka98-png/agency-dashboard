import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runWpCronKick, type WpCronFetcher } from './runWpCronKick';
import type { Env } from './env';

/**
 * Integračný test WP-cron kicku (incident 2026-07-17: dva z troch WP webov po
 * inštalácii agenta neposlali nič, kým ich niekto ručne nenavštívil). Resolver
 * (fetcher) je injektovaný — žiadna reálna sieť — testuje výber cez
 * `get_wp_sites_to_kick` (staleness + cooldown v RPC, viď 0032_wp_cron_kick.sql),
 * cap (`limit`) a rate-limit (`cron_kicked_at`).
 *
 * Spustenie z rootu:
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   pnpm exec vitest run apps/scheduler/src/runWpCronKick.integration.test.ts
 * Bez env premenných sa preskočí (nebeží v `pnpm -r test`).
 */
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL_ && KEY);

const ORG = '44444444-4444-4444-4444-444444444444';
const SITE_FRESH = '44444444-0000-0000-0000-0000000000a1'; // measured_at < 25h → nekopne
const SITE_STALE = '44444444-0000-0000-0000-0000000000a2'; // measured_at > 25h → kopne
const SITE_NEVER = '44444444-0000-0000-0000-0000000000a3'; // žiadny wp_snapshots riadok → kopne
const SITE_OTHER_CMS = '44444444-0000-0000-0000-0000000000a4'; // cms != 'wordpress' → nikdy
const SITE_COOLDOWN = '44444444-0000-0000-0000-0000000000a5'; // stale, ale nedávno kopnutý → nekopne

describe.skipIf(!enabled)('runWpCronKick (integration)', () => {
  let db: SupabaseClient;
  let env: Env;

  beforeAll(async () => {
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

    await db.from('organizations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('organizations').insert({ id: ORG, name: 'WP Kick Test Org' });
    await db.from('sites').insert([
      { id: SITE_FRESH, org_id: ORG, name: 'Fresh', url: 'https://fresh.example', domain: 'fresh.example', cms: 'wordpress' },
      { id: SITE_STALE, org_id: ORG, name: 'Stale', url: 'https://stale.example', domain: 'stale.example', cms: 'wordpress' },
      { id: SITE_NEVER, org_id: ORG, name: 'Never', url: 'https://never.example', domain: 'never.example', cms: 'wordpress' },
      { id: SITE_OTHER_CMS, org_id: ORG, name: 'Static', url: 'https://static.example', domain: 'static.example', cms: 'static' },
      { id: SITE_COOLDOWN, org_id: ORG, name: 'Cooldown', url: 'https://cooldown.example', domain: 'cooldown.example', cms: 'wordpress' },
    ]);

    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    await db.from('wp_snapshots').insert([
      { site_id: SITE_FRESH, org_id: ORG, measured_at: hoursAgo(1) },
      { site_id: SITE_STALE, org_id: ORG, measured_at: hoursAgo(30) },
      // SITE_NEVER: žiadny riadok — nikdy nepushol.
      { site_id: SITE_OTHER_CMS, org_id: ORG, measured_at: hoursAgo(48) },
      { site_id: SITE_COOLDOWN, org_id: ORG, measured_at: hoursAgo(48), cron_kicked_at: hoursAgo(1) },
    ]);
  });

  it('kopne len stale/nikdy-nepushnuté WP weby (nie čerstvý, nie iný CMS, nie v cooldowne)', async () => {
    const hit: string[] = [];
    const fetcher: WpCronFetcher = async (url) => {
      hit.push(url);
      return new Response('ok', { status: 200 });
    };

    await runWpCronKick(env, { supabase: db, limit: 10, fetcher });

    expect(hit.some((u) => u.includes('stale.example'))).toBe(true);
    expect(hit.some((u) => u.includes('never.example'))).toBe(true);
    expect(hit.some((u) => u.includes('fresh.example'))).toBe(false);
    expect(hit.some((u) => u.includes('static.example'))).toBe(false);
    expect(hit.some((u) => u.includes('cooldown.example'))).toBe(false);
    hit.forEach((u) => expect(u).toMatch(/^https:\/\/[^/]+\/wp-cron\.php\?doing_wp_cron=\d+$/));
  });

  it('zapíše cron_kicked_at (partial upsert, nedotkne sa measured_at)', async () => {
    const fetcher: WpCronFetcher = async () => new Response('ok', { status: 200 });
    await runWpCronKick(env, { supabase: db, limit: 10, fetcher });

    const { data } = await db.from('wp_snapshots').select('cron_kicked_at, measured_at').eq('site_id', SITE_NEVER).single();
    expect(data?.cron_kicked_at).toBeTruthy();

    const staleRow = await db.from('wp_snapshots').select('measured_at').eq('site_id', SITE_STALE).single();
    expect(staleRow.data?.measured_at).toBeTruthy(); // pôvodná hodnota zachovaná, kick ju neprepísal
  });

  it('cap (`limit`) obmedzí počet kopnutí za beh', async () => {
    // po predošlých testoch je STALE aj NEVER v cooldowne — posuň ich cron_kicked_at
    // do minulosti, aby ich RPC znova vrátilo, a over že limit:1 kopne len jeden.
    await db.from('wp_snapshots').update({ cron_kicked_at: new Date(Date.now() - 7 * 3600_000).toISOString() }).in('site_id', [SITE_STALE, SITE_NEVER]);

    const hit: string[] = [];
    const fetcher: WpCronFetcher = async (url) => {
      hit.push(url);
      return new Response('ok', { status: 200 });
    };
    await runWpCronKick(env, { supabase: db, limit: 1, fetcher });
    expect(hit.length).toBe(1);
  });

  it('zlyhaný fetch (mŕtvy web / vypnutý wp-cron) nehádže a stále zapíše cooldown', async () => {
    await db.from('wp_snapshots').update({ cron_kicked_at: new Date(Date.now() - 7 * 3600_000).toISOString() }).eq('site_id', SITE_STALE);

    const fetcher: WpCronFetcher = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(runWpCronKick(env, { supabase: db, limit: 1, fetcher })).resolves.toBeUndefined();

    const row = await db.from('wp_snapshots').select('cron_kicked_at').eq('site_id', SITE_STALE).single();
    expect(row.data?.cron_kicked_at).toBeTruthy();
  });
});
