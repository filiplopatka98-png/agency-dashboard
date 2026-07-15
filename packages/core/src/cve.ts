// CVSS závažnosť — mapovanie base score → severity podľa oficiálnych CVSS v3
// rozsahov (nvd.nist.gov). Žiadne odhady: ak nemáme reálne skóre, severity je
// 'unknown' (transparentne „neznáme", nie vymyslené).

export type CveSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none' | 'unknown';

// CVSS v3.1: 0.0 none, 0.1–3.9 low, 4.0–6.9 medium, 7.0–8.9 high, 9.0–10.0 critical.
export function severityFromScore(score: number | null | undefined): CveSeverity {
  if (score === null || score === undefined || Number.isNaN(score)) return 'unknown';
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

// Poradie pre triedenie (vyššie = závažnejšie); 'unknown' medzi low a medium,
// nech neznáme neprebijú potvrdené kritické, ale ani nezapadnú úplne dole.
const RANK: Record<CveSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  unknown: 2,
  low: 1,
  none: 0,
};

export function severityRank(sev: CveSeverity): number {
  return RANK[sev] ?? 0;
}

// Najzávažnejšia severity zo skupiny (pre zoradenie skupín CVE).
export function maxSeverity(sevs: CveSeverity[]): CveSeverity {
  let best: CveSeverity = 'none';
  for (const s of sevs) if (severityRank(s) > severityRank(best)) best = s;
  return best;
}
