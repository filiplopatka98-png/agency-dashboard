import { describe, it, expect } from 'vitest';
import { renderMonthlyReport, type ReportSite } from './report';

const site = (o: Partial<ReportSite>): ReportSite => ({
  domain: 'x.sk', uptime: 100, incidents: 0, openIssues: 0, vulns: 0, criticalVulns: 0, ...o,
});

describe('renderMonthlyReport', () => {
  it('predmet obsahuje mesiac', () => {
    const r = renderMonthlyReport({ monthLabel: 'Jún 2026', orgName: 'O', sites: [site({})] });
    expect(r.subject).toContain('Jún 2026');
  });

  it('najhorší uptime je hore', () => {
    const r = renderMonthlyReport({
      monthLabel: 'M', orgName: 'O',
      sites: [site({ domain: 'good.sk', uptime: 100 }), site({ domain: 'bad.sk', uptime: 97.5 })],
    });
    expect(r.text.indexOf('bad.sk')).toBeLessThan(r.text.indexOf('good.sk'));
  });

  it('agreguje incidenty a kritické CVE do súhrnu', () => {
    const r = renderMonthlyReport({
      monthLabel: 'M', orgName: 'O',
      sites: [site({ incidents: 2, criticalVulns: 1, vulns: 3 })],
    });
    expect(r.text).toContain('2 incidentov');
    expect(r.text).toContain('1 kritických CVE');
  });

  it('null uptime → „—", escapuje doménu', () => {
    const r = renderMonthlyReport({ monthLabel: 'M', orgName: 'O', sites: [site({ domain: '<x>', uptime: null })] });
    expect(r.text).toContain('—');
    expect(r.html).toContain('&lt;x&gt;');
  });

  it('zobrazuje zhoršenia (nový CVE, pokles skóre) — klientský filter sa NEaplikuje', () => {
    const r = renderMonthlyReport({
      monthLabel: 'M', orgName: 'O',
      sites: [site({
        changes: [
          { message: 'CVE-2024-1234 new (WooCommerce)', severity: 'critical' },
          { message: 'AEO 78 → 48', severity: 'warning' },
        ],
      })],
    });
    expect(r.text).toContain('CVE-2024-1234 new (WooCommerce)');
    expect(r.text).toContain('AEO 78 → 48');
    expect(r.html).toContain('CVE-2024-1234 new (WooCommerce)');
    expect(r.html).toContain('AEO 78 → 48');
  });

  it('zoraďuje zmeny podľa závažnosti — kritické/zhoršenia pred zlepšeniami', () => {
    const r = renderMonthlyReport({
      monthLabel: 'M', orgName: 'O',
      sites: [site({
        changes: [
          { message: 'WooCommerce 5.1 → 5.4', severity: 'info' },
          { message: 'AEO 48 → 78', severity: 'info' },
          { message: 'CVE-2024-1234 new (WooCommerce)', severity: 'critical' },
          { message: 'Chýbajúci title — new (3)', severity: 'warning' },
        ],
      })],
    });
    const iCritical = r.text.indexOf('CVE-2024-1234 new (WooCommerce)');
    const iWarning = r.text.indexOf('Chýbajúci title — new (3)');
    const iInfo1 = r.text.indexOf('WooCommerce 5.1 → 5.4');
    const iInfo2 = r.text.indexOf('AEO 48 → 78');
    expect(iCritical).toBeGreaterThan(-1);
    expect(iCritical).toBeLessThan(iWarning);
    expect(iWarning).toBeLessThan(iInfo1);
    expect(iWarning).toBeLessThan(iInfo2);
  });

  it('escapuje HTML v správe zmeny', () => {
    const r = renderMonthlyReport({
      monthLabel: 'M', orgName: 'O',
      sites: [site({ changes: [{ message: '<script>alert(1)</script>', severity: 'info' }] })],
    });
    expect(r.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.html).not.toContain('<script>alert(1)</script>');
  });

  it('obmedzí zoznam zmien na 12 a povie, koľko ďalších je skrytých; strop drží najzávažnejšie zmeny', () => {
    const infoChanges = Array.from({ length: 15 }, (_, i) => ({ message: `info zmena ${i}`, severity: 'info' }));
    const r = renderMonthlyReport({
      monthLabel: 'M',
      orgName: 'O',
      sites: [site({ changes: [...infoChanges, { message: 'CVE-2024-9999 new (Plugin)', severity: 'critical' }] })],
    });
    // 16 zmien spolu, cap 12 → 4 skryté, povedané nahlas (nie ticho orezané).
    expect(r.text).toContain('a ešte 4 zmeny');
    expect(r.html).toContain('a ešte 4 zmeny');
    // Kritická zmena bola posledná chronologicky (16. z 16), ale musí prežiť orezanie,
    // lebo cap triedi podľa závažnosti PRED orezaním, nie podľa poradia.
    expect(r.text).toContain('CVE-2024-9999 new (Plugin)');
    expect(r.html).toContain('CVE-2024-9999 new (Plugin)');
  });

  it('web bez zmien vyrenderuje presne ako predtým (chýbajúce aj prázdne pole)', () => {
    const withoutField = renderMonthlyReport({ monthLabel: 'M', orgName: 'O', sites: [site({})] });
    const withEmptyArray = renderMonthlyReport({ monthLabel: 'M', orgName: 'O', sites: [site({ changes: [] })] });
    expect(withoutField.html).toBe(withEmptyArray.html);
    expect(withoutField.text).toBe(withEmptyArray.text);
  });
});
