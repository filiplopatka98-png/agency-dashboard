import type { Env } from './env';
import { runUptime } from './runUptime';
import { runAlerts } from './runAlerts';
import { runJobHealth } from './runJobHealth';
import { runWpCronKick } from './runWpCronKick';
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
 * Uptime beží vždy. Doména/TLS (round-robin), WP-cron kick a expiry/region alerty pridajú kroky 7–9.
 */
export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date(event.scheduledTime);
    console.log(JSON.stringify({ ev: 'scheduled.tick', at: now.toISOString() }));
    ctx.waitUntil(runTick(env));
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

/**
 * Injektovateľné kroky ticku — pre testovanie odolnosti (FIX 1). V produkcii
 * zostávajú default implementácie.
 */
export interface TickSteps {
  runUptime?: (env: Env) => Promise<unknown>;
  runDomains?: (env: Env) => Promise<unknown>;
  runWpCronKick?: (env: Env) => Promise<unknown>;
  runJobHealth?: (env: Env) => Promise<unknown>;
  runAlerts?: (env: Env) => Promise<unknown>;
  recordSchedulerRun?: (env: Env, status: 'ok' | 'error', error: string | null) => Promise<void>;
}

/**
 * Jeden tick, ODOLNE (FIX 1): každý krok je zabalený tak, aby jeho zlyhanie
 * nezabránilo bežať ostatným — hlavne `runAlerts` (drain e-mailov) beží NAKONIEC
 * VŽDY, aj keď skorší krok (uptime/domains/wp-cron/job-health) hodil. Predtým
 * bola sekvencia v jednom try a throw v skoršom kroku prerušil drain → kritický
 * site_down sa neodoslal. Chyby sa zozbierajú a zapíšu ako status 'error' (aby
 * to dead-man's switch aj UI videli), ale tick sa už NEprerušuje.
 */
export async function runTick(env: Env, steps: TickSteps = {}): Promise<void> {
  const uptime = steps.runUptime ?? ((e: Env) => runUptime(e));
  // runDomains → domainResolver → whois používa `cloudflare:sockets` (Workers-only
  // runtime import). Lazy `import()` v defaultnom kroku drží modul-graf ticku
  // čistý, aby ho bolo možné importovať v jednotkovom teste bez Workers runtime.
  const domains =
    steps.runDomains ??
    (async (e: Env) => {
      const [{ runDomains }, { defaultDomainResolver }] = await Promise.all([import('./runDomains'), import('./domainResolver')]);
      return runDomains(e, defaultDomainResolver, { limit: 3 });
    });
  const wpCron = steps.runWpCronKick ?? ((e: Env) => runWpCronKick(e, { limit: 3 }));
  const jobHealth = steps.runJobHealth ?? ((e: Env) => runJobHealth(e));
  const alerts = steps.runAlerts ?? ((e: Env) => runAlerts(e));
  const record = steps.recordSchedulerRun ?? recordSchedulerRun;

  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(JSON.stringify({ ev: 'scheduled.step_error', step: name, message }));
      errors.push(`${name}: ${message}`);
    }
  };

  await step('uptime', () => uptime(env)); // uptime + otvorenie/zatvorenie incidentov (+ insert alertov)
  await step('domains', () => domains(env)); // round-robin doména (>20 h)
  await step('wp_cron_kick', () => wpCron(env)); // kopni wp-cron.php na zaspatých WP weboch (>25h bez push)
  await step('job_health', () => jobHealth(env)); // dead-man's switch — insertne job_overdue/job_failed alert
  await step('alerts', () => alerts(env)); // odoslanie nevyslaných alertov (dedupe už v DB) — VŽDY, aj po zlyhaní vyššie

  await record(env, errors.length ? 'error' : 'ok', errors.length ? errors.join('; ') : null);
}

/** Zapíše beh scheduler ticku do job_runs (best-effort — nezhodí tick). */
async function recordSchedulerRun(env: Env, status: 'ok' | 'error', error: string | null): Promise<void> {
  try {
    await serviceClient(env).from('job_runs').insert({ job: 'scheduler', status, error, finished_at: new Date().toISOString() });
  } catch {
    /* best-effort */
  }
}
