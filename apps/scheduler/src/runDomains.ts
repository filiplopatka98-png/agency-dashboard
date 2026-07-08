import type { DomainInfo } from '@agency/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { serviceClient } from './supabase';

export type DomainResolver = (domain: string) => Promise<DomainInfo>;

export interface RunDomainsDeps {
  supabase?: SupabaseClient;
  limit?: number;
  now?: Date;
}

interface DomainSiteRow {
  id: string;
  org_id: string;
  domain: string;
}

/**
 * Round-robin doménová kontrola: RPC vráti _limit najstarších (>20 h) webov,
 * pre každý zavolá resolver a upsertne domains. resolver je injektovaný —
 * cloudflare:sockets (whois) sa tak nedostane do testu ani do core.
 *
 * „Neprepisuj dobrú hodnotu chybou": pri transientnej chybe (error a null expiry,
 * nie 'unsupported') sa expires_at do payloadu NEdáva → merge-duplicates ho zachová.
 */
export async function runDomains(
  env: Env,
  resolver: DomainResolver,
  deps: RunDomainsDeps = {},
): Promise<void> {
  const supabase = deps.supabase ?? serviceClient(env);
  const limit = deps.limit ?? 5;
  const now = (deps.now ?? new Date()).toISOString();

  const { data, error } = await supabase.rpc('get_domains_to_check', { _limit: limit });
  if (error) throw new Error(`get_domains_to_check: ${error.message}`);
  const rows = (data ?? []) as DomainSiteRow[];

  let ok = 0;
  for (const s of rows) {
    const info = await resolver(s.domain);
    const transientError = Boolean(info.error) && info.expiresAt === null && info.source !== 'unsupported';

    const row: Record<string, unknown> = {
      site_id: s.id,
      org_id: s.org_id,
      domain: s.domain,
      registrar: info.registrar,
      nameservers: info.nameservers,
      source: info.source,
      checked_at: now,
      error: info.error ?? null,
    };
    if (!transientError) row.expires_at = info.expiresAt; // inak zachovaj starú hodnotu

    const { error: upErr } = await supabase.from('domains').upsert(row, { onConflict: 'site_id' });
    if (upErr) throw new Error(`domains upsert (${s.domain}): ${upErr.message}`);
    if (!info.error) ok++;
  }

  console.log(JSON.stringify({ ev: 'domains.run', processed: rows.length, ok }));
}
