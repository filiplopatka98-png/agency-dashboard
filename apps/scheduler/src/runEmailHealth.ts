import { evaluatePeriodic, type EmailHealthReading } from '@agency/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { serviceClient } from './supabase';

type EmailHealthInput = { site_id: string; org_id: string; domain: string; typical_daily_14d: number | null } & Record<string, unknown>;

/**
 * Tick collector: evaluates the slow-burn e-mail rules (2 stuck, 3 silence) from
 * the LATEST wp_email_health reading per active site. Rule 1 (high fail rate) is
 * handled at ingest (event-driven), not here. Never throws — collector-safe.
 */
export async function runEmailHealth(env: Env, deps: { supabase?: SupabaseClient; now?: Date } = {}): Promise<void> {
  const db = deps.supabase ?? serviceClient(env);
  const now = deps.now ?? new Date();

  // Latest reading (Rule 2) + 14d median of sent_24h > 0 (Rule 3 baseline) for
  // every active site with a provider — ONE rpc (SQL, migration 0041) instead
  // of 1 + 2 queries per site: that was ~21 of the Worker's 50-subrequest
  // budget, and parsing ~336 hourly readings per site the biggest CPU cost.
  const since = new Date(now.getTime() - 14 * 24 * 3_600_000).toISOString();
  const { data, error: iErr } = await db.rpc('email_health_inputs', { _since: since });
  if (iErr) {
    console.log(JSON.stringify({ ev: 'email_health.inputs_fail', message: iErr.message }));
    return;
  }
  const inputs = (data ?? []) as EmailHealthInput[];

  const rows: { type: string; severity: string; title: string; body: string; dedupe_key: string; org_id: string; site_id: string }[] = [];

  for (const input of inputs) {
    const reading = input as unknown as EmailHealthReading;
    const alerts = evaluatePeriodic(reading, Number(input.typical_daily_14d) || 0, { siteId: input.site_id, domain: input.domain, now });
    for (const a of alerts) {
      rows.push({
        org_id: input.org_id,
        site_id: input.site_id,
        type: a.type,
        severity: a.severity,
        title: a.title,
        body: a.body,
        dedupe_key: a.dedupeKey,
      });
    }
  }

  if (!rows.length) {
    console.log(JSON.stringify({ ev: 'email_health.ok', sites: inputs.length }));
    return;
  }
  const { error: aErr } = await db.from('alerts').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (aErr) console.log(JSON.stringify({ ev: 'email_health.alert_fail', message: aErr.message }));
  else console.log(JSON.stringify({ ev: 'email_health.alert', count: rows.length }));
}
