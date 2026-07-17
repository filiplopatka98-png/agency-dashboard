// Týždenný digest — z reálnych dát poskladá jeden prehľadný e-mail per org.
// Čisté renderovanie (bez I/O) → testovateľné. Odosielanie rieši collector.

export interface DigestSite {
  domain: string;
  status: 'up' | 'down' | 'maintenance';
  uptime30: number | null; // %
  openIssues: number | null; // SEO issues; null = posledný seo-crawl beh zlyhal/0 stránok — nevieme, mlčíme (nie 0)
  vulns: number; // spolu CVE
  criticalVulns: number; // critical+high CVE
  attention: string[]; // expiry / neaktuálne / poklesy
}

export interface DigestChange {
  message: string;
  severity: string; // 'info' | 'warning' | 'critical'
  domain?: string | null;
}

export interface DigestData {
  weekLabel: string;
  orgName: string;
  sites: DigestSite[];
  changes?: DigestChange[]; // veľké zmeny za týždeň (change_log)
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Zoradenie: najprv weby vyžadujúce pozornosť (down > CVE > issues > attention).
function priority(s: DigestSite): number {
  let p = 0;
  if (s.status === 'down') p += 1000;
  p += s.criticalVulns * 100;
  p += s.vulns * 10;
  p += s.openIssues ?? 0; // neznáme SEO issues nezvyšujú prioritu — nefabrikujeme naliehavosť
  p += s.attention.length * 5;
  return p;
}

export function renderDigest(data: DigestData): { subject: string; html: string; text: string } {
  const sites = [...data.sites].sort((a, b) => priority(b) - priority(a));
  const down = sites.filter((s) => s.status === 'down').length;
  const totalVulns = sites.reduce((n, s) => n + s.vulns, 0);
  const totalCritical = sites.reduce((n, s) => n + s.criticalVulns, 0);
  // Súčet len zo známych hodnôt — web s neznámym SEO stavom (null) do súhrnu
  // NEPRIDÁVA 0 (to by bolo tiché tvrdenie „žiadne issues", ktoré nevieme
  // doložiť), jednoducho sa v súčte nezapočíta.
  const totalIssues = sites.reduce((n, s) => n + (s.openIssues ?? 0), 0);
  const needAttention = sites.filter((s) => priority(s) > 0).length;

  const alarmParts = [];
  if (down) alarmParts.push(`${down} nedostupných`);
  if (totalCritical) alarmParts.push(`${totalCritical} kritických CVE`);
  const subject = alarmParts.length
    ? `⚠ Monitorix týždenný prehľad — ${alarmParts.join(', ')}, ${data.weekLabel}`
    : `Monitorix týždenný prehľad — ${data.weekLabel}`;

  const summaryLine = `${sites.length} webov · ${down} nedostupných · ${totalCritical} kritických CVE · ${totalIssues} SEO issues`;

  const rows = sites
    .map((s) => {
      const badges = [];
      if (s.status === 'down') badges.push('<span style="color:#dc2626;font-weight:600">● nedostupný</span>');
      else if (s.status === 'maintenance') badges.push('<span style="color:#6b7280">● údržba</span>');
      else badges.push('<span style="color:#16a34a">● beží</span>');
      if (s.criticalVulns) badges.push(`<span style="color:#dc2626">${s.criticalVulns} kritických CVE</span>`);
      else if (s.vulns) badges.push(`<span style="color:#d97706">${s.vulns} CVE</span>`);
      if (s.openIssues) badges.push(`<span style="color:#6b7280">${s.openIssues} SEO issues</span>`);
      const att = s.attention.length ? `<div style="font-size:12px;color:#d97706;margin-top:3px">${s.attention.map(esc).join(' · ')}</div>` : '';
      const up = s.uptime30 != null ? `${s.uptime30.toFixed(2)} %` : '—';
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">
        <div style="font-weight:600;color:#111">${esc(s.domain)}</div>
        <div style="font-size:13px;color:#444;margin-top:2px">${badges.join(' &nbsp;·&nbsp; ')}</div>${att}
      </td><td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;color:#444;font-size:13px;white-space:nowrap">uptime 30d<br><b style="color:#111">${up}</b></td></tr>`;
    })
    .join('');

  const changes = data.changes ?? [];
  const changesHtml = changes.length
    ? `<div style="margin-bottom:18px">
        <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:8px">Za posledný týždeň</div>
        ${changes
          .slice(0, 12)
          .map((c) => {
            const col = c.severity === 'critical' ? '#dc2626' : c.severity === 'warning' ? '#d97706' : '#16a34a';
            const dom = c.domain ? `<span style="color:#9ca3af"> · ${esc(c.domain)}</span>` : '';
            return `<div style="font-size:13px;color:#444;padding:5px 0;border-bottom:1px solid #f3f4f6"><span style="color:${col};font-weight:700">•</span> ${esc(c.message)}${dom}</div>`;
          })
          .join('')}
      </div>`
    : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #eee">
      <div style="font-size:13px;color:#6b7280;font-weight:600;letter-spacing:.3px">MONITORIX · ${esc(data.weekLabel)}</div>
      <h1 style="font-size:20px;color:#111;margin:6px 0 4px">Týždenný prehľad</h1>
      <div style="font-size:14px;color:#444;margin-bottom:20px">${esc(summaryLine)}</div>
      ${needAttention === 0 ? '<div style="background:#f0fdf4;color:#16a34a;padding:12px 14px;border-radius:8px;font-size:14px;font-weight:600;margin-bottom:16px">✓ Všetko v poriadku — žiadny web nevyžaduje pozornosť.</div>' : ''}
      ${changesHtml}
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <div style="font-size:12px;color:#9ca3af;margin-top:22px">Automatický týždenný digest z Monitorix. Dáta sú reálne merania — nič sa neodhaduje.</div>
    </div>
  </div></body></html>`;

  const changesText = changes.length
    ? `\nZa posledný týždeň:\n${changes.slice(0, 12).map((c) => `  • ${c.message}${c.domain ? ` (${c.domain})` : ''}`).join('\n')}\n`
    : '';

  const text =
    `Monitorix týždenný prehľad — ${data.weekLabel}\n${summaryLine}\n${changesText}\n` +
    sites
      .map((s) => {
        const st = s.status === 'down' ? 'NEDOSTUPNÝ' : s.status === 'maintenance' ? 'údržba' : 'beží';
        const extra = [s.criticalVulns ? `${s.criticalVulns} krit. CVE` : s.vulns ? `${s.vulns} CVE` : '', s.openIssues ? `${s.openIssues} issues` : '', ...s.attention]
          .filter(Boolean)
          .join(', ');
        return `- ${s.domain}: ${st}${extra ? ` — ${extra}` : ''}`;
      })
      .join('\n');

  return { subject, html, text };
}
