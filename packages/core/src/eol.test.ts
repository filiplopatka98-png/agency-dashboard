import { describe, it, expect } from 'vitest';
import { checkEol, WP_MIN_SUPPORTED, PHP_EOL, type EolFinding } from './eol';

const NOW = new Date('2026-07-20T00:00:00Z');

describe('checkEol — PHP', () => {
  it('verzia po EOL dátume → nález s dátumom', () => {
    // 8.1 EOL 2025-12-31 < 2026-07-20 → EOL
    const out = checkEol(null, '8.1.27', NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.component).toBe('php');
    expect(out[0]!.kind).toBe('PHP');
    expect(out[0]!.version).toBe('8.1.27');
    // branch = major.minor pre dedupe (patch bump nesmie meniť kľúč)
    expect(out[0]!.branch).toBe('8.1');
    expect(out[0]!.text).toContain('8.1.27');
    expect(out[0]!.text).toContain('2025-12-31');
  });

  it('branch je major.minor nezávisle od patch verzie (dedupe stabilita)', () => {
    // 8.1.27 aj 8.1.28 sú tá istá mŕtva vetva → rovnaký branch → dedupe
    expect(checkEol(null, '8.1.27', NOW)[0]!.branch).toBe('8.1');
    expect(checkEol(null, '8.1.28', NOW)[0]!.branch).toBe('8.1');
    // ale telo si drží skutočnú detegovanú verziu
    expect(checkEol(null, '8.1.28', NOW)[0]!.text).toContain('8.1.28');
  });

  it('8.0 je dávno po EOL', () => {
    expect(checkEol(null, '8.0.30', NOW)).toHaveLength(1);
  });

  it('verzia ešte podporovaná → []', () => {
    // 8.3 do 2027-12-31 > 2026-07-20 → OK
    expect(checkEol(null, '8.3.1', NOW)).toEqual([]);
    // 8.2 do 2026-12-31 > 2026-07-20 → OK
    expect(checkEol(null, '8.2.5', NOW)).toEqual([]);
  });

  it('verzia staršia než najstaršia sledovaná (7.x) → EOL bez fabrikovaného dátumu', () => {
    const out = checkEol(null, '7.4.33', NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.component).toBe('php');
    // nesmieme si vymyslieť konkrétny deň
    expect(out[0]!.text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('neznáma / novšia než tabuľka verzia (8.9) → [] (nefabrikujeme)', () => {
    expect(checkEol(null, '8.9.0', NOW)).toEqual([]);
  });

  it('nezmyselný / prázdny vstup → []', () => {
    expect(checkEol(null, '', NOW)).toEqual([]);
    expect(checkEol(null, 'neznama', NOW)).toEqual([]);
    expect(checkEol(null, null, NOW)).toEqual([]);
    expect(checkEol(null, undefined, NOW)).toEqual([]);
  });

  it('EOL presne dnes sa NEráta ako po konci (< now, nie <=)', () => {
    // umelo: dátum rovný now → nie je po konci
    const atEol = new Date(PHP_EOL['8.1']! + 'T00:00:00Z');
    expect(checkEol(null, '8.1.0', atEol)).toEqual([]);
  });
});

describe('checkEol — WordPress', () => {
  it('pod politickým prahom → nález', () => {
    const out = checkEol('6.3.2', null, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.component).toBe('wordpress');
    expect(out[0]!.kind).toBe('WordPress');
    expect(out[0]!.branch).toBe('6.3');
    expect(out[0]!.text).toContain(WP_MIN_SUPPORTED);
  });

  it('na prahu alebo nad ním → []', () => {
    expect(checkEol(WP_MIN_SUPPORTED, null, NOW)).toEqual([]);
    expect(checkEol('6.5.2', null, NOW)).toEqual([]);
    expect(checkEol('7.0', null, NOW)).toEqual([]);
  });

  it('nezmyselný / prázdny vstup → []', () => {
    expect(checkEol('', null, NOW)).toEqual([]);
    expect(checkEol('neznama', null, NOW)).toEqual([]);
  });
});

describe('checkEol — kombinácia', () => {
  it('WP aj PHP po konci → dva nálezy', () => {
    const out: EolFinding[] = checkEol('6.2', '8.1.0', NOW);
    expect(out.map((f) => f.component).sort()).toEqual(['php', 'wordpress']);
  });

  it('oboje aktuálne → []', () => {
    expect(checkEol('6.5', '8.3.0', NOW)).toEqual([]);
  });
});
