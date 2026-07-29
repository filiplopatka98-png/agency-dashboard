import { describe, expect, it, vi } from 'vitest';
import { fetchPsi, parsePsi } from './psi';

const OK = {
  lighthouseResult: {
    categories: {
      performance: { score: 0.87 },
      accessibility: { score: 0.92 },
      'best-practices': { score: 1 },
      seo: { score: 0.76 },
    },
    audits: {
      'largest-contentful-paint': { numericValue: 1834.5 },
      'interaction-to-next-paint': { numericValue: 145 },
      'cumulative-layout-shift': { numericValue: 0.05 },
      'total-blocking-time': { numericValue: 210 },
      'server-response-time': { numericValue: 320 },
      'total-byte-weight': { numericValue: 2_516_582 },
      'network-requests': { details: { items: [1, 2, 3, 4] } },
    },
  },
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2400 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 9 },
    },
  },
};

describe('parsePsi', () => {
  it('vytiahne skóre, CWV a page stats', () => {
    const r = parsePsi(OK);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snap.performanceScore).toBe(87);
    expect(r.snap.seo).toBe(76);
    expect(r.snap.lcpMs).toBe(1835);
    expect(r.snap.inpMs).toBe(145);
    expect(r.snap.cls).toBe(0.05);
    expect(r.snap.ttfbMs).toBe(320);
    expect(r.snap.pageWeightKb).toBe(2458);
    expect(r.snap.requests).toBe(4);
    expect(r.snap.fieldLcpMs).toBe(2400);
    expect(r.snap.fieldCls).toBeCloseTo(0.09);
  });

  it('prázdny lighthouseResult (PSI error 200) → ok:false, nefabrikuje', () => {
    expect(parsePsi({ lighthouseResult: {} }).ok).toBe(false);
    expect(parsePsi({}).ok).toBe(false);
  });

  it('parsePsi extrahuje FCP z first-contentful-paint auditu', () => {
    const json = {
      lighthouseResult: {
        categories: { performance: { score: 0.9 } },
        audits: { 'first-contentful-paint': { numericValue: 1234.6 } },
      },
    };
    const r = parsePsi(json as never);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snap.fcpMs).toBe(1235);
  });
  it('parsePsi fcpMs = null keď audit chýba', () => {
    const json = { lighthouseResult: { categories: { performance: { score: 0.5 } }, audits: {} } };
    const r = parsePsi(json as never);
    if (r.ok) expect(r.snap.fcpMs).toBeNull();
  });

  it('parsePsi zoberie len opportunity audity, zoradí podľa úspory, cap 8', () => {
    const audits: Record<string, unknown> = {
      'unused-css': { title: 'Reduce unused CSS', score: 0.5, details: { type: 'opportunity', overallSavingsMs: 300, overallSavingsBytes: 12000 } },
      'unused-js': { title: 'Reduce unused JavaScript', score: 0.2, details: { type: 'opportunity', overallSavingsMs: 900 } },
      'ok-audit': { title: 'Perfektné', score: 1, details: { type: 'opportunity', overallSavingsMs: 0 } },
      'not-opp': { title: 'Diagnostika', score: 0.3, details: { type: 'table' } },
    };
    const json = { lighthouseResult: { categories: { performance: { score: 0.4 } }, audits } };
    const r = parsePsi(json as never);
    if (!r.ok) throw new Error('má byť ok');
    expect(r.snap.opportunities.map((o) => o.id)).toEqual(['unused-js', 'unused-css']); // score<1, opportunity, zoradené savingsMs desc
    expect(r.snap.opportunities[0]).toEqual({ id: 'unused-js', title: 'Reduce unused JavaScript', savingsMs: 900, savingsBytes: null, score: 0.2 });
  });
  it('parsePsi opportunities = [] keď žiadne', () => {
    const json = { lighthouseResult: { categories: { performance: { score: 1 } }, audits: {} } };
    const r = parsePsi(json as never);
    if (r.ok) expect(r.snap.opportunities).toEqual([]);
  });
});

/** fetch mock, ktorý vracia responses z fronty (jedna na volanie). */
function queuedFetch(responses: Response[]) {
  const fn = vi.fn(async () => {
    const r = responses.shift();
    if (!r) throw new Error('no more queued responses');
    return r;
  });
  return fn as unknown as typeof fetch & { mock: typeof fn.mock };
}

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const noSleep = () => Promise.resolve();

describe('fetchPsi — retry na tranzientné zlyhanie', () => {
  it('úspech na prvý pokus → presne 1 volanie fetch', async () => {
    const fetchImpl = queuedFetch([jsonRes(OK)]);
    const r = await fetchPsi('https://example.sk', 'key', 'mobile', fetchImpl, noSleep);
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('1. pokus zlyhá (500), 2. uspeje → vráti úspech (2 volania)', async () => {
    const fetchImpl = queuedFetch([
      new Response('server error', { status: 500 }),
      jsonRes(OK),
    ]);
    const r = await fetchPsi('https://example.sk', 'key', 'mobile', fetchImpl, noSleep);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snap.performanceScore).toBe(87);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('oba pokusy zlyhajú (500) → vráti ok:false s chybou, nehádže výnimku', async () => {
    const fetchImpl = queuedFetch([
      new Response('server error 1', { status: 500 }),
      new Response('server error 2', { status: 500 }),
    ]);
    const r = await fetchPsi('https://example.sk', 'key', 'mobile', fetchImpl, noSleep);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('500');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
