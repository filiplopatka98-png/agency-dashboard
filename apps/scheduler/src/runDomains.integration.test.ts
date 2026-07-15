import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DomainInfo } from '@agency/core';
import { runDomains, type DomainResolver } from './runDomains';
import type { Env } from './env';

/**
 * Integračný test kroku 7 (doména) proti lokálnemu Supabase. Resolver je
 * injektovaný (žiadny cloudflare:sockets, žiadna sieť) — testuje round-robin
 * výber, upsert a pravidlo „neprepisuj dobrú hodnotu chybou".
 */
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL_ && KEY);

const ORG = '33333333-3333-3333-3333-333333333333';
const SITE = '33333333-0000-0000-0000-0000000000a1';

const good: DomainResolver = async (d): Promise<DomainInfo> => ({
  expiresAt: '2027-05-01',
  registrar: 'WebSupport s.r.o.',
  nameservers: ['ns1.websupport.sk'],
  source: d.endsWith('.sk') ? 'whois43' : 'rdap',
});
const failing: DomainResolver = async (): Promise<DomainInfo> => ({
  expiresAt: null,
  registrar: null,
  nameservers: [],
  source: 'rdap',
  error: 'timeout',
});

describe.skipIf(!enabled)('runDomains (integration)', () => {
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
      SUPABASE_JWT_SECRET: '',
    };
    await db.from('organizations').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await db.from('organizations').insert({ id: ORG, name: 'Domain Test Org' });
    await db.from('sites').insert({ id: SITE, org_id: ORG, name: 'W', url: 'https://lopatka.sk', domain: 'lopatka.sk' });
  });

  const domainRow = async () =>
    (await db.from('domains').select('expires_at, source, error, registrar').eq('site_id', SITE).single()).data;

  it('zapíše expires_at, source a registrar', async () => {
    await runDomains(env, good, { supabase: db, limit: 5 });
    const row = await domainRow();
    expect(row?.expires_at).toBe('2027-05-01');
    expect(row?.source).toBe('whois43');
    expect(row?.registrar).toBe('WebSupport s.r.o.');
  });

  it('transientná chyba NEPREPÍŠE dobrý expires_at (len zapíše error)', async () => {
    // posuň checked_at do minulosti, aby ho RPC (>20 h filter) znovu vrátil
    await db.from('domains').update({ checked_at: '2020-01-01T00:00:00Z' }).eq('site_id', SITE);
    await runDomains(env, failing, { supabase: db, limit: 5 });
    const row = await domainRow();
    expect(row?.expires_at).toBe('2027-05-01'); // zachované
    expect(row?.error).toBe('timeout');
  });

  it('čerstvý web (<20 h) sa v ďalšom behu preskočí (round-robin)', async () => {
    // po predošlom behu je checked_at čerstvý → RPC nič nevráti, žiadny throw
    await runDomains(env, failing, { supabase: db, limit: 5 });
    const row = await domainRow();
    expect(row?.expires_at).toBe('2027-05-01'); // stále nezmenené
  });
});
