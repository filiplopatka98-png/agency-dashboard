import { describe, expect, it } from 'vitest';
import { perfRunRow } from './perfRow';
import type { PerfSnap } from './psi';

const snap: PerfSnap = {
  performanceScore: 90, accessibility: 92, bestPractices: 100, seo: 88,
  lcpMs: 2300, fcpMs: 2000, inpMs: 120, cls: 0.01, tbtMs: 150, ttfbMs: 300,
  pageWeightKb: 1024, requests: 42,
  fieldLcpMs: 2500, fieldInpMs: 130, fieldCls: 0.02,
  opportunities: [{ id: 'unused-js', title: 'X', savingsMs: 900, savingsBytes: null, score: 0.2 }],
};

describe('perfRunRow', () => {
  it('poskladá perf_runs riadok z PerfSnap (bez measured_at/error)', () => {
    const row = perfRunRow(snap, { id: 'page-1', org_id: 'org-1' }, 'mobile');
    expect(row).toEqual({
      page_id: 'page-1', org_id: 'org-1', strategy: 'mobile',
      performance_score: 90, accessibility: 92, best_practices: 100, seo: 88,
      lcp_ms: 2300, fcp_ms: 2000, inp_ms: 120, cls: 0.01, tbt_ms: 150, ttfb_ms: 300,
      page_weight_kb: 1024, requests: 42,
      field_lcp_ms: 2500, field_inp_ms: 130, field_cls: 0.02,
      opportunities: [{ id: 'unused-js', title: 'X', savingsMs: 900, savingsBytes: null, score: 0.2 }],
    });
  });
});
