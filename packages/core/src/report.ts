// Mesačný report — súhrn za kalendárny mesiac per org. Čisté renderovanie,
// dáta z reálnych meraní (uptime, incidenty, aktuálne CVE/SEO issues).

export interface ReportSite {
  domain: string;
  uptime: number | null; // % za mesiac
  incidents: number; // počet incidentov začatých v mesiaci
  openIssues: number; // aktuálne SEO issues
  vulns: number;
  criticalVulns: number;
}

export interface ReportData {
  monthLabel: string;
  orgName: string;
  sites: ReportSite[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtUptime = (u: number | null) => (u == null ? '—' : `${u.toFixed(2)} %`);
const uptimeColor = (u: number | null) => (u == null ? '#6b7280' : u >= 99.9 ? '#16a34a' : u >= 99 ? '#d97706' : '#dc2626');

export function renderMonthlyReport(data: ReportData): { subject: string; html: string; text: string } {
  const sites = [...data.sites].sort((a, b) => (a.uptime ?? 101) - (b.uptime ?? 101)); // najhorší uptime hore
  const avgUptime =
    sites.filter((s) => s.uptime != null).reduce((n, s) => n + (s.uptime ?? 0), 0) /
    (sites.filter((s) => s.uptime != null).length || 1);
  const totalIncidents = sites.reduce((n, s) => n + s.incidents, 0);
  const totalCritical = sites.reduce((n, s) => n + s.criticalVulns, 0);

  const subject = `Monitorix mesačný report — ${data.monthLabel}`;
  const summary = `${sites.length} webov · priemerný uptime ${fmtUptime(avgUptime)} · ${totalIncidents} incidentov · ${totalCritical} kritických CVE`;

  const rows = sites
    .map((s) => {
      const extra = [];
      if (s.incidents) extra.push(`${s.incidents} incidentov`);
      if (s.criticalVulns) extra.push(`<span style="color:#dc2626">${s.criticalVulns} kritických CVE</span>`);
      else if (s.vulns) extra.push(`${s.vulns} CVE`);
      if (s.openIssues) extra.push(`${s.openIssues} SEO issues`);
      return `<tr>
        <td style="padding:11px 0;border-bottom:1px solid #eee"><div style="font-weight:600;color:#111">${esc(s.domain)}</div>${extra.length ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${extra.join(' · ')}</div>` : ''}</td>
        <td style="padding:11px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap"><b style="color:${uptimeColor(s.uptime)}">${fmtUptime(s.uptime)}</b><div style="font-size:11px;color:#9ca3af">uptime</div></td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #eee">
      <div style="font-size:13px;color:#6b7280;font-weight:600;letter-spacing:.3px">MONITORIX · MESAČNÝ REPORT</div>
      <h1 style="font-size:20px;color:#111;margin:6px 0 4px">${esc(data.monthLabel)}</h1>
      <div style="font-size:14px;color:#444;margin-bottom:20px">${esc(summary)}</div>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <div style="font-size:12px;color:#9ca3af;margin-top:22px">Automatický mesačný report z Monitorix. Uptime a incidenty za kalendárny mesiac; CVE a SEO issues sú aktuálny stav. Reálne merania — nič sa neodhaduje.</div>
    </div>
  </div></body></html>`;

  const text =
    `Monitorix mesačný report — ${data.monthLabel}\n${summary}\n\n` +
    sites
      .map((s) => {
        const extra = [s.incidents ? `${s.incidents} incid.` : '', s.criticalVulns ? `${s.criticalVulns} krit. CVE` : s.vulns ? `${s.vulns} CVE` : '', s.openIssues ? `${s.openIssues} issues` : '']
          .filter(Boolean)
          .join(', ');
        return `- ${s.domain}: uptime ${fmtUptime(s.uptime)}${extra ? ` — ${extra}` : ''}`;
      })
      .join('\n');

  return { subject, html, text };
}
