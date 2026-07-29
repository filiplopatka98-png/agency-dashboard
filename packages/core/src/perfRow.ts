import type { PerfSnap, PsiOpportunity } from './psi.js';

// Riadok pre `perf_runs` (bez `measured_at`/`error` — tie dopĺňa volajúci per
// beh). ZDIEĽANÝ medzi denným collectorom (tools/psi-probe) a on-demand skenom
// (Worker /scan), nech oba produkujú IDENTICKÝ tvar a nedivergujú.
export interface PerfRunRow {
  page_id: string;
  org_id: string;
  strategy: string;
  performance_score: number | null;
  accessibility: number | null;
  best_practices: number | null;
  seo: number | null;
  lcp_ms: number | null;
  fcp_ms: number | null;
  inp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  ttfb_ms: number | null;
  page_weight_kb: number | null;
  requests: number | null;
  field_lcp_ms: number | null;
  field_inp_ms: number | null;
  field_cls: number | null;
  opportunities: PsiOpportunity[];
}

export function perfRunRow(snap: PerfSnap, page: { id: string; org_id: string }, strategy: string): PerfRunRow {
  return {
    page_id: page.id,
    org_id: page.org_id,
    strategy,
    performance_score: snap.performanceScore,
    accessibility: snap.accessibility,
    best_practices: snap.bestPractices,
    seo: snap.seo,
    lcp_ms: snap.lcpMs,
    fcp_ms: snap.fcpMs,
    inp_ms: snap.inpMs,
    cls: snap.cls,
    tbt_ms: snap.tbtMs,
    ttfb_ms: snap.ttfbMs,
    page_weight_kb: snap.pageWeightKb,
    requests: snap.requests,
    field_lcp_ms: snap.fieldLcpMs,
    field_inp_ms: snap.fieldInpMs,
    field_cls: snap.fieldCls,
    opportunities: snap.opportunities,
  };
}
