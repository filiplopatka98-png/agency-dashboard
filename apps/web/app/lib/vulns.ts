// Čistá CVE/verzná logika pre WordPress zraniteľnosti — testovateľná, mimo
// komponentu (predtým uzavretá v sites/page.tsx, nedosiahnuteľná pre testy).

export type Vuln = { target: string; slug: string; version: string; title: string; cve: string | null; fixed_in: string | null; cvss: number | null; severity: string };

// Zobrazenie CVSS závažnosti (label/farby/rank). 'unknown' = skóre zatiaľ nemáme.
export const SEV_META: Record<string, { label: string; color: string; bg: string; rank: number }> = {
  critical: { label: 'Kritická', color: 'var(--critical-color)', bg: 'var(--critical-bg)', rank: 5 },
  high: { label: 'Vysoká', color: 'var(--critical-color)', bg: 'var(--critical-bg)', rank: 4 },
  medium: { label: 'Stredná', color: 'var(--warning-color)', bg: 'var(--warning-bg)', rank: 3 },
  unknown: { label: 'Neznáma', color: 'var(--text-tertiary)', bg: 'var(--surface-secondary)', rank: 2 },
  low: { label: 'Nízka', color: 'var(--text-secondary)', bg: 'var(--surface-secondary)', rank: 1 },
  none: { label: 'Žiadna', color: 'var(--text-tertiary)', bg: 'var(--surface-secondary)', rank: 0 },
};

export const sevMeta = (s: string | null | undefined) => SEV_META[s ?? 'unknown'] ?? SEV_META.unknown!;

export const maxSev = (items: Vuln[]): string =>
  items.reduce((best, v) => (sevMeta(v.severity).rank > sevMeta(best).rank ? v.severity : best), 'none' as string);

export function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Najvyššia fixed_in (updatni sem → vyriešiš všetky CVE skupiny); null ak niektorá nemá opravu.
export function maxFixedIn(items: Vuln[]): string | null {
  let hasUnfixed = false;
  let max: string | null = null;
  for (const v of items) {
    if (!v.fixed_in) hasUnfixed = true;
    else if (!max || cmpVer(v.fixed_in, max) > 0) max = v.fixed_in;
  }
  return hasUnfixed ? null : max;
}
