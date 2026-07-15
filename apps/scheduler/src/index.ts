import type { Env } from './env';
import { runUptime } from './runUptime';
import { runAlerts } from './runAlerts';
import { runDomains } from './runDomains';
import { defaultDomainResolver } from './domainResolver';
import { serviceClient } from './supabase';
import { wpIngest } from './wpIngest';
import { triggerJob } from './trigger';

// CORS pre volanie z web appky (pages.dev / vlastná doména).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

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
          await recordSchedulerRun(env, 'ok', null);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(JSON.stringify({ ev: 'scheduled.error', message }));
          await recordSchedulerRun(env, 'error', message);
          throw err;
        }
      })(),
    );
    // TODO(krok 8): region_outage alert (insert) + expiry alerty (GitHub Action alebo tu)
  },

  // HTTP endpoint — WP agent push + ručné spustenie jobu z UI.
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname === '/trigger') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'POST' && url.pathname === '/wp-ingest') return wpIngest(request, env);
    if (request.method === 'POST' && url.pathname === '/trigger') {
      const res = await triggerJob(request, env);
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    }
    return new Response('Monitorix scheduler', { status: 200 });
  },
} satisfies ExportedHandler<Env>;

/** Zapíše beh scheduler ticku do job_runs (best-effort — nezhodí tick). */
async function recordSchedulerRun(env: Env, status: 'ok' | 'error', error: string | null): Promise<void> {
  try {
    await serviceClient(env).from('job_runs').insert({ job: 'scheduler', status, error, finished_at: new Date().toISOString() });
  } catch {
    /* best-effort */
  }
}
