import { describe, it, expect } from 'vitest';
import { renderClientReport, type ClientReportSite } from './clientReport';

const site = (o: Partial<ClientReportSite>): ClientReportSite => ({
  domain: 'x.sk',
  vigilance: { checks: 8640, uptimePct: 100, downtimeSeconds: 0 },
  lines: [],
  knownVulns: 0,
  pluginsCurrent: true,
  ...o,
});

describe('renderClientReport', () => {
  it('predmet obsahuje mesiac a meno klienta', () => {
    const r = renderClientReport({ monthLabel: 'Júl 2026', periodLabel: 'V júli', clientName: 'Krivošík', sites: [site({})] });
    expect(r.subject).toContain('Júl 2026');
    expect(r.html).toContain('Krivošík');
  });

  it('tichý web → rámcuje ticho ako dohľad, nie prázdno (bez duplicity kontrol/dostupnosti)', () => {
    const r = renderClientReport({ monthLabel: 'M', periodLabel: 'V júli', clientName: 'K', sites: [site({})] });
    // Vigilance riadok povie kontroly + dostupnosť presne raz...
    expect(r.text).toContain('V júli sme spravili 8 640 kontrol dostupnosti. Web bol dostupný 100 % času.');
    // ...a quiet riadok k tomu pridá LEN bezpečnostné fakty, nie tie isté čísla znova.
    expect(r.text).toContain('Stabilne bez problémov — žiadne známe zraniteľnosti, všetky pluginy aktuálne.');
    expect(r.text.match(/kontrol/g)?.length).toBe(1);
    expect(r.text.match(/dostupný/g)?.length).toBe(1);
  });

  it('tichý web bez overených údajov o zabezpečení nič nedodáva navyše (vigilance riadok stačí)', () => {
    const r = renderClientReport({ monthLabel: 'M', periodLabel: 'V júli', clientName: 'K', sites: [site({ knownVulns: null, pluginsCurrent: null })] });
    expect(r.text).toContain('V júli sme spravili 8 640 kontrol dostupnosti. Web bol dostupný 100 % času.');
    expect(r.text).not.toContain('Stabilne bez problémov');
    expect(r.text).not.toContain('žiadne známe zraniteľnosti');
    expect(r.text).not.toContain('všetky pluginy aktuálne');
  });

  it('web s udalosťami ich vypíše', () => {
    const r = renderClientReport({ monthLabel: 'M', periodLabel: 'V júli', clientName: 'K', sites: [site({ lines: ['WooCommerce bol aktualizovaný na verziu 5.4.'] })] });
    expect(r.text).toContain('WooCommerce bol aktualizovaný na verziu 5.4.');
    expect(r.text).not.toContain('Stabilne bez problémov');
  });

  it('escapuje HTML v doméne aj v riadkoch', () => {
    const r = renderClientReport({ monthLabel: 'M', periodLabel: 'V júli', clientName: 'K', sites: [site({ domain: '<b>x</b>', lines: ['<script>'] })] });
    expect(r.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(r.html).toContain('&lt;script&gt;');
  });

  it('vigilance veta je v reporte', () => {
    const r = renderClientReport({ monthLabel: 'M', periodLabel: 'V júli', clientName: 'K', sites: [site({})] });
    expect(r.text).toContain('8 640 kontrol dostupnosti');
  });

  it('web bez meraní (0 kontrol) netvrdí stabilitu, priznáva chýbajúce merania', () => {
    const r = renderClientReport({
      monthLabel: 'Jún 2026',
      periodLabel: 'V júni',
      clientName: 'K',
      sites: [site({ domain: 'natur-life.sk', vigilance: { checks: 0, uptimePct: null, downtimeSeconds: 0 } })],
    });
    expect(r.text).not.toContain('Stabilne bez problémov');
    expect(r.html).not.toContain('Stabilne bez problémov');
    expect(r.text).toContain('Za toto obdobie nemáme merania dostupnosti.');
    expect(r.html).toContain('Za toto obdobie nemáme merania dostupnosti.');
    expect(r.text).not.toContain('0 kontrol');
  });

  it('web bez meraní ale so známymi bezpečnostnými faktami ich uvedie bez tvrdenia o stabilite', () => {
    const r = renderClientReport({
      monthLabel: 'M',
      periodLabel: 'V júni',
      clientName: 'K',
      sites: [
        site({
          vigilance: { checks: 0, uptimePct: null, downtimeSeconds: 0 },
          knownVulns: 0,
          pluginsCurrent: true,
        }),
      ],
    });
    expect(r.text).not.toContain('Stabilne bez problémov');
    expect(r.html).not.toContain('Stabilne bez problémov');
    expect(r.text).toContain('žiadne známe zraniteľnosti');
    expect(r.text).toContain('všetky pluginy aktuálne');
  });

  it('web s meraným výpadkom netvrdí stabilitu, ale bezpečnostné fakty uvedie (nekontradikcia s vigilance riadkom)', () => {
    const r = renderClientReport({
      monthLabel: 'Júl 2026',
      periodLabel: 'V júli',
      clientName: 'K',
      sites: [
        site({
          vigilance: { checks: 8640, uptimePct: 99.94, downtimeSeconds: 300 },
          knownVulns: 0,
          pluginsCurrent: true,
        }),
      ],
    });
    expect(r.text).toContain('celkový výpadok 5 minút');
    expect(r.text).not.toContain('Stabilne bez problémov');
    expect(r.html).not.toContain('Stabilne bez problémov');
    expect(r.text).toContain('Zo zabezpečenia vieme: žiadne známe zraniteľnosti, všetky pluginy aktuálne.');
  });

  it('web bez meraní a bez známych bezpečnostných faktov netvrdí nič naviac', () => {
    const r = renderClientReport({
      monthLabel: 'M',
      periodLabel: 'V júni',
      clientName: 'K',
      sites: [
        site({
          vigilance: { checks: 0, uptimePct: null, downtimeSeconds: 0 },
          knownVulns: null,
          pluginsCurrent: null,
        }),
      ],
    });
    expect(r.text).not.toContain('Stabilne bez problémov');
    expect(r.text).not.toContain('žiadne známe zraniteľnosti');
    expect(r.text).not.toContain('všetky pluginy aktuálne');
  });
});
