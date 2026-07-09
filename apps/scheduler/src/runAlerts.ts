import { isNightInBratislava, NIGHT_DEFERRED_TYPES, ResendNotifier, type Notifier } from '@agency/core';
import type { Alert } from '@agency/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { serviceClient } from './supabase';

interface AlertRow {
  id: string;
  org_id: string;
  site_id: string | null;
  type: string;
  severity: Alert['severity'];
  title: string;
  body: string | null;
  dedupe_key: string;
}

export interface RunAlertsDeps {
  supabase?: SupabaseClient;
  notifier?: Notifier;
  now?: Date;
}

const toAlert = (r: AlertRow): Alert => ({
  orgId: r.org_id,
  siteId: r.site_id,
  type: r.type,
  severity: r.severity,
  title: r.title,
  body: r.body,
  dedupeKey: r.dedupe_key,
});

/**
 * Pošle nevyslané alerty (alerts.sent_at IS NULL). Dedupe je už vyriešený pri
 * inserte (unique index) — sem sa dostane každý dedupe_key nanajvýš raz.
 * V noci (Europe/Bratislava 22:00–06:00) sa site_up a region_outage odkladajú;
 * critical (site_down) sa posiela vždy.
 */
export async function runAlerts(env: Env, deps: RunAlertsDeps = {}): Promise<void> {
  const supabase = deps.supabase ?? serviceClient(env);

  // Resend ešte nenakonfigurovaný (placeholder / nie 're_…') → neposielaj, ale nezhoď
  // tick. Alerty ostanú nevyslané (sent_at NULL) a odídu, keď sa doplní reálny kľúč.
  if (!deps.notifier && (!env.RESEND_API_KEY || !env.RESEND_API_KEY.startsWith('re_'))) {
    const { count } = await supabase.from('alerts').select('id', { count: 'exact', head: true }).is('sent_at', null);
    console.log(JSON.stringify({ ev: 'alerts.skipped_no_resend', pending: count ?? 0 }));
    return;
  }

  const notifier =
    deps.notifier ??
    new ResendNotifier({
      apiKey: env.RESEND_API_KEY,
      from: env.ALERT_EMAIL_FROM,
      to: env.ALERT_EMAIL_TO,
    });
  const night = isNightInBratislava(deps.now ?? new Date());

  const { data, error } = await supabase
    .from('alerts')
    .select('id, org_id, site_id, type, severity, title, body, dedupe_key')
    .is('sent_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`alerts select: ${error.message}`);

  const rows = (data ?? []) as AlertRow[];
  let sent = 0;
  let deferred = 0;

  for (const r of rows) {
    if (night && NIGHT_DEFERRED_TYPES.has(r.type)) {
      deferred++;
      continue;
    }
    await notifier.send(toAlert(r));
    await supabase.from('alerts').update({ sent_at: new Date().toISOString() }).eq('id', r.id);
    sent++;
  }

  console.log(JSON.stringify({ ev: 'alerts.run', pending: rows.length, sent, deferred }));
}
