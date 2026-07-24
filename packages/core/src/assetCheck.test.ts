import { describe, expect, it } from 'vitest';
import { extractStylesheets, extractMenuLinks } from './assetCheck';

describe('extractStylesheets', () => {
  const base = 'https://x.sk/';
  it('vytiahne href zo <link rel=stylesheet> a spraví absolútne URL', () => {
    const html = `<link rel="stylesheet" href="/a.css"><link rel='stylesheet' href='https://cdn.sk/b.css'>`;
    expect(extractStylesheets(html, base)).toEqual(['https://x.sk/a.css', 'https://cdn.sk/b.css']);
  });
  it('href pred rel aj nezaškvalené rel', () => {
    const html = `<link href="/c.css" rel=stylesheet>`;
    expect(extractStylesheets(html, base)).toEqual(['https://x.sk/c.css']);
  });
  it('ignoruje ne-stylesheet <link> (icon, preconnect, canonical)', () => {
    const html = `<link rel="icon" href="/f.ico"><link rel="canonical" href="/"><link rel="preload" href="/p.css">`;
    expect(extractStylesheets(html, base)).toEqual([]);
  });
  it('deduplikuje rovnaké URL', () => {
    const html = `<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/a.css">`;
    expect(extractStylesheets(html, base)).toEqual(['https://x.sk/a.css']);
  });
  it('zachová query (?ver=) — Elementor cache-bust', () => {
    const html = `<link rel="stylesheet" href="/wp-content/uploads/elementor/css/post-12.css?ver=170">`;
    expect(extractStylesheets(html, base)).toEqual(['https://x.sk/wp-content/uploads/elementor/css/post-12.css?ver=170']);
  });
});

describe('extractMenuLinks', () => {
  const origin = 'https://x.sk';
  it('vezme interné odkazy z <nav>, max N, dedup, bez homepage/#/mailto', () => {
    const html = `
      <header><a href="/">Domov</a><nav>
        <a href="/sluzby">Služby</a><a href="/o-nas/">O nás</a>
        <a href="/sluzby">Služby dup</a><a href="mailto:a@x.sk">Mail</a>
        <a href="https://iny.sk/extern">Extern</a><a href="#top">Hore</a>
      </nav></header>`;
    expect(extractMenuLinks(html, origin, 4)).toEqual(['https://x.sk/sluzby', 'https://x.sk/o-nas']);
  });
  it('fallback: bez nav/header doplní prvými internými odkazmi z celej stránky', () => {
    const html = `<a href="/a">A</a><a href="/b">B</a><a href="https://cdn.sk/x">Ext</a>`;
    expect(extractMenuLinks(html, origin, 4)).toEqual(['https://x.sk/a', 'https://x.sk/b']);
  });
  it('reže na max', () => {
    const html = `<nav><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></nav>`;
    expect(extractMenuLinks(html, origin, 2)).toEqual(['https://x.sk/a', 'https://x.sk/b']);
  });
});
