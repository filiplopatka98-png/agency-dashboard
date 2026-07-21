import { describe, it, expect } from 'vitest';
import { cmpVer, maxFixedIn, maxSev, sevMeta, type Vuln } from './vulns';

const v = (over: Partial<Vuln> = {}): Vuln => ({
  target: 'Plugin',
  slug: 'plugin',
  version: '1.0',
  title: 'CVE',
  cve: null,
  fixed_in: null,
  cvss: null,
  severity: 'medium',
  ...over,
});

describe('cmpVer', () => {
  it('porovná verzie numericky (1.10 > 1.9)', () => {
    expect(cmpVer('1.10', '1.9')).toBe(1);
    expect(cmpVer('1.9', '1.10')).toBe(-1);
    expect(cmpVer('2.0', '2.0')).toBe(0);
  });
  it('rôzne dĺžky (1.2 vs 1.2.0)', () => {
    expect(cmpVer('1.2', '1.2.0')).toBe(0);
    expect(cmpVer('1.2.1', '1.2')).toBe(1);
  });
});

describe('maxFixedIn', () => {
  it('vráti najvyššiu fixed_in, ak sú všetky opravené', () => {
    expect(maxFixedIn([v({ fixed_in: '1.5' }), v({ fixed_in: '2.1' }), v({ fixed_in: '1.9' })])).toBe('2.1');
  });
  it('null, ak niektorá zraniteľnosť nemá opravu', () => {
    expect(maxFixedIn([v({ fixed_in: '2.1' }), v({ fixed_in: null })])).toBeNull();
  });
});

describe('maxSev', () => {
  it('vyberie najzávažnejšiu podľa rank (critical > high > medium)', () => {
    expect(maxSev([v({ severity: 'medium' }), v({ severity: 'critical' }), v({ severity: 'low' })])).toBe('critical');
  });
  it('prázdny zoznam → none', () => {
    expect(maxSev([])).toBe('none');
  });
});

describe('sevMeta', () => {
  it('neznámu/null severitu mapuje na unknown', () => {
    expect(sevMeta(null).label).toBe(sevMeta('unknown').label);
    expect(sevMeta('vymyslene').label).toBe(sevMeta('unknown').label);
  });
});
