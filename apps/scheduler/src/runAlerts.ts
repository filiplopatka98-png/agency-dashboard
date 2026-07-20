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
export interface RunAlertsResult {
  sent: number;
  deferred: number;
  failed: number;
}

export async function runAlerts(env: Env, deps: RunAlertsDeps = {}): Promise<RunAlertsResult> {
  const supabase = deps.supabase ?? serviceClient(env);

  // Resend ešte nenakonfigurovaný (placeholder / nie 're_…') → neposielaj, ale nezhoď
  // tick. Alerty ostanú nevyslané (sent_at NULL) a odídu, keď sa doplní reálny kľúč.
  if (!deps.notifier && (!env.RESEND_API_KEY || !env.RESEND_API_KEY.startsWith('re_'))) {
    const { count } = await supabase.from('alerts').select('id', { count: 'exact', head: true }).is('sent_at', null);
    console.log(JSON.stringify({ ev: 'alerts.skipped_no_resend', pending: count ?? 0 }));
    return { sent: 0, deferred: 0, failed: 0 };
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
  let failed = 0;

  // Per-alert try/catch (audit FIX 1): jeden „poison" riadok (napr. Resend 422
  // na zlý príjemca, oversized body, transient 5xx) NESMIE zhodiť celý drain a
  // tým natrvalo zablokovať VŠETKY e-maily — vrátane kritického site_down za
  // ním. Rady sú `created_at ASC`, takže bez izolácie by sa poison vyberal prvý
  // pri každom ticku a večne blokoval zvyšok. sent_at nastavíme LEN po reálne
  // úspešnom odoslaní (žiadny tichý drop); poison sa nabudúce skúsi znova (to je
  // OK — už neblokuje ostatné).
  for (const r of rows) {
    if (night && NIGHT_DEFERRED_TYPES.has(r.type)) {
      deferred++;
      continue;
    }
    try {
      await notifier.send(toAlert(r));
      await supabase.from('alerts').update({ sent_at: new Date().toISOString() }).eq('id', r.id);
      sent++;
    } catch (err: unknown) {
      failed++;
      const error = err instanceof Error ? err.message : String(err);
      console.log(JSON.stringify({ ev: 'alerts.send_fail', id: r.id, type: r.type, error }));
      continue;
    }
  }

  console.log(JSON.stringify({ ev: 'alerts.run', pending: rows.length, sent, deferred, failed }));
  return { sent, deferred, failed };
}
