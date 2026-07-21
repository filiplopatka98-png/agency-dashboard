import { describe, it, expect } from 'vitest';
import { previousMonthValue, periodForMonthValue } from './reportPeriod';

describe('previousMonthValue', () => {
  it('predchádzajúci kalendárny mesiac (UTC)', () => {
    expect(previousMonthValue(new Date('2026-07-21T10:00:00Z'))).toBe('2026-06');
  });
  it('rollover cez rok (január → predošlý december)', () => {
    expect(previousMonthValue(new Date('2026-01-10T00:00:00Z'))).toBe('2025-12');
  });
});

describe('periodForMonthValue', () => {
  it('celý mesiac ako [start, end) — koniec je exkluzívny prvý deň ďalšieho mesiaca', () => {
    const p = periodForMonthValue('2026-07');
    expect(p.startDay).toBe('2026-07-01');
    expect(p.endDay).toBe('2026-08-01');
    expect(p.startIso).toBe('2026-07-01T00:00:00.000Z');
    expect(p.endIso).toBe('2026-08-01T00:00:00.000Z');
    expect(p.monthLabel).toBe('Júl 2026');
    expect(p.periodLabel).toBe('V júli');
  });
  it('december → január ďalšieho roka', () => {
    const p = periodForMonthValue('2026-12');
    expect(p.startDay).toBe('2026-12-01');
    expect(p.endDay).toBe('2027-01-01');
    expect(p.monthLabel).toBe('December 2026');
  });
});
