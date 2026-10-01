import { describe, expect, it } from 'vitest';
import { EXPECTED_STRING_MAX, expectedStringError, normalizeExpectedString } from './expectedString';

describe('normalizeExpectedString', () => {
  it('prázdne / medzery → null (kontrola vypnutá)', () => {
    expect(normalizeExpectedString('')).toBeNull();
    expect(normalizeExpectedString('   ')).toBeNull();
  });
  it('orezá okraje, vnútro a veľkosť písmen nechá (localPinger porovnáva presne)', () => {
    expect(normalizeExpectedString('  Detský Svet  ')).toBe('Detský Svet');
  });
});

describe('expectedStringError', () => {
  it('prázdne a bežná hodnota sú OK', () => {
    expect(expectedStringError('')).toBeNull();
    expect(expectedStringError('Kontakt')).toBeNull();
  });
  it('dlhšie než limit → chyba', () => {
    expect(expectedStringError('x'.repeat(EXPECTED_STRING_MAX + 1))).toContain(String(EXPECTED_STRING_MAX));
    expect(expectedStringError('x'.repeat(EXPECTED_STRING_MAX))).toBeNull();
  });
});
