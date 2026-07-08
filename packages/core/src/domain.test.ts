import { describe, expect, it, vi } from 'vitest';
import {
  pickDomainStrategy,
  parseRdapExpiry,
  parseWhoisSk,
  fetchRdapDomain,
} from './domain';

// Reálny tvar SK-NIC WHOIS:43 odpovede (skrátené).
const WHOIS_SK_SAMPLE = `Domain: lopatka.sk
Registrant: XY-12345
Admin Contact: XY-67890
Registrar: WebSupport s.r.o.
Created: 2015-03-15
Updated: 2026-02-01
Valid Until: 2027-03-15
Nameserver: ns1.websupport.sk
Nameserver: ns2.websupport.sk
EPP Status: ok`;

const RDAP_SAMPLE = {
  objectClassName: 'domain',
  ldhName: 'example.com',
  events: [
    { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
    { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
  ],
  entities: [
    {
      roles: ['registrar'],
      vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'MarkMonitor Inc.']]],
    },
  ],
  nameservers: [{ ldhName: 'NS1.EXAMPLE.COM' }, { ldhName: 'NS2.EXAMPLE.COM' }],
};

describe('pickDomainStrategy', () => {
  it('.sk → whois43 (SK-NIC nemá RDAP)', () => {
    expect(pickDomainStrategy('lopatka.sk')).toBe('whois43');
    expect(pickDomainStrategy('KUKO-DETSKYSVET.SK')).toBe('whois43');
  });
  it('.com/.eu/.cz → rdap', () => {
    expect(pickDomainStrategy('example.com')).toBe('rdap');
    expect(pickDomainStrategy('firma.eu')).toBe('rdap');
    expect(pickDomainStrategy('web.cz')).toBe('rdap');
  });
  it('neznáme TLD → skús rdap', () => {
    expect(pickDomainStrategy('web.xyz')).toBe('rdap');
  });
});

describe('parseWhoisSk', () => {
  it('vytiahne Valid Until a Registrar', () => {
    const out = parseWhoisSk(WHOIS_SK_SAMPLE);
    expect(out.expiresAt).toBe('2027-03-15');
    expect(out.registrar).toBe('WebSupport s.r.o.');
  });
  it('bez Valid Until → null (nefabrikuje)', () => {
    expect(parseWhoisSk('Domain: x.sk\nEPP Status: ok').expiresAt).toBeNull();
  });
});

describe('parseRdapExpiry', () => {
  it('vytiahne expiration event, registrar a nameservery', () => {
    const out = parseRdapExpiry(RDAP_SAMPLE);
    expect(out.expiresAt).toBe('2027-08-13');
    expect(out.registrar).toBe('MarkMonitor Inc.');
    expect(out.nameservers).toEqual(['ns1.example.com', 'ns2.example.com']);
  });
  it('bez expiration eventu → null', () => {
    expect(parseRdapExpiry({ events: [] }).expiresAt).toBeNull();
  });
});

describe('fetchRdapDomain', () => {
  it('200 → parsuje a nastaví source rdap', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(RDAP_SAMPLE), { status: 200 }));
    const out = await fetchRdapDomain('example.com', fetchImpl as unknown as typeof fetch);
    expect(out.source).toBe('rdap');
    expect(out.expiresAt).toBe('2027-08-13');
  });
  it('404 → source unsupported (doména bez RDAP)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }));
    const out = await fetchRdapDomain('nic.sk', fetchImpl as unknown as typeof fetch);
    expect(out.source).toBe('unsupported');
    expect(out.expiresAt).toBeNull();
  });
  it('sieťová chyba → error vyplnený, hodnoty null (nefabrikuje 0)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('timeout');
    });
    const out = await fetchRdapDomain('example.com', fetchImpl as unknown as typeof fetch);
    expect(out.error).toContain('timeout');
    expect(out.expiresAt).toBeNull();
  });
});
