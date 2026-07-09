// Google Search Console — čisté funkcie (bez Node builtinov), aby ich vedel
// importovať aj web build. JWT podpis + HTTP volania robí collector (gsc-probe).

export interface GscRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number;
}

export interface GscQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscSummary {
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number;
  topQueries: GscQuery[];
}

/**
 * Kandidáti na GSC property z URL webu. GSC property môže byť domain
 * (`sc-domain:example.com`) alebo URL-prefix (`https://example.com/`).
 * Skúšame v poradí domain → apex → www; collector použije prvý, ktorý existuje.
 */
export function gscPropertyCandidates(siteUrl: string): string[] {
  let host: string;
  try {
    host = new URL(siteUrl).host;
  } catch {
    host = siteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
  const bare = host.replace(/^www\./, '').toLowerCase();
  if (!bare) return [];
  return [...new Set([`sc-domain:${bare}`, `https://${bare}/`, `https://www.${bare}/`])];
}

/**
 * Spojí GSC odpovede (totals bez dimenzií + rows dimenzované na `query`) do
 * nášho tvaru. Nič sa neodhaduje — prázdne vstupy → nuly / prázdny zoznam.
 */
export function parseGscResponse(totalRows: GscRow[], queryRows: GscRow[], topN = 10): GscSummary {
  const t = totalRows[0];
  const topQueries = [...queryRows]
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, topN)
    .map((r) => ({
      query: r.keys?.[0] ?? '',
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }));
  return {
    clicks: t?.clicks ?? 0,
    impressions: t?.impressions ?? 0,
    ctr: t?.ctr ?? 0,
    position: t?.position ?? 0,
    topQueries,
  };
}
