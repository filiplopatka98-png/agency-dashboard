import type { Env } from './env';
import { runUptime } from './runUptime';

/**
 * Cloudflare Worker — jeden cron trigger, každých 5 minút. Vetvenie podľa času vnútri.
 * Uptime beží vždy. Doména/TLS (round-robin) a expiry/region alerty pridajú kroky 7–8.
 */
export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);
    console.log(JSON.stringify({ ev: 'scheduled.tick', at: now.toISOString() }));
    ctx.waitUntil(
      runUptime(env).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify({ ev: 'uptime.error', message }));
        throw err;
      }),
    );
    // TODO(krok 7): round-robin doména/TLS podľa najstaršieho checked_at
    // TODO(krok 8): await runExpiryAlerts(env);
  },
} satisfies ExportedHandler<Env>;
