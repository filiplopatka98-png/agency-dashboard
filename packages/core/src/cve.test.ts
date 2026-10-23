import { describe, it, expect } from 'vitest';
import { severityFromScore, severityRank, maxSeverity, onlyActiveSites } from './cve';

describe('severityFromScore', () => {
  it('mapuje CVSS v3.1 rozsahy', () => {
    expect(severityFromScore(0)).toBe('none');
    expect(severityFromScore(0.1)).toBe('low');
    expect(severityFromScore(3.9)).toBe('low');
    expect(severityFromScore(4.0)).toBe('medium');
    expect(severityFromScore(6.9)).toBe('medium');
    expect(severityFromScore(7.0)).toBe('high');
    expect(severityFromScore(8.9)).toBe('high');
    expect(severityFromScore(9.0)).toBe('critical');
    expect(severityFromScore(10)).toBe('critical');
  });

  it('bez reálneho skóre → unknown (nefabrikujeme)', () => {
    expect(severityFromScore(null)).toBe('unknown');
    expect(severityFromScore(undefined)).toBe('unknown');
    expect(severityFromScore(NaN)).toBe('unknown');
  });
});

describe('maxSeverity', () => {
  it('vyberie najzávažnejšiu', () => {
    expect(maxSeverity(['low', 'critical', 'medium'])).toBe('critical');
    expect(maxSeverity(['low', 'unknown'])).toBe('unknown');
    expect(maxSeverity([])).toBe('none');
  });

  it('unknown je nad low, pod medium', () => {
    expect(severityRank('unknown')).toBeGreaterThan(severityRank('low'));
    expect(severityRank('unknown')).toBeLessThan(severityRank('medium'));
  });
});

describe('onlyActiveSites (wp-cve)', () => {
  it('deaktivovaný web vypadne — nevygeneruje sken, záznam ani alert', () => {
    const rows = [{ site_id: 'aktivny' }, { site_id: 'profihouse' }];
    expect(onlyActiveSites(rows, new Set(['aktivny']))).toEqual([{ site_id: 'aktivny' }]);
    expect(onlyActiveSites(rows, new Set())).toEqual([]);
  });
});
