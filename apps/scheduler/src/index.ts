import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './env';
import { runUptime } from './runUptime';
import { runAlerts } from './runAlerts';
import { runJobHealth } from './runJobHealth';
import { runEmailHealth } from './runEmailHealth';
import { runWpCronKick } from './runWpCronKick';
import { serviceClient } from './supabase';
import { wpIngest } from './wpIngest';
import { triggerJob } from './trigger';
import { handleScan } from './runScan';

// CORS pre volanie z web appky (pages.dev / vlastná doména).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

/**
 * Dva cron triggery (wrangler.jsonc). Workers Free dáva 10 ms CPU a 50
 * subrequestov na JEDNO spustenie — pôvodný jediný tick potreboval 32–55 ms a
 * ~50+ subrequestov a Cloudflare ho 2026-09-11 → 09-14 zabíjal (exceededCpu),
 * takže nedobehli alerty ani heartbeat. Preto:
 *  - MONITOR_CRON (*∕5): uptime + job health + odoslanie alertov → heartbeat `scheduler`,
 *  - UPKEEP_CRON (2-59∕5, posunutý o 2 min): domény + wp-cron kick + e-mail health
 *    → heartbeat `scheduler-upkeep`. Jeho alerty odošle najbližší monitor tick;
 *    jeho smrť nahlási job health v monitor ticku, smrť monitora scheduler-watchdog.
 */
export const MONITOR_CRON = '*/5 * * * *';
export const UPKEEP_CRON = '2-59/5 * * * *';

// Neznámy výraz (ručný test trigger v Cloudflare) → monitor: kritický tick radšej navyše než vôbec.
export function tickKind(cron: string): 'monitor' | 'upkeep' {
  return cron === UPKEEP_CRON ? 'upkeep' : 'monitor';
}

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const kind = tickKind(event.cron);
    console.log(JSON.stringify({ ev: 'scheduled.tick', kind, at: new Date(event.scheduledTime).toISOString() }));
    ctx.waitUntil(kind === 'upkeep' ? runUpkeep(env) : runTick(env));
  },

  // HTTP endpoint — WP agent push + ručné spustenie jobu z UI.
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname === '/trigger') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'POST' && url.pathname === '/wp-ingest') return wpIngest(request, env);
    if (request.method === 'POST' && url.pathname === '/trigger') {
      const res = await triggerJob(request, env);
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    }
    if (request.method === 'OPTIONS' && url.pathname === '/scan') return new Response(null, { status: 204, headers: CORS });
    if (request.method === 'POST' && url.pathname === '/scan') {
      const res = await handleScan(request, env, ctx);
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) h.set(k, v);
      return new Response(res.body, { status: res.status, headers: h });
    }
    return new Response('Monitorix scheduler', { status: 200 });
  },
} satisfies ExportedHandler<Env>;

type StepFn = (env: Env) => Promise<unknown>;
export type SchedulerJob = 'scheduler' | 'scheduler-upkeep';
export type RecordRun = (env: Env, job: SchedulerJob, status: 'ok' | 'error', error: string | null) => Promise<void>;
export type MarkStart = (env: Env, job: SchedulerJob) => Promise<void>;

/**
 * Kľúč štartovacieho záznamu v job_runs (`scheduler:start`, `scheduler-upkeep:start`).
 * Zámerne INÝ job než heartbeat: keby štart písal do `scheduler`, tick zabitý
 * v polovici (exceededCpu 2026-09-11 → 09-14) by vyzeral ako živý a dead-man's
 * switch by mlčal. Nie je v JOB_SCHEDULES → sám nič nealertuje; runJobHealth
 * ho len porovná s heartbeatom a v alerte rozlíši „neodštartoval" od „spadol".
 */
export const startMarkerJob = (job: SchedulerJob): string => `${job}:start`;

/** Injektovateľné kroky — pre testy odolnosti (FIX 1). V produkcii default implementácie. */
export interface MonitorSteps {
  runUptime?: StepFn;
  runJobHealth?: StepFn;
  runAlerts?: StepFn;
  recordRun?: RecordRun;
  markStart?: MarkStart;
}
export interface UpkeepSteps {
  runDomains?: StepFn;
  runWpCronKick?: StepFn;
  runEmailHealth?: StepFn;
  recordRun?: RecordRun;
  markStart?: MarkStart;
}

// Jeden Supabase klient na celé spustenie (predtým createClient v každom kroku)
// — vytvorí sa až keď ho potrebuje default krok, testy s injektovanými krokmi ho nechcú.
function lazyClient(env: Env): () => SupabaseClient {
  let client: SupabaseClient | undefined;
  return () => (client ??= serviceClient(env));
}

/**
 * Kroky ODOLNE (FIX 1): zlyhanie kroku nezabráni ďalším — hlavne `runAlerts`
 * (drain e-mailov) beží v monitor ticku vždy, aj keď uptime/job health hodil.
 * Chyby sa zozbierajú a zapíšu ako status 'error' (vidí to dead-man's switch aj UI).
 */
async function runSteps(steps: [string, () => Promise<unknown>][]): Promise<string[]> {
  const errors: string[] = [];
  for (const [name, fn] of steps) {
    try {
      await fn();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(JSON.stringify({ ev: 'scheduled.step_error', step: name, message }));
      errors.push(`${name}: ${message}`);
    }
  }
  return errors;
}

/** Monitor tick (MONITOR_CRON): uptime → job health → odoslanie alertov → heartbeat `scheduler`. */
export async function runTick(env: Env, steps: MonitorSteps = {}): Promise<void> {
  const db = lazyClient(env);
  const record = steps.recordRun ?? ((e, job, status, error) => recordRun(e, job, status, error, db()));
  await (steps.markStart ?? ((_e, job) => markStart(job, db)))(env, 'scheduler');
  const errors = await runSteps([
    ['uptime', () => (steps.runUptime ?? ((e) => runUptime(e, { supabase: db() })))(env)], // + incidenty a site_down/up alerty
    ['job_health', () => (steps.runJobHealth ?? ((e) => runJobHealth(e, { supabase: db() })))(env)], // dead-man's switch (aj pre upkeep)
    ['alerts', () => (steps.runAlerts ?? ((e) => runAlerts(e, { supabase: db() })))(env)], // VŽDY, aj po zlyhaní vyššie
  ]);
  await record(env, 'scheduler', errors.length ? 'error' : 'ok', errors.length ? errors.join('; ') : null);
}

/** Údržba (UPKEEP_CRON): domény → wp-cron kick → e-mail health → heartbeat `scheduler-upkeep`. */
export async function runUpkeep(env: Env, steps: UpkeepSteps = {}): Promise<void> {
  const db = lazyClient(env);
  const record = steps.recordRun ?? ((e, job, status, error) => recordRun(e, job, status, error, db()));
  await (steps.markStart ?? ((_e, job) => markStart(job, db)))(env, 'scheduler-upkeep');
  // runDomains → domainResolver → whois používa `cloudflare:sockets` (Workers-only
  // runtime import). Lazy `import()` drží modul-graf čistý pre jednotkové testy.
  const domains =
    steps.runDomains ??
    (async (e: Env) => {
      const [{ runDomains }, { defaultDomainResolver }] = await Promise.all([import('./runDomains'), import('./domainResolver')]);
      return runDomains(e, defaultDomainResolver, { limit: 3, supabase: db() });
    });
  const errors = await runSteps([
    ['domains', () => domains(env)], // round-robin doména (>20 h)
    ['wp_cron_kick', () => (steps.runWpCronKick ?? ((e) => runWpCronKick(e, { limit: 3, supabase: db() })))(env)],
    ['email_health', () => (steps.runEmailHealth ?? ((e) => runEmailHealth(e, { supabase: db() })))(env)],
  ]);
  await record(env, 'scheduler-upkeep', errors.length ? 'error' : 'ok', errors.length ? errors.join('; ') : null);
}

/**
 * Štartovací záznam hneď na začiatku ticku (best-effort, nikdy nehádže — tick
 * beží ďalej aj bez neho). 1 subrequest. Spolu s heartbeatom na konci rozlíši:
 * štart čerstvý + heartbeat starý = tick sa spúšťa, ale nedobehne (CPU/subrequest
 * limit, zrušený zápis); oba staré = Cloudflare cron vôbec nevolá Worker.
 */
async function markStart(job: SchedulerJob, db: () => SupabaseClient): Promise<void> {
  try {
    const { error } = await db().from('job_runs').insert({ job: startMarkerJob(job), status: 'started', finished_at: new Date().toISOString() });
    if (error) console.log(JSON.stringify({ ev: 'scheduler.start_mark_fail', job, message: error.message }));
  } catch (err: unknown) {
    console.log(JSON.stringify({ ev: 'scheduler.start_mark_fail', job, message: err instanceof Error ? err.message : String(err) }));
  }
}

/** Heartbeat do job_runs (best-effort — nezhodí tick, ale zlyhanie zaloguje). */
async function recordRun(env: Env, job: SchedulerJob, status: 'ok' | 'error', error: string | null, db: SupabaseClient): Promise<void> {
  try {
    const { error: insErr } = await db.from('job_runs').insert({ job, status, error, finished_at: new Date().toISOString() });
    // Predtým sa chyba zápisu zahadzovala — heartbeat potichu chýbal a „scheduler mešká" nemal v logoch stopu.
    if (insErr) console.log(JSON.stringify({ ev: 'scheduler.record_fail', job, message: insErr.message }));
  } catch (err: unknown) {
    console.log(JSON.stringify({ ev: 'scheduler.record_fail', job, message: err instanceof Error ? err.message : String(err) }));
  }
}
