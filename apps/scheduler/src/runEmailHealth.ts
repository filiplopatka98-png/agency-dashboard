import { evaluatePeriodic, type EmailHealthReading } from '@agency/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { serviceClient } from './supabase';

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Tick collector: evaluates the slow-burn e-mail rules (2 stuck, 3 silence) from
 * the LATEST wp_email_health reading per active site. Rule 1 (high fail rate) is
 * handled at ingest (event-driven), not here. Never throws — collector-safe.
 */
export async function runEmailHealth(env: Env, deps: { supabase?: SupabaseClient; now?: Date } = {}): Promise<void> {
  const db = deps.supabase ?? serviceClient(env);
  const now = deps.now ?? new Date();

  const { data: sites, error: sErr } = await db.from('sites').select('id, org_id, domain').eq('is_active', true);
  if (sErr) {
    console.log(JSON.stringify({ ev: 'email_health.sites_fail', message: sErr.message }));
    return;
  }

  const rows: { type: string; severity: string; title: string; body: string; dedupe_key: string; org_id: string; site_id: string }[] = [];

  for (const site of sites ?? []) {
    // Latest reading (Rule 2) + 14d window of sent_24h (Rule 3 baseline).
    const { data: latest } = await db
      .from('wp_email_health')
      .select('provider, sent_1h, failed_1h, failed_pct_1h, sent_24h, failed_24h, last_success_at, last_failure_at, last_failure_message, queue_depth')
      .eq('site_id', site.id)
      .order('measured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest || latest.provider === null) continue;

    const since = new Date(now.getTime() - 14 * 24 * 3_600_000).toISOString();
    const { data: hist } = await db
      .from('wp_email_health')
      .select('sent_24h, measured_at')
      .eq('site_id', site.id)
      .gte('measured_at', since);
    const typicalDaily14d = median((hist ?? []).map((r) => (r.sent_24h ?? 0) as number).filter((v) => v > 0));

    const reading = latest as unknown as EmailHealthReading;
    const alerts = evaluatePeriodic(reading, typicalDaily14d, { siteId: site.id, domain: site.domain, now });
    for (const a of alerts) {
      rows.push({
        org_id: site.org_id,
        site_id: site.id,
        type: a.type,
        severity: a.severity,
        title: a.title,
        body: a.body,
        dedupe_key: a.dedupeKey,
      });
    }
  }

  if (!rows.length) {
    console.log(JSON.stringify({ ev: 'email_health.ok', sites: (sites ?? []).length }));
    return;
  }
  const { error: aErr } = await db.from('alerts').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (aErr) console.log(JSON.stringify({ ev: 'email_health.alert_fail', message: aErr.message }));
  else console.log(JSON.stringify({ ev: 'email_health.alert', count: rows.length }));
}
