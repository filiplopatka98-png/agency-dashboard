import { describe, expect, it } from 'vitest';
import type { CheckResult } from '@agency/shared';
import { decideIncidents, REGION_MIN_SITES, type SiteIncidentState } from './decideIncidents';

const ok = (siteId: string): CheckResult => ({ siteId, ok: true });
const fail = (siteId: string): CheckResult => ({ siteId, ok: false, statusCode: 503 });

const state = (consecutiveFailures: number, hasOpenIncident: boolean): SiteIncidentState => ({
  consecutiveFailures,
  hasOpenIncident,
});

describe('decideIncidents', () => {
  it('jeden fail (0→1) NEotvorí incident', () => {
    const out = decideIncidents({
      results: [fail('s1')],
      sites: new Map([['s1', state(0, false)]]),
    });
    expect(out.openIncident).toEqual([]);
    expect(out.closeIncident).toEqual([]);
    expect(out.newFailureCounts.get('s1')).toBe(1);
    expect(out.regionOutage).toBe(false);
  });

  it('druhý fail (1→2) OTVORÍ incident', () => {
    const out = decideIncidents({
      results: [fail('s1')],
      sites: new Map([['s1', state(1, false)]]),
    });
    expect(out.openIncident).toEqual(['s1']);
    expect(out.newFailureCounts.get('s1')).toBe(2);
  });

  it('fail na webe s už otvoreným incidentom incident znovu neotvára', () => {
    const out = decideIncidents({
      results: [fail('s1')],
      sites: new Map([['s1', state(5, true)]]),
    });
    expect(out.openIncident).toEqual([]);
    expect(out.newFailureCounts.get('s1')).toBe(6);
  });

  it('úspech na webe s otvoreným incidentom incident ZATVORÍ a vynuluje count', () => {
    const out = decideIncidents({
      results: [ok('s1')],
      sites: new Map([['s1', state(3, true)]]),
    });
    expect(out.closeIncident).toEqual(['s1']);
    expect(out.openIncident).toEqual([]);
    expect(out.newFailureCounts.get('s1')).toBe(0);
  });

  it('úspech bez otvoreného incidentu len vynuluje count', () => {
    const out = decideIncidents({
      results: [ok('s1')],
      sites: new Map([['s1', state(1, false)]]),
    });
    expect(out.closeIncident).toEqual([]);
    expect(out.newFailureCounts.get('s1')).toBe(0);
  });

  it('web bez záznamu v mape sa berie ako 0 failov / bez incidentu', () => {
    const out = decideIncidents({ results: [fail('new')], sites: new Map() });
    expect(out.openIncident).toEqual([]);
    expect(out.newFailureCounts.get('new')).toBe(1);
  });

  it('13 z 25 down = region outage → 0 incidentov, counts nezmenené', () => {
    const results: CheckResult[] = [];
    const sites = new Map<string, SiteIncidentState>();
    for (let i = 0; i < 25; i++) {
      const id = `s${i}`;
      results.push(i < 13 ? fail(id) : ok(id));
      sites.set(id, state(1, false)); // každý má 1 predošlý fail
    }
    const out = decideIncidents({ results, sites });
    expect(out.regionOutage).toBe(true);
    expect(out.openIncident).toEqual([]);
    expect(out.closeIncident).toEqual([]);
    // counts musia zostať nezmenené (1), nie 2 a nie 0
    expect(out.newFailureCounts.get('s0')).toBe(1);
    expect(out.newFailureCounts.get('s24')).toBe(1);
    expect(out.newFailureCounts.size).toBe(25);
  });

  it('12 z 25 down = normálny režim (nie region outage)', () => {
    const results: CheckResult[] = [];
    const sites = new Map<string, SiteIncidentState>();
    for (let i = 0; i < 25; i++) {
      const id = `s${i}`;
      results.push(i < 12 ? fail(id) : ok(id));
      sites.set(id, state(1, false));
    }
    const out = decideIncidents({ results, sites });
    expect(out.regionOutage).toBe(false);
    // 12 webov malo 1 fail → teraz 2 → otvoria sa incidenty
    expect(out.openIncident).toHaveLength(12);
  });

  it('malé N (2 z 3 down) NIE je region outage — reálne výpadky sa NEpotláčajú', () => {
    const results = [fail('s1'), fail('s2'), ok('s3')];
    const sites = new Map<string, SiteIncidentState>([
      ['s1', state(1, false)],
      ['s2', state(1, false)],
      ['s3', state(0, false)],
    ]);
    const out = decideIncidents({ results, sites });
    expect(out.regionOutage).toBe(false);
    expect(out.openIncident.sort()).toEqual(['s1', 's2']);
  });

  it('presne na prahu: všetky down pri N = REGION_MIN_SITES → region outage', () => {
    const results: CheckResult[] = [];
    for (let i = 0; i < REGION_MIN_SITES; i++) results.push(fail(`s${i}`));
    const out = decideIncidents({ results, sites: new Map() });
    expect(out.regionOutage).toBe(true);
  });

  it('prázdna dávka → nič sa nedeje', () => {
    const out = decideIncidents({ results: [], sites: new Map() });
    expect(out).toEqual({
      regionOutage: false,
      openIncident: [],
      closeIncident: [],
      newFailureCounts: new Map(),
    });
  });
});
