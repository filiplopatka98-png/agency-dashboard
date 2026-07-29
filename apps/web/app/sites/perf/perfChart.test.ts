import { describe, expect, it } from 'vitest';
import { sinceIsoForRange, yBounds, scalePoints } from './perfChart';

describe('sinceIsoForRange', () => {
  const now = new Date('2026-07-20T00:00:00Z');
  it('7d → now - 7 dní', () => {
    expect(sinceIsoForRange('7d', now)).toBe(new Date('2026-07-13T00:00:00Z').toISOString());
  });
  it('all → now - 365 dní', () => {
    expect(sinceIsoForRange('all', now)).toBe(new Date('2025-07-20T00:00:00Z').toISOString());
  });
});

describe('yBounds', () => {
  it('min/max s malým paddingom; ignoruje null', () => {
    expect(yBounds([10, null, 30, 20])).toEqual({ min: 10, max: 30 });
  });
  it('prázdne → 0..1', () => {
    expect(yBounds([])).toEqual({ min: 0, max: 1 });
  });
  it('konštanta → rozšíri rozsah, nedelí nulou', () => {
    const b = yBounds([50, 50]);
    expect(b.max).toBeGreaterThan(b.min);
  });
});

describe('scalePoints', () => {
  it('mapuje hodnoty na SVG body (y invertované), null = medzera', () => {
    const pts = scalePoints([0, 50, 100], { w: 100, h: 100, pad: 0, yMin: 0, yMax: 100 });
    expect(pts[0]).toEqual({ x: 0, y: 100 });   // 0 → dole
    expect(pts[2]).toEqual({ x: 100, y: 0 });    // 100 → hore
  });
  it('null hodnota → null bod (gap)', () => {
    const pts = scalePoints([10, null, 30], { w: 100, h: 100, pad: 0, yMin: 0, yMax: 100 });
    expect(pts[1]).toBeNull();
  });
});
