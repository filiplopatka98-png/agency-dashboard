import { describe, expect, it } from 'vitest';
import { handleScan } from './runScan';
import { fakeSupabase, type FakeStore } from './fakeSupabase';
import type { Env } from './env';

const env = { PSI_API_KEY: 'k' } as Env;
const PAGE = { id: 'page-1', org_id: 'org-1', url: 'https://x.sk', active: true };
function store(): FakeStore {
  return { alerts: [], job_runs: [], organizations: [{ id: 'org-1' }], monitored_pages: [PAGE], scan_jobs: [], perf_runs: [] };
}
function req(body: unknown) {
  return new Request('https://w/scan', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) });
}
const okAuth = async () => ({ sub: 'u1' } as const);
const collectWaitUntil = () => {
  const ps: Promise<unknown>[] = [];
  return { ctx: { waitUntil: (p: Promise<unknown>) => ps.push(p) }, done: () => Promise.all(ps) };
};

describe('handleScan', () => {
  it('zlá strategy → 400', async () => {
    const s = store();
    const res = await handleScan(req({ page_id: 'page-1', strategy: 'x' }), env, { waitUntil() {} }, { supabase: fakeSupabase(s), auth: okAuth });
    expect(res.status).toBe(400);
  });
  it('neznáma page → 404', async () => {
    const s = store();
    s.monitored_pages = [];
    const res = await handleScan(req({ page_id: 'nope', strategy: 'mobile' }), env, { waitUntil() {} }, { supabase: fakeSupabase(s), auth: okAuth });
    expect(res.status).toBe(404);
  });
  it('in-flight (pending) → 429', async () => {
    const s = store();
    s.scan_jobs = [{ id: 'j0', page_id: 'page-1', org_id: 'org-1', strategy: 'mobile', status: 'pending', requested_at: new Date().toISOString() }];
    const res = await handleScan(req({ page_id: 'page-1', strategy: 'mobile' }), env, { waitUntil() {} }, { supabase: fakeSupabase(s), auth: okAuth });
    expect(res.status).toBe(429);
  });
  it('happy path → 202 + scan_job pending + po dobehnutí done + perf_runs riadok', async () => {
    const s = store();
    const { ctx, done } = collectWaitUntil();
    const fakePsi = async () => ({
      ok: true as const,
      snap: {
        performanceScore: 90, accessibility: 90, bestPractices: 100, seo: 90, lcpMs: 2000, fcpMs: 1800, inpMs: 100, cls: 0.01, tbtMs: 100, ttfbMs: 200, pageWeightKb: 500, requests: 30, fieldLcpMs: null, fieldInpMs: null, fieldCls: null, opportunities: [],
      },
    });
    const res = await handleScan(req({ page_id: 'page-1', strategy: 'mobile' }), env, ctx, { supabase: fakeSupabase(s), auth: okAuth, fetchPsi: fakePsi });
    expect(res.status).toBe(202);
    expect(s.scan_jobs).toHaveLength(1);
    await done();
    expect(s.scan_jobs![0]!.status).toBe('done');
    expect(s.perf_runs).toHaveLength(1);
    expect(s.perf_runs![0]!.performance_score).toBe(90);
  });
  it('PSI zlyhá → scan_job error, žiadny perf_runs', async () => {
    const s = store();
    const { ctx, done } = collectWaitUntil();
    const failPsi = async () => ({ ok: false as const, error: 'psi 500' });
    await handleScan(req({ page_id: 'page-1', strategy: 'mobile' }), env, ctx, { supabase: fakeSupabase(s), auth: okAuth, fetchPsi: failPsi });
    await done();
    expect(s.scan_jobs![0]!.status).toBe('error');
    expect(s.perf_runs).toHaveLength(0);
  });
});
