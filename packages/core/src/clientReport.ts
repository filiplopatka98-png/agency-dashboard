// Klientsky mesačný report — len jeho weby, len pozitívne/neutrálne (filtrovanie
// zaisťuje buildClientLines). Tichý web nerámujeme ako prázdno, ale ako dôkaz
// dohľadu. Tvrdíme len to, čo vieme: knownVulns/pluginsCurrent === null → mlčíme.

import { renderVigilance, fmtNum, fmtPct, type Vigilance } from './reportText.js';

export interface ClientReportSite {
  domain: string;
  vigilance: Vigilance;
  lines: string[]; // už vyrenderované klientske vety, chronologicky
  knownVulns: number | null; // null = nevieme (agent nenainštalovaný)
  pluginsCurrent: boolean | null; // null = nevieme
}

export interface ClientReportData {
  monthLabel: string; // „Júl 2026"
  periodLabel: string; // „V júli"
  clientName: string;
  sites: ClientReportSite[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Veta pre web, na ktorom sa nič nedialo — bez tvrdení, ktoré nevieme doložiť.
function quietLine(s: ClientReportSite): string {
  const parts = [`${fmtNum(s.vigilance.checks)} kontrol`];
  if (s.vigilance.uptimePct !== null) parts.push(`${fmtPct(s.vigilance.uptimePct)} % dostupnosť`);
  if (s.knownVulns === 0) parts.push('žiadne známe zraniteľnosti');
  if (s.pluginsCurrent === true) parts.push('všetky pluginy aktuálne');
  return `Stabilne bez problémov — ${parts.join(', ')}.`;
}

export function renderClientReport(data: ClientReportData): { subject: string; html: string; text: string } {
  const subject = `Váš web v skratke — ${data.monthLabel}`;

  const siteHtml = data.sites
    .map((s) => {
      const body = s.lines.length
        ? `<ul style="margin:8px 0 0;padding-left:18px;color:#444;font-size:14px;line-height:1.7">${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
        : `<div style="margin-top:8px;color:#16a34a;font-size:14px">${esc(quietLine(s))}</div>`;
      return `<div style="padding:16px 0;border-bottom:1px solid #eee">
        <div style="font-weight:700;color:#111;font-size:15px">${esc(s.domain)}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:3px">${esc(renderVigilance(s.vigilance, data.periodLabel))}</div>
        ${body}
      </div>`;
    })
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #eee">
      <div style="font-size:13px;color:#6b7280;font-weight:600;letter-spacing:.3px">MONITORIX · ${esc(data.monthLabel)}</div>
      <h1 style="font-size:20px;color:#111;margin:6px 0 4px">Váš web v skratke</h1>
      <div style="font-size:14px;color:#444;margin-bottom:8px">${esc(data.clientName)}</div>
      ${siteHtml}
      <div style="font-size:12px;color:#9ca3af;margin-top:22px">Automatický mesačný prehľad z Monitorix. Všetko sú reálne merania — nič sa neodhaduje.</div>
    </div>
  </div></body></html>`;

  const text =
    `Váš web v skratke — ${data.monthLabel}\n${data.clientName}\n\n` +
    data.sites
      .map((s) => {
        const head = `${s.domain}\n${renderVigilance(s.vigilance, data.periodLabel)}`;
        const body = s.lines.length ? s.lines.map((l) => `  • ${l}`).join('\n') : `  ${quietLine(s)}`;
        return `${head}\n${body}`;
      })
      .join('\n\n');

  return { subject, html, text };
}
