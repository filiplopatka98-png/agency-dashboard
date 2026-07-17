/**
 * PageSpeed Insights (Lighthouse lab + CrUX field) — parser a fetch.
 * parsePsi je čistá funkcia (test na sample). fetchPsi volá PSI API.
 * ⚠️ PSI vracia 200 aj pri chybe s prázdnym lighthouseResult — kontrolujeme score.
 */

export interface PerfSnap {
  performanceScore: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  ttfbMs: number | null;
  pageWeightKb: number | null;
  requests: number | null;
  fieldLcpMs: number | null;
  fieldInpMs: number | null;
  fieldCls: number | null;
}

interface PsiJson {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null } | undefined>;
    audits?: Record<string, { numericValue?: number; details?: { items?: unknown[] } } | undefined>;
  };
  loadingExperience?: { metrics?: Record<string, { percentile?: number } | undefined> };
}

const pct = (s: number | null | undefined): number => (s === null || s === undefined ? 0 : Math.round(s * 100));

export function parsePsi(json: PsiJson): { ok: true; snap: PerfSnap } | { ok: false; error: string } {
  const lh = json.lighthouseResult;
  const perf = lh?.categories?.['performance']?.score;
  if (!lh || perf === undefined || perf === null) {
    return { ok: false, error: 'lighthouseResult chýba / prázdne (PSI error 200)' };
  }
  const audits = lh.audits ?? {};
  const num = (id: string): number | null => {
    const v = audits[id]?.numericValue;
    return typeof v === 'number' ? v : null;
  };
  const inp = num('interaction-to-next-paint') ?? num('experimental-interaction-to-next-paint');
  const weight = num('total-byte-weight');
  const reqItems = audits['network-requests']?.details?.items;
  const requests = Array.isArray(reqItems) ? reqItems.length : null;

  const field = json.loadingExperience?.metrics;
  const fieldNum = (k: string): number | null => {
    const v = field?.[k]?.percentile;
    return typeof v === 'number' ? v : null;
  };
  const fieldClsRaw = fieldNum('CUMULATIVE_LAYOUT_SHIFT_SCORE');

  return {
    ok: true,
    snap: {
      performanceScore: pct(perf),
      accessibility: pct(lh.categories?.['accessibility']?.score),
      bestPractices: pct(lh.categories?.['best-practices']?.score),
      seo: pct(lh.categories?.['seo']?.score),
      lcpMs: num('largest-contentful-paint') !== null ? Math.round(num('largest-contentful-paint')!) : null,
      inpMs: inp !== null ? Math.round(inp) : null,
      cls: num('cumulative-layout-shift'),
      tbtMs: num('total-blocking-time') !== null ? Math.round(num('total-blocking-time')!) : null,
      ttfbMs: num('server-response-time') !== null ? Math.round(num('server-response-time')!) : null,
      pageWeightKb: weight !== null ? Math.round(weight / 1024) : null,
      requests,
      fieldLcpMs: fieldNum('LARGEST_CONTENTFUL_PAINT_MS'),
      fieldInpMs: fieldNum('INTERACTION_TO_NEXT_PAINT'),
      fieldCls: fieldClsRaw !== null ? fieldClsRaw / 100 : null,
    },
  };
}

export async function fetchPsi(
  url: string,
  apiKey: string,
  strategy: 'mobile' | 'desktop',
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: true; snap: PerfSnap } | { ok: false; error: string }> {
  const params = new URLSearchParams({ url, key: apiKey, strategy });
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) params.append('category', c);
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
  try {
    // 120 s, nie 60. Lighthouse na `mobile` škrtí sieť na pomalé 4G, takže ťažká
    // stránka sa cez 60 s nestihne zmerať a spadne na timeout — hoci desktop
    // (bez škrtenia) prejde. Reálny prípad: soccercoacheshub.com má 8 MB a LCP
    // 16 s na mobile; desktop zmeria, mobile hranične nestíhal. Google pri
    // takýchto stránkach bežne potrebuje 60–90 s a denný job má času dosť.
    // Nie je to maskovanie chyby: meranie buď prejde s pravdivými číslami,
    // alebo poctivo padne a psi-probe zapíše error + vynuluje skóre.
    const res = await fetchImpl(endpoint, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `psi ${res.status}: ${body.slice(0, 160)}` };
    }
    return parsePsi((await res.json()) as PsiJson);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
