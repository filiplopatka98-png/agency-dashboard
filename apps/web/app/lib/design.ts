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

/** Deterministický PRNG (seedovaný id-čkom webu) — stabilný mock naprieč rendrami. */
export function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Sparkline (p95 odozva, 30 dní) — SVG body + area + p95 hodnota. */
export function buildSparkline(seed: number): { points: string; area: string; p95: number } {
  const rnd = seeded(seed + 7);
  const base = 120 + ((seed * 13) % 90);
  const vals = Array.from({ length: 30 }, (_, i) => Math.round(base + Math.sin(i / 3) * 25 + (rnd() - 0.5) * 30));
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
  return { points: pts, area: `0,${H} ${pts} ${W},${H}`, p95: Math.round(base + 30) };
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

/** Perf mock (Lighthouse skóre + CWV) podľa device. Port z predlohy. */
export interface PerfCwv {
  val: string;
  color: string;
  state: string;
  bg: string;
  w: string;
}
export interface PerfData {
  isMobile: boolean;
  perfScore: number; perfOff: number; perfColor: string;
  a11yScore: number; a11yOff: number; a11yColor: string;
  bpScore: number; bpOff: number; bpColor: string;
  seoScore: number; seoOff: number; seoColor: string;
  lcp: PerfCwv; inp: PerfCwv; cls: PerfCwv;
  weight: string; requests: string; ttfb: string; images: string;
  trendPoints: string; trendArea: string; trendLabel: string;
}

export function buildPerf(device: 'desktop' | 'mobile'): PerfData {
  const C = 207.35;
  const off = (s: number) => +(C * (1 - s / 100)).toFixed(1);
  const isM = device === 'mobile';
  const mk = (val: string, ok: boolean, warnHi: boolean, unit: string, w: string): PerfCwv => ({
    val: val + unit,
    color: ok ? 'var(--ok-color)' : warnHi ? 'var(--warning-color)' : 'var(--critical-color)',
    state: ok ? 'Dobré' : warnHi ? 'Priemer' : 'Slabé',
    bg: ok ? 'var(--ok-bg)' : warnHi ? 'var(--warning-bg)' : 'var(--critical-bg)',
    w,
  });
  const trend = Array.from({ length: 24 }, (_, i) => (isM ? 62 : 84) + Math.sin(i / 3.5) * 6 + i * (isM ? 0.4 : 0.25));
  const mn = Math.min(...trend);
  const mx = Math.max(...trend);
  const W = 560;
  const H = 60;
  const pts = trend
    .map((v, i) => `${((i / (trend.length - 1)) * W).toFixed(1)},${(H - ((v - mn) / (mx - mn || 1)) * (H - 8) - 4).toFixed(1)}`)
    .join(' ');
  const scores = isM ? { perf: 63, a11y: 88, bp: 90, seo: 72 } : { perf: 87, a11y: 89, bp: 92, seo: 76 };
  return {
    isMobile: isM,
    perfScore: scores.perf, perfOff: off(scores.perf), perfColor: scoreColor(scores.perf),
    a11yScore: scores.a11y, a11yOff: off(scores.a11y), a11yColor: scoreColor(scores.a11y),
    bpScore: scores.bp, bpOff: off(scores.bp), bpColor: scoreColor(scores.bp),
    seoScore: scores.seo, seoOff: off(scores.seo), seoColor: scoreColor(scores.seo),
    lcp: isM ? mk('3.1', false, true, 's', '82%') : mk('1.8', true, true, 's', '72%'),
    inp: isM ? mk('260', false, true, 'ms', '78%') : mk('145', true, true, 'ms', '68%'),
    cls: isM ? mk('0.09', true, true, '', '45%') : mk('0.05', true, true, '', '50%'),
    weight: isM ? '2.6 MB' : '2.4 MB',
    requests: isM ? '98' : '94',
    ttfb: isM ? '0.5s' : '0.3s',
    images: isM ? '2.0 MB' : '1.8 MB',
    trendPoints: pts,
    trendArea: `0,${H} ${pts} ${W},${H}`,
    trendLabel: isM ? 'Mobil · 90 dní' : 'Desktop · 90 dní',
  };
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

/** AI-bot matica — allow / block / rozhodnúť (cyklus). */
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
    decide: { label: '? ROZHODNÚŤ', color: 'white', bg: 'var(--warning-color)', rowBg: 'var(--warning-bg)', border: 'var(--warning-border)' },
  } as const;
  return meta[dec];
}
export function nextBot(dec: BotDecision): BotDecision {
  const order: BotDecision[] = ['allow', 'block', 'decide'];
  return order[(order.indexOf(dec) + 1) % order.length]!;
}

/** Uptime segmenty (30 d) a kalendár (90 d) z reálnych denných % alebo mock. */
export function segColor(pct: number | null): string {
  if (pct === null) return 'var(--unknown-bg)';
  if (pct >= 99.5) return 'var(--ok-color)';
  if (pct >= 95) return 'var(--warning-color)';
  return 'var(--critical-color)';
}
