/**
 * Zdieľaná prezentačná logika portovaná z predlohy Monitorix (Agency Dashboard.dc.html).
 * Farby cez CSS premenné → light/dark funguje automaticky.
 */

export type StatusKey = 'up' | 'degraded' | 'down' | 'maintenance' | 'unknown';

export const STATUS: Record<StatusKey, { color: string; bg: string; short: string; label: string }> = {
  up: { color: 'var(--ok-color)', bg: 'var(--ok-bg)', short: 'OK', label: '✓ Dostupné' },
  degraded: { color: 'var(--warning-color)', bg: 'var(--warning-bg)', short: 'Pozor', label: '⚠ Degradované' },
  down: { color: 'var(--critical-color)', bg: 'var(--critical-bg)', short: 'Down', label: '✗ Nedostupné' },
  maintenance: { color: 'var(--accent-primary)', bg: 'var(--accent-soft)', short: 'Údržba', label: '🔧 Údržba' },
  unknown: { color: 'var(--unknown-color)', bg: 'var(--unknown-bg)', short: 'Nezistené', label: '? Nezistené' },
};

/** Stav webu z consecutive_failures + či bol niekedy kontrolovaný. */
export function statusKey(consecutiveFailures: number, lastCheckedAt: string | null): StatusKey {
  if (!lastCheckedAt) return 'unknown';
  if (consecutiveFailures >= 2) return 'down';
  if (consecutiveFailures >= 1) return 'degraded';
  return 'up';
}

/** Expiry farba: doména crit ≤7, warn ≤30; TLS crit ≤7, warn ≤21. null → sivá. */
export function expiryColor(days: number | null, warnAt: number): string {
  if (days === null || days === undefined) return 'var(--unknown-color)';
  if (days <= 7) return 'var(--critical-color)';
  if (days <= warnAt) return 'var(--warning-color)';
  return 'var(--ok-color)';
}
export const domainExpiryColor = (d: number | null) => expiryColor(d, 30);
export const tlsExpiryColor = (d: number | null) => expiryColor(d, 21);

/** Badge farba pre pill (biele písmo na plnej farbe). */
export function expiryBadgeColor(days: number | null, warnAt: number): string {
  if (days === null) return 'var(--unknown-color)';
  if (days <= 7) return 'var(--critical-color)';
  if (days <= warnAt) return 'var(--warning-color)';
  return 'var(--ok-color)';
}

/** Kruhový gauge — dashoffset pre dané skóre a obvod kruhu. */
export function gaugeOffset(score: number, circumference: number): number {
  return +(circumference * (1 - score / 100)).toFixed(1);
}
export function scoreColor(s: number): string {
  return s >= 90 ? 'var(--ok-color)' : s >= 50 ? 'var(--warning-color)' : 'var(--critical-color)';
}

/** Sparkline z reálnych hodnôt (napr. p95 odozva z uptime_daily). */
export function sparklineFromValues(vals: number[]): { points: string; area: string; p95: number } | null {
  if (vals.length < 2) return null;
  const maxV = Math.max(...vals);
  const minV = Math.min(...vals);
  const W = 560;
  const H = 70;
  const pts = vals
    .map((v, i) => {
      const x = (i / (vals.length - 1)) * W;
      const y = H - ((v - minV) / (maxV - minV || 1)) * (H - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return { points: pts, area: `0,${H} ${pts} ${W},${H}`, p95: vals[vals.length - 1]! };
}

/** Core Web Vital → prezentácia (hodnota, farba, stav, bar). value=null → nezistené. */
export function cwvMeta(
  kind: 'lcp' | 'inp' | 'cls',
  value: number | null,
): { val: string; color: string; state: string; bg: string; w: string } {
  if (value === null || value === undefined)
    return { val: '—', color: 'var(--text-tertiary)', state: 'nezistené', bg: 'var(--surface-secondary)', w: '0%' };
  let good: number, warn: number, max: number, val: string;
  if (kind === 'lcp') { good = 2500; warn = 4000; max = 4000; val = (value / 1000).toFixed(1) + 's'; }
  else if (kind === 'inp') { good = 200; warn = 500; max = 500; val = Math.round(value) + 'ms'; }
  else { good = 0.1; warn = 0.25; max = 0.25; val = value.toFixed(2); }
  const ok = value <= good;
  const mid = value <= warn;
  return {
    val,
    color: ok ? 'var(--ok-color)' : mid ? 'var(--warning-color)' : 'var(--critical-color)',
    state: ok ? 'Dobré' : mid ? 'Priemer' : 'Slabé',
    bg: ok ? 'var(--ok-bg)' : mid ? 'var(--warning-bg)' : 'var(--critical-bg)',
    w: Math.min(100, Math.round((value / max) * 100)) + '%',
  };
}

/**
 * AI-bot stav — LEN na zobrazenie (parsované z robots.txt klienta cez
 * packages/core/src/aeo.ts). Appka do robots.txt nezapisuje nič — 'decide'
 * teda znamená "bot v robots.txt vôbec nie je spomenutý", nie "čaká sa na
 * rozhodnutie od používateľa appky" (žiadny takýto krok neexistuje).
 */
export type BotDecision = 'allow' | 'block' | 'decide';
export const BOT_DEFS = [
  { key: 'gpt', name: 'GPTBot', sub: 'OpenAI · ChatGPT' },
  { key: 'claude', name: 'ClaudeBot', sub: 'Anthropic · Claude' },
  { key: 'perplexity', name: 'PerplexityBot', sub: 'Perplexity AI' },
  { key: 'google', name: 'Google-Extended', sub: 'Gemini tréning' },
] as const;

export function botMeta(dec: BotDecision) {
  const meta = {
    allow: { label: '✓ ALLOW', color: 'var(--ok-color)', bg: 'var(--ok-bg)', rowBg: 'var(--surface-secondary)', border: 'transparent' },
    block: { label: '✕ BLOCK', color: 'var(--critical-color)', bg: 'var(--critical-bg)', rowBg: 'var(--surface-secondary)', border: 'transparent' },
    decide: { label: 'NEUVEDENÉ', color: 'var(--text-secondary)', bg: 'var(--surface-secondary)', rowBg: 'var(--surface-secondary)', border: 'transparent' },
  } as const;
  return meta[dec];
}

/** Uptime segment → farba. null (chýbajúci deň) → sivá „nezistené", nefabrikuje sa. */
export function segColor(pct: number | null): string {
  if (pct === null) return 'var(--unknown-bg)';
  if (pct >= 99.5) return 'var(--ok-color)';
  if (pct >= 95) return 'var(--warning-color)';
  return 'var(--critical-color)';
}
