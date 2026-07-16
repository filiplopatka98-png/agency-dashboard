import { describe, it, expect } from 'vitest';
import { isClientVisible, renderClient, renderIncident, renderVigilance, buildClientLines } from './reportText';
import type { ChangeEvent } from './events';

const ev = (o: Partial<ChangeEvent>): ChangeEvent => ({ kind: 'update', severity: 'info', message: 'm', payload: { target: 'plugin', name: 'WooCommerce', slug: 'woocommerce', from: '5.1', to: '5.4' }, ...o } as ChangeEvent);

describe('isClientVisible — test dôvery', () => {
  it('update vidí klient', () => {
    expect(isClientVisible(ev({}))).toBe(true);
  });
  it('opravená CVE áno, nová NIE', () => {
    expect(isClientVisible(ev({ kind: 'cve', payload: { direction: 'fixed', cve: 'CVE-1', target: 'X', severity: 'high' } }))).toBe(true);
    expect(isClientVisible(ev({ kind: 'cve', payload: { direction: 'new', cve: 'CVE-1', target: 'X', severity: 'high' } }))).toBe(false);
  });
  it('opravené SEO áno, nové NIE', () => {
    expect(isClientVisible(ev({ kind: 'seo', payload: { direction: 'fixed', type: 'T', was_count: 2 } }))).toBe(true);
    expect(isClientVisible(ev({ kind: 'seo', payload: { direction: 'new', type: 'T', was_count: 2 } }))).toBe(false);
  });
  it('zlepšenie skóre áno, zhoršenie NIE', () => {
    expect(isClientVisible(ev({ kind: 'score', payload: { metric: 'aeo', from: 48, to: 78, direction: 'up' } }))).toBe(true);
    expect(isClientVisible(ev({ kind: 'score', payload: { metric: 'aeo', from: 78, to: 48, direction: 'down' } }))).toBe(false);
  });
});

describe('renderClient', () => {
  it('update pluginu — vecný hlas, bez žargónu', () => {
    expect(renderClient(ev({}))).toBe('WooCommerce bol aktualizovaný na verziu 5.4.');
  });
  it('update jadra', () => {
    expect(renderClient(ev({ payload: { target: 'core', name: 'WordPress', slug: 'wordpress', from: '6.4', to: '6.5' } }))).toBe('WordPress bol aktualizovaný na verziu 6.5.');
  });
  it('opravená CVE — bez CVE identifikátora, so závažnosťou po slovensky', () => {
    const out = renderClient(ev({ kind: 'cve', payload: { direction: 'fixed', cve: 'CVE-2024-1', target: 'WooCommerce', severity: 'high' } }));
    expect(out).toBe('Odstránená bezpečnostná zraniteľnosť vysokej závažnosti v module WooCommerce.');
    expect(out).not.toContain('CVE');
  });
  it('opravené SEO — technický typ preložený', () => {
    expect(renderClient(ev({ kind: 'seo', payload: { direction: 'fixed', type: 'Chýbajúci canonical', was_count: 12 } })))
      .toBe('Opravené: chýbajúce označenie hlavnej verzie stránky — na 12 stránkach.');
  });
  it('neznámy SEO typ → fallback na pôvodný text (nespadne, nevymýšľa)', () => {
    expect(renderClient(ev({ kind: 'seo', payload: { direction: 'fixed', type: 'Nový typ XY', was_count: 1 } })))
      .toBe('Opravené: Nový typ XY — na 1 stránke.');
  });
  it('zlepšenie skóre — správny slovenský rod', () => {
    expect(renderClient(ev({ kind: 'score', payload: { metric: 'aeo', from: 48, to: 78, direction: 'up' } })))
      .toBe('Pripravenosť webu pre AI vyhľadávače sa zlepšila zo 48 na 78 bodov.');
    expect(renderClient(ev({ kind: 'score', payload: { metric: 'security', from: 70, to: 90, direction: 'up' } })))
      .toBe('Bezpečnostné nastavenia sa zlepšili zo 70 na 90 bodov.');
  });
  it('neznáma metrika → fallback', () => {
    expect(renderClient(ev({ kind: 'score', payload: { metric: 'xy', from: 1, to: 2, direction: 'up' } }))).toContain('xy');
  });

  // renderClient je audience-agnostic — musí byť pravdivý aj v smere 'new'/'down',
  // hoci buildClientLines/isClientVisible tieto smery klientovi nikdy nezobrazí.
  it('nová CVE — pravdivá veta, netvrdí odstránenie', () => {
    const out = renderClient(ev({ kind: 'cve', payload: { direction: 'new', cve: 'CVE-2024-1', target: 'WooCommerce', severity: 'high' } }));
    expect(out).toBe('Zistená nová bezpečnostná zraniteľnosť vysokej závažnosti v module WooCommerce.');
    expect(out).not.toContain('Odstránená');
  });
  it('nová CVE — neznáma závažnosť → fallback bez závažnosti', () => {
    const out = renderClient(ev({ kind: 'cve', payload: { direction: 'new', cve: 'CVE-2024-2', target: 'WooCommerce', severity: 'unknown' } }));
    expect(out).toBe('Zistená nová bezpečnostná zraniteľnosť v module WooCommerce.');
  });
  it('nové SEO — pravdivá veta, netvrdí opravu', () => {
    expect(renderClient(ev({ kind: 'seo', payload: { direction: 'new', type: 'Chýbajúci canonical', was_count: 3 } })))
      .toBe('Zistené: chýbajúce označenie hlavnej verzie stránky — na 3 stránkach.');
  });
  it('zhoršenie skóre — správny slovenský rod, netvrdí zlepšenie', () => {
    expect(renderClient(ev({ kind: 'score', payload: { metric: 'aeo', from: 78, to: 48, direction: 'down' } })))
      .toBe('Pripravenosť webu pre AI vyhľadávače sa zhoršila zo 78 na 48 bodov.');
    expect(renderClient(ev({ kind: 'score', payload: { metric: 'security', from: 90, to: 70, direction: 'down' } })))
      .toBe('Bezpečnostné nastavenia sa zhoršili zo 90 na 70 bodov.');
  });
  it('zhoršenie neznámej metriky → fallback', () => {
    expect(renderClient(ev({ kind: 'score', payload: { metric: 'xy', from: 2, to: 1, direction: 'down' } })))
      .toBe('xy: zhoršenie zo 2 na 1 bodov.');
  });
});

describe('renderIncident', () => {
  it('netvrdí, že sme to opravili — len že sme zachytili', () => {
    const out = renderIncident('2026-07-03T12:12:00Z', '2026-07-03T12:24:00Z');
    expect(out).toContain('Zachytili sme');
    expect(out).toContain('12 minút');
    expect(out).not.toContain('vyriešili sme');
  });
});

describe('renderVigilance', () => {
  it('reálne čísla, bez výpadku', () => {
    expect(renderVigilance({ checks: 8640, uptimePct: 100, downtimeSeconds: 0 }, 'V júli'))
      .toBe('V júli sme spravili 8 640 kontrol dostupnosti. Web bol dostupný 100 % času.');
  });
  it('s výpadkom pripojí trvanie', () => {
    expect(renderVigilance({ checks: 8640, uptimePct: 99.98, downtimeSeconds: 240 }, 'V júli'))
      .toBe('V júli sme spravili 8 640 kontrol dostupnosti. Web bol dostupný 99,98 % času, celkový výpadok 4 minúty.');
  });
});

describe('buildClientLines', () => {
  it('zlúči a zoradí chronologicky, zhoršenia vypustí', () => {
    const lines = buildClientLines({
      events: [
        { at: '2026-07-10T10:00:00Z', ev: ev({}) },
        { at: '2026-07-02T10:00:00Z', ev: ev({ kind: 'score', payload: { metric: 'aeo', from: 78, to: 48, direction: 'down' } }) },
      ],
      diary: [{ happened_at: '2026-07-05', text: 'Optimalizovali sme obrázky.' }],
      incidents: [{ started_at: '2026-07-03T12:12:00Z', resolved_at: '2026-07-03T12:24:00Z' }],
    });
    expect(lines.map((l) => l.text)).toEqual([
      'Zachytili sme krátky výpadok 3. 7. o 14:12, trval 12 minút.',
      'Optimalizovali sme obrázky.',
      'WooCommerce bol aktualizovaný na verziu 5.4.',
    ]);
  });
});
