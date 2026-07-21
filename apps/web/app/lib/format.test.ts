import { describe, it, expect, vi, afterEach } from 'vitest';
import { relativeTime, daysUntil } from './format';

afterEach(() => vi.useRealTimers());

describe('relativeTime', () => {
  it('null → nezistené', () => {
    expect(relativeTime(null)).toBe('nezistené');
  });
  it('hranice minút/hodín/dní', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));
    expect(relativeTime('2026-07-21T11:59:30Z')).toBe('práve teraz'); // < 1 min
    expect(relativeTime('2026-07-21T11:45:00Z')).toBe('pred 15 min');
    expect(relativeTime('2026-07-21T09:00:00Z')).toBe('pred 3 h');
    expect(relativeTime('2026-07-19T12:00:00Z')).toBe('pred 2 d');
  });
});

describe('daysUntil', () => {
  it('null / nevalidný dátum → null', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('nie-datum')).toBeNull();
  });
  it('počíta dni do budúceho dátumu (ceil)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T00:00:00Z'));
    expect(daysUntil('2026-07-31T00:00:00Z')).toBe(10);
    expect(daysUntil('2026-07-20T00:00:00Z')).toBe(-1); // v minulosti
  });
});
