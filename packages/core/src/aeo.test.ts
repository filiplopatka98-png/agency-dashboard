import { describe, expect, it } from 'vitest';
import { scoreAeo } from './aeo';

const GOOD_HTML = `<!doctype html><html><head>
<link rel="canonical" href="https://x.sk/">
<script type="application/ld+json">{"@type":"Organization","name":"X"}</script>
<script type="application/ld+json">{"@type":"WebSite","name":"X","author":{"@type":"Person","name":"Jozef"},"dateModified":"${new Date().toISOString()}"}</script>
<script type="application/ld+json">{"@type":"FAQPage"}</script>
</head><body>
<h1>Nadpis</h1>
<h2>Ako to funguje?</h2>
<p>Krátka priama odpoveď pod nadpisom.</p>
</body></html>`;

const ROBOTS_GOOD = `User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow:

User-agent: *
Disallow:`;

describe('scoreAeo', () => {
  it('dobrý web má vysoké skóre a všetky kľúčové checky', () => {
    const r = scoreAeo({ html: GOOD_HTML, robotsTxt: ROBOTS_GOOD, hasLlmsTxt: true });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.checks.find((c) => c.id === 'jsonld')!.pass).toBe(true);
    expect(r.checks.find((c) => c.id === 'types')!.pass).toBe(true);
    expect(r.checks.find((c) => c.id === 'faq')!.pass).toBe(true);
    expect(r.checks.find((c) => c.id === 'canonical')!.pass).toBe(true);
    expect(r.aiBots['GPTBot']).toBe('block');
    expect(r.aiBots['ClaudeBot']).toBe('allow');
    expect(r.aiBots['PerplexityBot']).toBe('unset');
    expect(r.schemaTypes).toContain('Organization');
  });

  it('prázdny web má nízke skóre a nefabrikuje', () => {
    const r = scoreAeo({ html: '<html><body><h1>a</h1><h1>b</h1></body></html>', robotsTxt: '', hasLlmsTxt: false });
    expect(r.score).toBeLessThan(30);
    expect(r.checks.find((c) => c.id === 'jsonld')!.pass).toBe(false);
    expect(r.checks.find((c) => c.id === 'headings')!.pass).toBe(false); // 2× H1
    expect(r.checks.find((c) => c.id === 'aibots')!.pass).toBe(false);
  });

  it('nevalidný JSON-LD blok sa ignoruje (nespadne)', () => {
    const r = scoreAeo({ html: '<script type="application/ld+json">{ broken</script>', robotsTxt: '', hasLlmsTxt: false });
    expect(r.checks.find((c) => c.id === 'jsonld')!.pass).toBe(false);
  });

  it('viacstránkové: FAQ na podstránke sa započíta (OR), canonical vyžaduje všetky (AND)', () => {
    const home = '<html><head><link rel="canonical" href="/"></head><body><h1>Domov</h1><h2>Q</h2><p>A</p></body></html>';
    const sluzby = '<html><head><link rel="canonical" href="/sluzby/"></head><body><h1>Služby</h1><script type="application/ld+json">{"@type":"FAQPage"}</script></body></html>';
    const r = scoreAeo({ html: [home, sluzby], robotsTxt: '', hasLlmsTxt: false });
    expect(r.checks.find((c) => c.id === 'faq')!.pass).toBe(true); // FAQ len na /sluzby → prejde
    expect(r.checks.find((c) => c.id === 'canonical')!.pass).toBe(true); // obe majú canonical
    expect(r.schemaTypes).toContain('FAQPage');

    // canonical AND: ak jedna stránka nemá canonical → check padne
    const r2 = scoreAeo({ html: [home, '<html><body><h1>X</h1></body></html>'], robotsTxt: '', hasLlmsTxt: false });
    expect(r2.checks.find((c) => c.id === 'canonical')!.pass).toBe(false);
  });
});
