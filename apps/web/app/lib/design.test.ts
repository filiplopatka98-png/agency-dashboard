import { describe, it, expect } from 'vitest';
import { statusKey, expiryColor, segColor, cwvMeta, sparklineFromValues, gaugeOffset, scoreColor } from './design';

describe('statusKey', () => {
  it('nikdy nekontrolované → unknown (nie up)', () => {
    expect(statusKey(0, null)).toBe('unknown');
  });
  it('hranica degraded (1 fail) vs down (2 faily)', () => {
    expect(statusKey(0, '2026-07-21T00:00:00Z')).toBe('up');
    expect(statusKey(1, '2026-07-21T00:00:00Z')).toBe('degraded');
    expect(statusKey(2, '2026-07-21T00:00:00Z')).toBe('down');
    expect(statusKey(5, '2026-07-21T00:00:00Z')).toBe('down');
  });
});

describe('expiryColor', () => {
  it('null/undefined → unknown', () => {
    expect(expiryColor(null, 30)).toBe('var(--unknown-color)');
    expect(expiryColor(undefined as unknown as number, 30)).toBe('var(--unknown-color)');
  });
  it('prahy: ≤7 critical, ≤warnAt warning, inak ok', () => {
    expect(expiryColor(7, 30)).toBe('var(--critical-color)');
    expect(expiryColor(8, 30)).toBe('var(--warning-color)');
    expect(expiryColor(30, 30)).toBe('var(--warning-color)');
    expect(expiryColor(31, 30)).toBe('var(--ok-color)');
    expect(expiryColor(-1, 30)).toBe('var(--critical-color)'); // expirované
  });
});

describe('segColor', () => {
  it('null (chýbajúci deň) → sivá, nefabrikuje 0', () => {
    expect(segColor(null)).toBe('var(--unknown-bg)');
  });
  it('prahy 99.5 / 95', () => {
    expect(segColor(99.5)).toBe('var(--ok-color)');
    expect(segColor(99.49)).toBe('var(--warning-color)');
    expect(segColor(95)).toBe('var(--warning-color)');
    expect(segColor(94.99)).toBe('var(--critical-color)');
  });
});

describe('cwvMeta', () => {
  it('null → nezistené (nie 0)', () => {
    const r = cwvMeta('lcp', null);
    expect(r.state).toBe('nezistené');
    expect(r.val).toBe('—');
  });
  it('LCP prahy 2500/4000 ms', () => {
    expect(cwvMeta('lcp', 2500).state).toBe('Dobré');
    expect(cwvMeta('lcp', 3000).state).toBe('Priemer');
    expect(cwvMeta('lcp', 4001).state).toBe('Slabé');
  });
  it('INP prahy 200/500 ms a CLS 0.1/0.25', () => {
    expect(cwvMeta('inp', 200).state).toBe('Dobré');
    expect(cwvMeta('inp', 501).state).toBe('Slabé');
    expect(cwvMeta('cls', 0.1).state).toBe('Dobré');
    expect(cwvMeta('cls', 0.26).state).toBe('Slabé');
  });
  it('bar šírka je klampovaná na 100 %', () => {
    expect(cwvMeta('lcp', 999999).w).toBe('100%');
  });
});

describe('sparklineFromValues', () => {
  it('< 2 hodnoty → null', () => {
    expect(sparklineFromValues([])).toBeNull();
    expect(sparklineFromValues([5])).toBeNull();
  });
  it('konštantné hodnoty nedelia nulou (maxV===minV)', () => {
    const r = sparklineFromValues([10, 10, 10]);
    expect(r).not.toBeNull();
    expect(r!.points).not.toContain('NaN');
    expect(r!.p95).toBe(10);
  });
});

describe('gaugeOffset a scoreColor', () => {
  it('gaugeOffset: skóre 100 → 0 offset, 0 → celý obvod', () => {
    expect(gaugeOffset(100, 200)).toBe(0);
    expect(gaugeOffset(0, 200)).toBe(200);
  });
  it('scoreColor prahy 90/50', () => {
    expect(scoreColor(90)).toBe('var(--ok-color)');
    expect(scoreColor(50)).toBe('var(--warning-color)');
    expect(scoreColor(49)).toBe('var(--critical-color)');
  });
});
