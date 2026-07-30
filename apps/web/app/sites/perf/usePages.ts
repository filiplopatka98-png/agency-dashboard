'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface PageRow {
  id: string; url: string; is_homepage: boolean;
  performance_score: number | null; accessibility: number | null; best_practices: number | null; seo: number | null;
  measured_at: string | null;
}
export interface PagesState { pages: PageRow[]; loading: boolean; error: string | null; refresh: () => void }

// monitored_pages (aktívne, homepage prvá) + latest perf_runs per stránka pre `strategy`.
// Pri refresh/zmene NEprepína na skeleton (necháva starú tabuľku, aktualizuje po dobehnutí)
// — vyhýba sa synchronnému setState v efekte (eslint react-hooks/set-state-in-effect).
export function usePages(siteId: string, strategy: 'mobile' | 'desktop'): PagesState {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<PagesState, 'refresh'>>({ pages: [], loading: true, error: null });
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: pagesData, error: pErr } = await supabase
        .from('monitored_pages').select('id, url, is_homepage').eq('site_id', siteId).eq('active', true)
        .order('is_homepage', { ascending: false }).order('added_at', { ascending: true });
      if (cancelled) return;
      if (pErr) { setState({ pages: [], loading: false, error: pErr.message }); return; }
      const rows = pagesData ?? [];
      const ids = rows.map((p) => p.id);
      const latest = new Map<string, { performance_score: number | null; accessibility: number | null; best_practices: number | null; seo: number | null; measured_at: string }>();
      if (ids.length) {
        const { data: runs } = await supabase
          .from('perf_runs').select('page_id, performance_score, accessibility, best_practices, seo, measured_at')
          .in('page_id', ids).eq('strategy', strategy).order('measured_at', { ascending: false }).limit(500);
        for (const r of runs ?? []) if (!latest.has(r.page_id)) latest.set(r.page_id, r);
      }
      if (cancelled) return;
      const pages: PageRow[] = rows.map((p) => {
        const l = latest.get(p.id);
        return { id: p.id, url: p.url, is_homepage: p.is_homepage,
          performance_score: l?.performance_score ?? null, accessibility: l?.accessibility ?? null,
          best_practices: l?.best_practices ?? null, seo: l?.seo ?? null, measured_at: l?.measured_at ?? null };
      });
      setState({ pages, loading: false, error: null });
    })();
    return () => { cancelled = true; };
  }, [siteId, strategy, tick]);
  return { ...state, refresh };
}
