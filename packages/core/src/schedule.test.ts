import { describe, expect, it } from 'vitest';
import { isNightInBratislava, NIGHT_DEFERRED_TYPES } from './schedule';

describe('isNightInBratislava', () => {
  // Zima: Bratislava = UTC+1. 03:00 UTC = 04:00 lokál → noc.
  it('03:00 UTC v zime je noc', () => {
    expect(isNightInBratislava(new Date('2026-01-15T03:00:00Z'))).toBe(true);
  });

  // Zima: 12:00 UTC = 13:00 lokál → deň.
  it('12:00 UTC v zime je deň', () => {
    expect(isNightInBratislava(new Date('2026-01-15T12:00:00Z'))).toBe(false);
  });

  // Leto: Bratislava = UTC+2. 21:30 UTC = 23:30 lokál → noc.
  it('21:30 UTC v lete je noc', () => {
    expect(isNightInBratislava(new Date('2026-07-15T21:30:00Z'))).toBe(true);
  });

  // Leto: 05:00 UTC = 07:00 lokál → deň (nočné okno končí o 06:00).
  it('05:00 UTC v lete je deň', () => {
    expect(isNightInBratislava(new Date('2026-07-15T05:00:00Z'))).toBe(false);
  });

  // Leto: 04:00 UTC = 06:00 lokál → hranica, deň (>=06:00).
  it('06:00 lokálneho času už NIE je noc', () => {
    expect(isNightInBratislava(new Date('2026-07-15T04:00:00Z'))).toBe(false);
  });
});

describe('NIGHT_DEFERRED_TYPES', () => {
  it('site_up a region_outage sa v noci odkladajú, site_down nie', () => {
    expect(NIGHT_DEFERRED_TYPES.has('site_up')).toBe(true);
    expect(NIGHT_DEFERRED_TYPES.has('region_outage')).toBe(true);
    expect(NIGHT_DEFERRED_TYPES.has('site_down')).toBe(false);
  });
});
