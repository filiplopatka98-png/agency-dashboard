import { describe, expect, it } from 'vitest';
import { analyzePage, buildSeoIssues, parseSitemapUrls, isBrokenStatus } from './seo';

const HTML = `<html><head>
<title>Domov — Firma</title>
<meta name="description" content="Popis stránky">
<link rel="canonical" href="https://x.sk/">
</head><body>
<h1>Vitajte</h1>
<img src="/a.jpg" alt="A"><img src="/b.jpg">
<a href="/o-nas">O nás</a>
<a href="https://x.sk/kontakt">Kontakt</a>
<a href="https://iny.sk/extern">Extern</a>
<a href="mailto:a@x.sk">mail</a>
<script src="http://cdn.old/x.js"></script>
</body></html>`;

describe('analyzePage', () => {
  const p = analyzePage(HTML, 'https://x.sk/');
  it('vytiahne title, meta, h1, canonical', () => {
    expect(p.hasTitle).toBe(true);
    expect(p.title).toBe('Domov — Firma');
    expect(p.hasMetaDesc).toBe(true);
    expect(p.h1Count).toBe(1);
    expect(p.hasCanonical).toBe(true);
  });
  it('spočíta obrázky bez alt a interné odkazy (same-origin, absolútne)', () => {
    expect(p.imagesNoAlt).toBe(1);
    expect(p.internalLinks).toContain('https://x.sk/o-nas');
    expect(p.internalLinks).toContain('https://x.sk/kontakt');
    expect(p.internalLinks).not.toContain('https://iny.sk/extern');
  });
  it('detekuje mixed content na https', () => {
    expect(p.mixedContent).toBe(1);
  });
});

describe('analyzePage — opravy správnosti', () => {
  it('mixed content NEráta obyčajný <a href=http://> ani stylesheet link je resource', () => {
    const html =
      '<html><body>' +
      '<a href="http://externy.sk/clanok">extern</a>' + // NIE mixed content
      '<img src="http://cdn.old/x.jpg">' + // mixed
      '<link rel="stylesheet" href="http://cdn.old/s.css">' + // mixed (resource)
      '</body></html>';
    const p = analyzePage(html, 'https://x.sk/');
    expect(p.mixedContent).toBe(2);
  });

  it('meta description a canonical rozpozná bez ohľadu na poradie atribútov', () => {
    const html =
      '<html><head>' +
      '<meta content="Popis" name="description">' +
      '<link href="https://x.sk/" rel="canonical">' +
      '</head><body></body></html>';
    const p = analyzePage(html, 'https://x.sk/');
    expect(p.hasMetaDesc).toBe(true);
    expect(p.hasCanonical).toBe(true);
  });

  it('alt="" (dekoratívny obrázok) sa NEráta ako chýbajúci alt', () => {
    const html = '<html><body><img src="/deco.png" alt=""><img src="/real.png"></body></html>';
    const p = analyzePage(html, 'https://x.sk/');
    expect(p.imagesNoAlt).toBe(1); // len /real.png
  });

  it('detekuje noindex z meta robots (poradie atribútov nezávislé)', () => {
    expect(analyzePage('<meta name="robots" content="noindex, nofollow">', 'https://x.sk/').noindex).toBe(true);
    expect(analyzePage('<meta content="noindex" name="robots">', 'https://x.sk/').noindex).toBe(true);
    expect(analyzePage('<meta name="robots" content="index, follow">', 'https://x.sk/').noindex).toBe(false);
    expect(analyzePage('<html></html>', 'https://x.sk/').noindex).toBe(false);
  });

  it('detekuje noindex z X-Robots-Tag hlavičky', () => {
    expect(analyzePage('<html></html>', 'https://x.sk/', 'noindex').noindex).toBe(true);
    expect(analyzePage('<html></html>', 'https://x.sk/', 'none').noindex).toBe(true);
    expect(analyzePage('<html></html>', 'https://x.sk/', 'all').noindex).toBe(false);
  });
});

describe('buildSeoIssues — opravy správnosti', () => {
  it('chýbajúci title je samostatné issue (nezmiešané s meta description)', () => {
    const pages = [analyzePage('<html><head></head><body><h1>a</h1></body></html>', 'https://x.sk/bad')];
    const issues = buildSeoIssues(pages, []);
    const titleIssue = issues.find((i) => i.type.toLowerCase().includes('title') && !i.type.toLowerCase().includes('duplic'));
    const descIssue = issues.find((i) => i.type.toLowerCase().includes('meta description'));
    expect(titleIssue).toBeTruthy();
    expect(descIssue).toBeTruthy();
    expect(titleIssue!.type).not.toContain('meta description');
  });

  it('noindex stránka → critical issue', () => {
    const pages = [analyzePage('<meta name="robots" content="noindex"><title>t</title><h1>h</h1>', 'https://x.sk/tajne')];
    const issues = buildSeoIssues(pages, []);
    const ni = issues.find((i) => i.type.toLowerCase().includes('noindex'));
    expect(ni).toBeTruthy();
    expect(ni!.severity).toBe('critical');
  });
});

describe('isBrokenStatus', () => {
  it('4xx/5xx sú broken, 0 (timeout) je broken', () => {
    expect(isBrokenStatus(404)).toBe(true);
    expect(isBrokenStatus(500)).toBe(true);
    expect(isBrokenStatus(0)).toBe(true);
  });
  it('anti-bot / auth kódy (401/403/429) NIE sú broken', () => {
    expect(isBrokenStatus(401)).toBe(false);
    expect(isBrokenStatus(403)).toBe(false);
    expect(isBrokenStatus(429)).toBe(false);
  });
  it('2xx/3xx nie sú broken', () => {
    expect(isBrokenStatus(200)).toBe(false);
    expect(isBrokenStatus(301)).toBe(false);
  });
});

describe('parseSitemapUrls', () => {
  it('vytiahne <loc> URL z urlset sitemap', () => {
    const xml =
      '<?xml version="1.0"?><urlset><url><loc>https://x.sk/</loc></url>' +
      '<url><loc>https://x.sk/o-nas</loc></url></urlset>';
    expect(parseSitemapUrls(xml)).toEqual(['https://x.sk/', 'https://x.sk/o-nas']);
  });
  it('prázdny/nevalidný vstup → prázdne pole', () => {
    expect(parseSitemapUrls('')).toEqual([]);
    expect(parseSitemapUrls('<html>nic</html>')).toEqual([]);
  });
});

describe('buildSeoIssues', () => {
  it('agreguje broken links, chýbajúci title, alt, viac H1, mixed content', () => {
    const pages = [
      analyzePage('<html><head></head><body><h1>a</h1><h1>b</h1><img src="x"></body></html>', 'https://x.sk/bad'),
      analyzePage(HTML, 'https://x.sk/'),
    ];
    const issues = buildSeoIssues(pages, [{ url: 'https://x.sk/dead', status: 404 }]);
    const types = issues.map((i) => i.type);
    expect(types.some((t) => t.includes('Nefunkčné'))).toBe(true);
    expect(types.some((t) => t.includes('title'))).toBe(true);
    expect(types.some((t) => t.includes('alt'))).toBe(true);
    expect(types.some((t) => t.includes('H1'))).toBe(true);
    expect(types.some((t) => t.includes('Mixed'))).toBe(true);
  });
});
