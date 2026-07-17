import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { serviceClient } from './supabase';

/** Injektovaný fetch — v testoch žiadna reálna sieť, presne ako `DomainResolver` v runDomains.ts. */
export type WpCronFetcher = (url: string) => Promise<Response>;

export interface RunWpCronKickDeps {
  supabase?: SupabaseClient;
  limit?: number;
  now?: Date;
  fetcher?: WpCronFetcher;
}

interface WpKickSiteRow {
  id: string;
  org_id: string;
  domain: string;
}

/**
 * Kopne `wp-cron.php` na WordPress weboch, ktorých push (wp_snapshots.measured_at)
 * je starší než ~25 h alebo ešte nikdy neprebehol — presne incident z 2026-07-17,
 * keď dva z troch novo nainštalovaných WP agentov neposlali nič, kým ich niekto
 * ručne nenavštívil (WP-cron beží len na návšteve, nie ako skutočný cron).
 *
 * Výber (staleness + rate limit) rieši RPC `get_wp_sites_to_kick` (rovnaký vzor
 * ako `get_domains_to_check` v runDomains.ts) — takže:
 *  - self-limiting: čerstvý web (measured_at < 25h) RPC nikdy nevráti → 0 subrequestov,
 *  - "nehamruj": `wp_snapshots.cron_kicked_at` cooldown (6h v RPC) bráni opakovanému
 *    kopnutiu webu, ktorý aj po kicku mlčí (vypnutý DISABLE_WP_CRON, neaktívny plugin, mŕtvy web),
 *  - `limit` obmedzuje subrequesty za tick (zdieľaný rozpočet s runUptime/runDomains/runAlerts).
 *
 * Kick = obyčajný GET na `wp-cron.php?doing_wp_cron=<unix ts>` — presne ako si
 * WordPress sám spúšťa cron pri návšteve stránky. Zlyhanie je OČAKÁVANÉ (mŕtvy
 * web, vypnutý wp-cron, firewall) — loguje sa a ide sa ďalej, nikdy nehádže,
 * lebo beží v tej istej invokácii ako runUptime.
 */
export async function runWpCronKick(env: Env, deps: RunWpCronKickDeps = {}): Promise<void> {
  const supabase = deps.supabase ?? serviceClient(env);
  const limit = deps.limit ?? 3;
  const now = deps.now ?? new Date();
  // Timeout 10s — mŕtvy/pomalý web nesmie zdržať zdieľanú invokáciu (runUptime/runAlerts idú po ňom).
  const fetcher = deps.fetcher ?? ((url: string) => fetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) }));

  const { data, error } = await supabase.rpc('get_wp_sites_to_kick', { _limit: limit });
  if (error) throw new Error(`get_wp_sites_to_kick: ${error.message}`);
  const rows = (data ?? []) as WpKickSiteRow[];
  if (rows.length === 0) {
    console.log(JSON.stringify({ ev: 'wp_cron_kick.none' }));
    return;
  }

  let kicked = 0;
  for (const s of rows) {
    const kickUrl = `https://${s.domain}/wp-cron.php?doing_wp_cron=${Math.floor(now.getTime() / 1000)}`;
    try {
      await fetcher(kickUrl);
      kicked++;
    } catch (err: unknown) {
      // Očakávané (mŕtvy web / vypnutý wp-cron) — loguj a pokračuj, nikdy nehádž.
      const message = err instanceof Error ? err.message : String(err);
      console.log(JSON.stringify({ ev: 'wp_cron_kick.fail', domain: s.domain, message }));
    }

    // Cooldown zapíš VŽDY (aj pri zlyhaní GET) — inak by sa mŕtvy/vypnutý web
    // kopol pri každom 5-min ticku donekonečna. Partial upsert (len cron_kicked_at,
    // ostatné stĺpce sa nedotknú) — rovnaký vzor ako `domains.expires_at` v runDomains.ts.
    const { error: upErr } = await supabase
      .from('wp_snapshots')
      .upsert({ site_id: s.id, org_id: s.org_id, cron_kicked_at: now.toISOString() }, { onConflict: 'site_id' });
    if (upErr) console.log(JSON.stringify({ ev: 'wp_cron_kick.mark_fail', domain: s.domain, message: upErr.message }));
  }

  console.log(JSON.stringify({ ev: 'wp_cron_kick.run', processed: rows.length, kicked }));
}
