'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface PerfRun {
  measured_at: string;
  performance_score: number | null;
  accessibility: number | null;
  best_practices: number | null;
  seo: number | null;
  lcp_ms: number | null; fcp_ms: number | null; inp_ms: number | null;
  cls: number | null; tbt_ms: number | null; ttfb_ms: number | null;
  field_lcp_ms: number | null; field_inp_ms: number | null; field_cls: number | null;
  opportunities: unknown;
  error: string | null;
}

export interface PerfData { history: PerfRun[]; latest: PerfRun | null; loading: boolean; error: string | null }

// Interný stav: dáta + `key` = params (pageId|strategy|sinceIso), ku ktorým dáta patria.
// `loading` sa neukladá — odvodzuje sa pri renderi porovnaním aktuálnych params s `key`,
// aby sme nevolali setState synchrónne v efekte (žiadne kaskádové rendery).
interface PerfState { history: PerfRun[]; latest: PerfRun | null; error: string | null; key: string | null }

// Číta perf_runs pre (pageId, strategy) od `sinceIso`. Latest = posledný (najnovší).
// pageId null (homepage sa ešte resolvuje) → nič nefetchuj.
export function usePerfData(pageId: string | null, strategy: 'mobile' | 'desktop', sinceIso: string): PerfData {
  const [state, setState] = useState<PerfState>({ history: [], latest: null, error: null, key: null });
  useEffect(() => {
    if (!pageId) return;
    let cancelled = false;
    const key = `${pageId}|${strategy}|${sinceIso}`;
    supabase
      .from('perf_runs')
      .select('measured_at, performance_score, accessibility, best_practices, seo, lcp_ms, fcp_ms, inp_ms, cls, tbt_ms, ttfb_ms, field_lcp_ms, field_inp_ms, field_cls, opportunities, error')
      .eq('page_id', pageId)
      .eq('strategy', strategy)
      .gte('measured_at', sinceIso)
      .order('measured_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setState({ history: [], latest: null, error: error.message, key }); return; }
        const history = (data ?? []) as PerfRun[];
        setState({ history, latest: history.length ? history[history.length - 1]! : null, error: null, key });
      });
    return () => { cancelled = true; };
  }, [pageId, strategy, sinceIso]);
  // pageId null → prázdny stav odvodený pri renderi.
  if (!pageId) return { history: [], latest: null, loading: false, error: null };
  // loading = dáta pre aktuálne params ešte nedorazili (key sa nezhoduje).
  const loading = state.key !== `${pageId}|${strategy}|${sinceIso}`;
  if (loading) return { history: [], latest: null, loading: true, error: null };
  return { history: state.history, latest: state.latest, loading: false, error: state.error };
}

// Resolvne homepage monitored_pages.id pre web (SP3a; SP3b odovzdá vybranú stránku).
export function useHomepageId(siteId: string): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.from('monitored_pages').select('id').eq('site_id', siteId).eq('is_homepage', true).limit(1).maybeSingle()
      .then(({ data }) => { if (!cancelled) setId(data?.id ?? null); });
    return () => { cancelled = true; };
  }, [siteId]);
  return id;
}
