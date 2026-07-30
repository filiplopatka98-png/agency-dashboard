import { describe, expect, it } from 'vitest';
import { normalizePageUrl } from './pageUrl';

describe('normalizePageUrl', () => {
  it('doplní https a normalizuje na doménu webu', () => {
    expect(normalizePageUrl('example.sk/sluzby', 'example.sk')).toEqual({ ok: true, url: 'https://example.sk/sluzby' });
  });
  it('zachová https + path + query, odreže trailing slash', () => {
    expect(normalizePageUrl('https://example.sk/a/?x=1', 'example.sk')).toEqual({ ok: true, url: 'https://example.sk/a?x=1' });
  });
  it('www sa ignoruje (rovnaká doména)', () => {
    expect(normalizePageUrl('https://www.example.sk/a', 'example.sk')).toEqual({ ok: true, url: 'https://example.sk/a' });
  });
  it('root → /', () => {
    expect(normalizePageUrl('example.sk', 'example.sk')).toEqual({ ok: true, url: 'https://example.sk/' });
  });
  it('iná doména → chyba', () => {
    const r = normalizePageUrl('https://iny.sk/a', 'example.sk');
    expect(r.ok).toBe(false);
  });
  it('prázdne / nezmysel → chyba', () => {
    expect(normalizePageUrl('', 'example.sk').ok).toBe(false);
    expect(normalizePageUrl('http://', 'example.sk').ok).toBe(false);
  });
});
