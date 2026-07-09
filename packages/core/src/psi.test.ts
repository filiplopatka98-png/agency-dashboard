import { describe, expect, it } from 'vitest';
import { parsePsi } from './psi';

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
});
