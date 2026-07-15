import { describe, it, expect } from 'vitest';
import { renderDigest, type DigestSite } from './digest';

const site = (o: Partial<DigestSite>): DigestSite => ({
  domain: 'x.sk', status: 'up', uptime30: 100, openIssues: 0, vulns: 0, criticalVulns: 0, attention: [], ...o,
});

describe('renderDigest', () => {
  it('bez problémov → „všetko v poriadku" + bežný predmet', () => {
    const r = renderDigest({ weekLabel: '2026-W29', orgName: 'Org', sites: [site({}), site({ domain: 'y.sk' })] });
    expect(r.subject).toContain('2026-W29');
    expect(r.subject).not.toContain('⚠');
    expect(r.html).toContain('Všetko v poriadku');
  });

  it('down web → varovný predmet a zoradenie hore', () => {
    const r = renderDigest({
      weekLabel: '2026-W29', orgName: 'Org',
      sites: [site({ domain: 'ok.sk' }), site({ domain: 'down.sk', status: 'down' })],
    });
    expect(r.subject).toContain('⚠');
    expect(r.subject).toContain('1 nedostupných');
    // down.sk musí byť v texte pred ok.sk
    expect(r.text.indexOf('down.sk')).toBeLessThan(r.text.indexOf('ok.sk'));
  });

  it('escapuje HTML v doméne', () => {
    const r = renderDigest({ weekLabel: 'W', orgName: 'O', sites: [site({ domain: '<b>x</b>' })] });
    expect(r.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('kritické CVE ovplyvnia predmet a poradie', () => {
    const r = renderDigest({
      weekLabel: 'W', orgName: 'O',
      sites: [site({ domain: 'a.sk' }), site({ domain: 'b.sk', vulns: 5, criticalVulns: 2 })],
    });
    expect(r.subject).toContain('2 kritických CVE');
    expect(r.text.indexOf('b.sk')).toBeLessThan(r.text.indexOf('a.sk'));
  });
});
