import { describe, expect, it } from 'vitest';
import { resolveSiteOrigin } from './siteOrigin';
import { extractMenuLinks } from './assetCheck';

describe('resolveSiteOrigin', () => {
  it('apex → www redirect: origin je www (tam žijú sitemap URL aj odkazy)', () => {
    expect(resolveSiteOrigin('krivosik.sk', 'https://www.krivosik.sk/')).toBe('https://www.krivosik.sk');
  });
  it('bez redirectu ostane https://<domain>', () => {
    expect(resolveSiteOrigin('lopatka.sk', 'https://lopatka.sk/')).toBe('https://lopatka.sk');
  });
  it('www → apex (doména uložená s www)', () => {
    expect(resolveSiteOrigin('www.x.sk', 'https://x.sk/')).toBe('https://x.sk');
  });
  it('cesta a query vo finálnej URL sa ignorujú', () => {
    expect(resolveSiteOrigin('bytylazovna.sk', 'https://www.bytylazovna.sk/sk/?lang=sk')).toBe('https://www.bytylazovna.sk');
  });
  it('redirect na cudziu doménu sa neprijme → https://<domain>', () => {
    expect(resolveSiteOrigin('welltis.sk', 'https://welltisgroup.sk/')).toBe('https://welltis.sk');
  });
  it('sieťová chyba / chýbajúca či nevalidná finálna URL → https://<domain>', () => {
    for (const final of [null, undefined, '', 'nie-je-url']) {
      expect(resolveSiteOrigin('x.sk', final)).toBe('https://x.sk');
    }
  });
});

describe('apex → www web (krivosik.sk)', () => {
  it('menu odkazy na www sa s rozlíšeným originom nezahodia', () => {
    const html = `<nav><a href="https://www.krivosik.sk/sluzby/">Služby</a><a href="https://www.krivosik.sk/kontakt">Kontakt</a></nav>`;
    const origin = resolveSiteOrigin('krivosik.sk', 'https://www.krivosik.sk/');
    expect(extractMenuLinks(html, origin)).toEqual(['https://www.krivosik.sk/sluzby', 'https://www.krivosik.sk/kontakt']);
  });
});
