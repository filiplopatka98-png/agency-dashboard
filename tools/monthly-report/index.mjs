#!/usr/bin/env node
// Mesačný report — per-org súhrn za PREDCHÁDZAJÚCI kalendárny mesiac (uptime,
// incidenty) + aktuálny stav CVE/SEO. Pošle e-mail cez Resend príjemcom z
// notification_settings (fallback ALERT_EMAIL_TO). Rešpektuje monthly_report.
//
// Env: RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { recordJobRun } from '../_shared/jobRun.mjs';
import { renderMonthlyReport } from '../../packages/core/dist/report.js';

const MONTHS = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December'];

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function sendEmail(apiKey, from, to, subject, html, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');
  const H = restHeaders(srv);
  const get = async (path) => (await fetch(`${url}/rest/v1/${path}`, { headers: H })).json();

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  const adminTo = process.env.ALERT_EMAIL_TO;
  const resendReady = resendKey && resendKey.startsWith('re_') && from;

  // Predchádzajúci kalendárny mesiac [start, end).
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const startDay = start.toISOString().slice(0, 10);
  const endDay = end.toISOString().slice(0, 10);
  const monthLabel = `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;

  const sites = await get('sites?select=id,org_id,domain&is_active=eq.true');
  const orgs = await get('organizations?select=id,name');
  const [daily, incidents, seo, wp, settings] = await Promise.all([
    get(`uptime_daily?select=site_id,day,uptime_pct&day=gte.${startDay}&day=lt.${endDay}`),
    get(`incidents?select=site_id,started_at&started_at=gte.${start.toISOString()}&started_at=lt.${end.toISOString()}`),
    get('seo_snapshots?select=site_id,issues'),
    get('wp_snapshots?select=site_id,vulns'),
    get('notification_settings?select=org_id,monthly_report,recipients'),
  ]);

  const upAcc = new Map();
  for (const d of daily) {
    if (d.uptime_pct == null) continue;
    const a = upAcc.get(d.site_id) ?? { sum: 0, n: 0 };
    a.sum += Number(d.uptime_pct); a.n++; upAcc.set(d.site_id, a);
  }
  const incCount = new Map();
  for (const i of incidents) incCount.set(i.site_id, (incCount.get(i.site_id) ?? 0) + 1);
  const seoM = new Map(seo.map((r) => [r.site_id, r]));
  const wpM = new Map(wp.map((r) => [r.site_id, r]));
  const setById = new Map(settings.map((s) => [s.org_id, s]));

  let sent = 0, failed = 0, skipped = 0;
  for (const org of orgs) {
    const st = setById.get(org.id);
    if (st && st.monthly_report === false) { skipped++; continue; }
    const orgSites = sites.filter((s) => s.org_id === org.id);
    if (!orgSites.length) continue;

    const reportSites = orgSites.map((s) => {
      const a = upAcc.get(s.id);
      const issues = seoM.get(s.id)?.issues ?? [];
      const vulnsArr = wpM.get(s.id)?.vulns ?? null;
      const vulns = Array.isArray(vulnsArr) ? vulnsArr.length : 0;
      const criticalVulns = Array.isArray(vulnsArr) ? vulnsArr.filter((v) => v.severity === 'critical' || v.severity === 'high').length : 0;
      return {
        domain: s.domain,
        uptime: a && a.n ? a.sum / a.n : null,
        incidents: incCount.get(s.id) ?? 0,
        openIssues: Array.isArray(issues) ? issues.length : 0,
        vulns,
        criticalVulns,
      };
    });

    const { subject, html, text } = renderMonthlyReport({ monthLabel, orgName: org.name ?? 'Org', sites: reportSites });
    const recipients = (st?.recipients?.length ? st.recipients : (adminTo ? [adminTo] : []));
    if (!resendReady || !recipients.length) {
      skipped++;
      console.log(JSON.stringify({ ev: 'report.skipped', org: org.id, reason: !resendReady ? 'resend_not_ready' : 'no_recipients', month: monthLabel, sites: reportSites.length }));
      continue;
    }
    try {
      await sendEmail(resendKey, from, recipients, subject, html, text);
      sent++;
      console.log(JSON.stringify({ ev: 'report.sent', org: org.id, to: recipients.length, month: monthLabel }));
    } catch (e) {
      failed++;
      console.log(JSON.stringify({ ev: 'report.fail', org: org.id, error: String(e?.message ?? e) }));
    }
  }
  console.log(JSON.stringify({ ev: 'report.done', month: monthLabel, sent, failed, skipped }));
  await recordJobRun(url, srv, 'report', sent, failed);
}

main().catch((e) => { console.error(e); process.exit(1); });
