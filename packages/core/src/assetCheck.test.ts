import { describe, expect, it } from 'vitest';
import { extractStylesheets } from './assetCheck';

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
