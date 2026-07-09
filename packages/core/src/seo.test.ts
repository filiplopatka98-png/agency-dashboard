import { describe, expect, it } from 'vitest';
import { analyzePage, buildSeoIssues } from './seo';

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
