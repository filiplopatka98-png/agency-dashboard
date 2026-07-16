#!/usr/bin/env node
// Mesačný report — per-org súhrn za PREDCHÁDZAJÚCI kalendárny mesiac (uptime,
// incidenty) + aktuálny stav CVE/SEO. Pošle e-mail cez Resend príjemcom z
// notification_settings (fallback ALERT_EMAIL_TO). Rešpektuje monthly_report.
//
// Env: RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { recordJobRun } from '../_shared/jobRun.mjs';
import { renderMonthlyReport } from '../../packages/core/dist/report.js';
import { buildClientLines } from '../../packages/core/dist/reportText.js';
import { renderClientReport } from '../../packages/core/dist/clientReport.js';

const MONTHS = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August', 'September', 'Október', 'November', 'December'];
// „V júli" — lokál pre vigilance vetu.
const MONTHS_IN = ['V januári', 'Vo februári', 'V marci', 'V apríli', 'V máji', 'V júni', 'V júli', 'V auguste', 'V septembri', 'V októbri', 'V novembri', 'V decembri'];

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
  const periodLabel = MONTHS_IN[start.getUTCMonth()];

  const sites = await get('sites?select=id,org_id,domain,client_id&is_active=eq.true');
  const orgs = await get('organizations?select=id,name');
  const clientsList = await get('clients?select=id,org_id,name,company,report_email&status=eq.active');
  const [daily, incidents, seo, wp, settings, changeLog, workLog, resolvedIncidents] = await Promise.all([
    get(`uptime_daily?select=site_id,day,uptime_pct,checks,downtime_seconds&day=gte.${startDay}&day=lt.${endDay}`),
    get(`incidents?select=site_id,started_at&started_at=gte.${start.toISOString()}&started_at=lt.${end.toISOString()}`),
    get('seo_snapshots?select=site_id,issues'),
    get('wp_snapshots?select=site_id,vulns,plugins'),
    get('notification_settings?select=org_id,monthly_report,recipients'),
    get(`change_log?select=site_id,kind,severity,message,payload,created_at&created_at=gte.${start.toISOString()}&created_at=lt.${end.toISOString()}&order=created_at.asc`),
    get(`work_log?select=site_id,happened_at,text&happened_at=gte.${startDay}&happened_at=lt.${endDay}&order=happened_at.asc`),
    get(`incidents?select=site_id,started_at,resolved_at&started_at=gte.${start.toISOString()}&started_at=lt.${end.toISOString()}&resolved_at=not.is.null`),
  ]);

  const groupBy = (arr, key) => {
    const m = new Map();
    for (const r of arr) {
      const list = m.get(r[key]) ?? [];
      list.push(r);
      m.set(r[key], list);
    }
    return m;
  };
  const eventsBySite = groupBy(changeLog, 'site_id');
  const diaryBySite = groupBy(workLog, 'site_id');
  const resolvedBySite = groupBy(resolvedIncidents, 'site_id');

  const upAcc = new Map();
  for (const d of daily) {
    const a = upAcc.get(d.site_id) ?? { sum: 0, n: 0, checks: 0, downtime: 0 };
    if (d.uptime_pct != null) { a.sum += Number(d.uptime_pct); a.n++; }
    a.checks += Number(d.checks ?? 0);
    a.downtime += Number(d.downtime_seconds ?? 0);
    upAcc.set(d.site_id, a);
  }
  const vigilanceFor = (id) => {
    const a = upAcc.get(id);
    return { checks: a?.checks ?? 0, uptimePct: a && a.n ? a.sum / a.n : null, downtimeSeconds: a?.downtime ?? 0 };
  };
  const incCount = new Map();
  for (const i of incidents) incCount.set(i.site_id, (incCount.get(i.site_id) ?? 0) + 1);
  const seoM = new Map(seo.map((r) => [r.site_id, r]));
  const wpM = new Map(wp.map((r) => [r.site_id, r]));
  const setById = new Map(settings.map((s) => [s.org_id, s]));

  const buildSite = (s) => {
    const a = upAcc.get(s.id);
    const issues = seoM.get(s.id)?.issues ?? [];
    const vulnsArr = wpM.get(s.id)?.vulns ?? null;
    return {
      domain: s.domain,
      uptime: a && a.n ? a.sum / a.n : null,
      incidents: incCount.get(s.id) ?? 0,
      openIssues: Array.isArray(issues) ? issues.length : 0,
      vulns: Array.isArray(vulnsArr) ? vulnsArr.length : 0,
      criticalVulns: Array.isArray(vulnsArr) ? vulnsArr.filter((v) => v.severity === 'critical' || v.severity === 'high').length : 0,
    };
  };

  let sent = 0, failed = 0, skipped = 0;

  // 1) Interný agregát za org (všetky weby) → admin príjemcovia.
  for (const org of orgs) {
    const st = setById.get(org.id);
    if (st && st.monthly_report === false) { skipped++; continue; }
    const orgSites = sites.filter((s) => s.org_id === org.id);
    if (!orgSites.length) continue;
    const reportSites = orgSites.map(buildSite);
    const { subject, html, text } = renderMonthlyReport({ monthLabel, orgName: org.name ?? 'Org', sites: reportSites });
    const recipients = (st?.recipients?.length ? st.recipients : (adminTo ? [adminTo] : []));
    if (!resendReady || !recipients.length) {
      skipped++;
      console.log(JSON.stringify({ ev: 'report.skipped', scope: 'org', org: org.id, reason: !resendReady ? 'resend_not_ready' : 'no_recipients', month: monthLabel, sites: reportSites.length }));
      continue;
    }
    try {
      await sendEmail(resendKey, from, recipients, subject, html, text);
      sent++;
      console.log(JSON.stringify({ ev: 'report.sent', scope: 'org', org: org.id, to: recipients.length, month: monthLabel }));
    } catch (e) {
      failed++;
      console.log(JSON.stringify({ ev: 'report.fail', scope: 'org', org: org.id, error: String(e?.message ?? e) }));
    }
  }

  // 2) Klientsky report — len klientove weby → jeho report_email (opt-in prítomnosťou e-mailu).
  //    Gated org prepínačom monthly_report + Resend.
  for (const cl of clientsList) {
    if (!cl.report_email) continue;
    const st = setById.get(cl.org_id);
    if (st && st.monthly_report === false) continue;
    const clientSites = sites.filter((s) => s.client_id === cl.id);
    if (!clientSites.length) continue;
    const reportSites = clientSites.map((s) => {
      const wp = wpM.get(s.id);
      const vulnsArr = wp?.vulns ?? null;
      const plugins = wp?.plugins ?? null;
      return {
        domain: s.domain,
        vigilance: vigilanceFor(s.id),
        lines: buildClientLines({
          events: (eventsBySite.get(s.id) ?? []).filter((e) => e.payload).map((e) => ({
            at: e.created_at,
            ev: { kind: e.kind, severity: e.severity, message: e.message, payload: e.payload },
          })),
          diary: diaryBySite.get(s.id) ?? [],
          incidents: resolvedBySite.get(s.id) ?? [],
        }).map((l) => l.text),
        knownVulns: Array.isArray(vulnsArr) ? vulnsArr.length : null,
        // Prázdne pole pluginov je nerozlíšiteľné od zlyhaného/nedokončeného
        // skenu (wpIngest.ts vždy zapíše `plugins: body.plugins ?? []`) — preto
        // `[]` (aj non-array/chýbajúci riadok) znamená "nevieme", nie "všetko OK".
        pluginsCurrent: Array.isArray(plugins) && plugins.length > 0
          ? plugins.every((p) => !p.update_version)
          : null,
      };
    });
    const label = cl.company || cl.name || 'Klient';
    const { subject, html, text } = renderClientReport({ monthLabel, periodLabel, clientName: label, sites: reportSites });
    if (!resendReady) {
      skipped++;
      console.log(JSON.stringify({ ev: 'report.skipped', scope: 'client', client: cl.id, reason: 'resend_not_ready', month: monthLabel, sites: reportSites.length }));
      continue;
    }
    try {
      await sendEmail(resendKey, from, [cl.report_email], subject, html, text);
      sent++;
      console.log(JSON.stringify({ ev: 'report.sent', scope: 'client', client: cl.id, month: monthLabel }));
    } catch (e) {
      failed++;
      console.log(JSON.stringify({ ev: 'report.fail', scope: 'client', client: cl.id, error: String(e?.message ?? e) }));
    }
  }

  console.log(JSON.stringify({ ev: 'report.done', month: monthLabel, sent, failed, skipped }));
  await recordJobRun(url, srv, 'report', sent, failed);
}

main().catch((e) => { console.error(e); process.exit(1); });
