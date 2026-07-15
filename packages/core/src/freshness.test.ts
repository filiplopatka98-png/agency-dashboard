import { describe, it, expect } from 'vitest';
import { computeFreshness, freshnessFor } from './freshness';

const NOW = Date.parse('2026-07-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('computeFreshness', () => {
  it('čerstvé pod prahom', () => {
    const f = computeFreshness(hoursAgo(10), 216, NOW);
    expect(f.stale).toBe(false);
    expect(f.missing).toBe(false);
    expect(f.ageMs).toBe(10 * 3_600_000);
  });

  it('stale nad prahom', () => {
    expect(computeFreshness(hoursAgo(220), 216, NOW).stale).toBe(true);
  });

  it('presne na prahu ešte nie je stale', () => {
    expect(computeFreshness(hoursAgo(216), 216, NOW).stale).toBe(false);
  });

  it('null / neplatné → missing, nie stale', () => {
    expect(computeFreshness(null, 216, NOW)).toEqual({ ageMs: null, stale: false, missing: true });
    expect(computeFreshness('nonsense', 216, NOW).missing).toBe(true);
  });
});

describe('freshnessFor', () => {
  it('gsc má dlhší prah než aeo', () => {
    const at = hoursAgo(230);
    expect(freshnessFor('aeo', at, NOW).stale).toBe(true);
    expect(freshnessFor('gsc', at, NOW).stale).toBe(false);
  });
});
