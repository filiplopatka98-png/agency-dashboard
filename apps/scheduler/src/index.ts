import type { Env } from './env';

/**
 * Cloudflare Worker — jeden cron trigger, každých 5 minút. Vetvenie podľa času vnútri.
 * Krok 1: prázdny skelet (len log). Uptime pridá krok 4, doména/TLS krok 7,
 * expiry/region alerty krok 8.
 */
export default {
  async scheduled(event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);
    console.log(JSON.stringify({ ev: 'scheduled.tick', at: now.toISOString() }));
    // TODO(krok 4): await runUptime(env);
    // TODO(krok 7): round-robin doména/TLS podľa najstaršieho checked_at
    // TODO(krok 8): await runExpiryAlerts(env);
  },
} satisfies ExportedHandler<Env>;
