import type { Env } from './env';
import { runUptime } from './runUptime';
import { runAlerts } from './runAlerts';
import { runDomains } from './runDomains';
import { defaultDomainResolver } from './domainResolver';

/**
 * Cloudflare Worker — jeden cron trigger, každých 5 minút. Vetvenie podľa času vnútri.
 * Uptime beží vždy. Doména/TLS (round-robin) a expiry/region alerty pridajú kroky 7–8.
 */
export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);
    console.log(JSON.stringify({ ev: 'scheduled.tick', at: now.toISOString() }));
    ctx.waitUntil(
      (async () => {
        try {
          await runUptime(env); // uptime + otvorenie/zatvorenie incidentov (+ insert alertov)
          await runDomains(env, defaultDomainResolver, { limit: 3 }); // round-robin doména (>20 h)
          await runAlerts(env); // odoslanie nevyslaných alertov (dedupe už v DB)
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(JSON.stringify({ ev: 'scheduled.error', message }));
          throw err;
        }
      })(),
    );
    // TODO(krok 8): region_outage alert (insert) + expiry alerty (GitHub Action alebo tu)
  },
} satisfies ExportedHandler<Env>;
