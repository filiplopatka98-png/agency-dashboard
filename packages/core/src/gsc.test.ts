import { describe, expect, it } from 'vitest';
import { gscPropertyCandidates, parseGscResponse } from './gsc';

describe('gscPropertyCandidates', () => {
  it('domain → apex → www, deduplikované', () => {
    expect(gscPropertyCandidates('https://www.lopatka.sk/blog')).toEqual([
      'sc-domain:lopatka.sk',
      'https://lopatka.sk/',
      'https://www.lopatka.sk/',
    ]);
  });

  it('zvládne holý host bez schémy', () => {
    expect(gscPropertyCandidates('krivosik.sk')).toEqual([
      'sc-domain:krivosik.sk',
      'https://krivosik.sk/',
      'https://www.krivosik.sk/',
    ]);
  });
});

describe('parseGscResponse', () => {
  it('zoradí dopyty podľa kliknutí a odreže na topN', () => {
    const queries = [
      { keys: ['a'], clicks: 2, impressions: 100, ctr: 0.02, position: 5 },
      { keys: ['b'], clicks: 9, impressions: 50, ctr: 0.18, position: 3 },
      { keys: ['c'], clicks: 9, impressions: 80, ctr: 0.11, position: 4 },
    ];
    const r = parseGscResponse([{ clicks: 20, impressions: 230, ctr: 0.087, position: 4.1 }], queries, 2);
    expect(r.clicks).toBe(20);
    expect(r.topQueries.map((q) => q.query)).toEqual(['c', 'b']); // 9/80 pred 9/50 (tie-break impresie), potom a
    expect(r.topQueries).toHaveLength(2);
  });

  it('prázdne totals → nuly, prázdny zoznam', () => {
    const r = parseGscResponse([], []);
    expect(r).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0, topQueries: [] });
  });
});
