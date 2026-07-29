import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateAdmin } from './trigger';
import { serviceClient } from './supabase';
import { perfRunRow, fetchPsi as coreFetchPsi } from '@agency/core';
import type { Env } from './env';

const RATE_LIMIT_MS = 60_000;
// Pending starší než tento prah = evictnutý Worker (performScan zomrel v
// `ctx.waitUntil` skôr, než zapísal done/error), NIE in-flight. Ťažké stránky
// (fetchPsi až ~4 min: 120 s timeout + retry) sú najnáchylnejšie na eviction a
// zároveň najviac potrebujú manuálny re-sken — bez tohto by ich zaseknutý
// pending blokoval na 7 dní (do retencie).
const STALE_PENDING_MS = 5 * 60_000;

type Ctx = { waitUntil(p: Promise<unknown>): void };
type Deps = {
  supabase?: SupabaseClient;
  auth?: (request: Request, env: Env) => Promise<{ sub: string } | { error: Response }>;
  fetchPsi?: typeof coreFetchPsi;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleScan(request: Request, env: Env, ctx: Ctx, deps: Deps = {}): Promise<Response> {
  if (!env.PSI_API_KEY) return json({ error: 'On-demand sken nie je nakonfigurovaný (chýba PSI_API_KEY).' }, 503);
  const supabase = deps.supabase ?? serviceClient(env);
  const authenticate = deps.auth ?? authenticateAdmin;
  const fetchPsi = deps.fetchPsi ?? coreFetchPsi;

  const authed = await authenticate(request, env);
  if ('error' in authed) return authed.error;

  let body: { page_id?: string; strategy?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* ignore */
  }
  const strategy = body.strategy;
  if (strategy !== 'mobile' && strategy !== 'desktop') return json({ error: 'Neplatná strategy (mobile|desktop).' }, 400);
  if (!body.page_id) return json({ error: 'Chýba page_id.' }, 400);

  // Fail closed: chyba dotazu (sieť / RLS) NEsmie prejsť ako „stránka OK".
  let page: { id: string; org_id: string; url: string; active?: boolean } | null;
  try {
    const p = await supabase.from('monitored_pages').select('id, org_id, url, active').eq('id', body.page_id).maybeSingle();
    if (p.error) throw p.error;
    page = p.data;
  } catch {
    return json({ error: 'Nepodarilo sa overiť stránku.' }, 503);
  }
  if (!page || page.active === false) return json({ error: 'Stránka neexistuje alebo je neaktívna.' }, 404);

  // Rate-limit: najnovší scan_job pre (page, strategy). Chyba dotazu = fail
  // closed (503), NIE prejdi (inak by sa rate-limit dal obísť select chybou).
  let last: { status: string; requested_at: string } | null;
  try {
    const l = await supabase
      .from('scan_jobs')
      .select('status, requested_at')
      .eq('page_id', page.id)
      .eq('strategy', strategy)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (l.error) throw l.error;
    last = l.data;
  } catch {
    return json({ error: 'Nepodarilo sa overiť limit skenu.' }, 503);
  }
  // In-flight = pending mladší než STALE_PENDING_MS (starší = evictnutý Worker).
  // Cooldown = akýkoľvek beh pred < 60 s. Oboje → 429.
  const age = last ? Date.now() - Date.parse(last.requested_at) : Infinity;
  const inFlight = last?.status === 'pending' && age < STALE_PENDING_MS;
  const cooldown = age < RATE_LIMIT_MS;
  if (inFlight || cooldown) {
    return json({ error: 'Sken pre túto stránku práve beží alebo dobehol pred chvíľou. Skús o chvíľu.' }, 429);
  }

  const { data: job, error: insErr } = await supabase
    .from('scan_jobs')
    .insert({ page_id: page.id, org_id: page.org_id, strategy, status: 'pending' })
    .select('id')
    .single();
  if (insErr || !job) return json({ error: 'Nepodarilo sa spustiť sken.' }, 500);

  ctx.waitUntil(performScan(env, supabase, fetchPsi, page, strategy, job.id));
  return json({ job_id: job.id, status: 'pending' }, 202);
}

async function performScan(
  env: Env,
  supabase: SupabaseClient,
  fetchPsi: typeof coreFetchPsi,
  page: { id: string; org_id: string; url: string },
  strategy: 'mobile' | 'desktop',
  jobId: string,
): Promise<void> {
  try {
    const r = await fetchPsi(page.url, env.PSI_API_KEY, strategy);
    if (r.ok) {
      await supabase
        .from('perf_runs')
        .insert({ ...perfRunRow(r.snap, page, strategy), measured_at: new Date().toISOString(), error: null });
      await supabase.from('scan_jobs').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', jobId);
    } else {
      // Zlyhanie PSI = žiadne dáta → NEpíš perf_runs (manuálny sken nezanáša
      // históriu chybami). Len stav pre UI. Zero-fabrication.
      await supabase
        .from('scan_jobs')
        .update({ status: 'error', error: r.error, finished_at: new Date().toISOString() })
        .eq('id', jobId);
    }
  } catch (e) {
    await supabase
      .from('scan_jobs')
      .update({ status: 'error', error: String((e as Error)?.message ?? e), finished_at: new Date().toISOString() })
      .eq('id', jobId);
  }
}
