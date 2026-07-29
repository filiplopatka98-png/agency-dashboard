import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateAdmin } from './trigger';
import { serviceClient } from './supabase';
import { perfRunRow, fetchPsi as coreFetchPsi } from '@agency/core';
import type { Env } from './env';

const RATE_LIMIT_MS = 60_000;

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

  const { data: page } = await supabase
    .from('monitored_pages')
    .select('id, org_id, url, active')
    .eq('id', body.page_id)
    .maybeSingle();
  if (!page || page.active === false) return json({ error: 'Stránka neexistuje alebo je neaktívna.' }, 404);

  // Rate-limit: najnovší scan_job pre (page, strategy) — pending alebo < 60 s → 429.
  const { data: last } = await supabase
    .from('scan_jobs')
    .select('status, requested_at')
    .eq('page_id', page.id)
    .eq('strategy', strategy)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last && (last.status === 'pending' || Date.now() - Date.parse(last.requested_at) < RATE_LIMIT_MS)) {
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
