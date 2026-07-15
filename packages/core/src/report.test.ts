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
});
