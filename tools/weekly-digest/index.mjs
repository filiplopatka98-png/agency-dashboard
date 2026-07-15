#!/usr/bin/env node
// Týždenný digest — poskladá per-org prehľad z reálnych dát a pošle e-mail cez
// Resend príjemcom z notification_settings (fallback ALERT_EMAIL_TO). Rešpektuje
// prepínač weekly_digest. Ak Resend nie je nakonfigurovaný, len zaloguje.
//
// Env: RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { recordJobRun } from '../_shared/jobRun.mjs';
import { renderDigest } from '../../packages/core/dist/digest.js';

const FRESH_MAX_MS = { aeo: 216, security: 216, seo: 216, perf: 216, infra: 216, wp: 216, gsc: 264 };

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - ys) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}
const staleFor = (metric, at, now) => (at ? now - Date.parse(at) > FRESH_MAX_MS[metric] * 3_600_000 : false);
const daysLeft = (at) => (at ? Math.ceil((Date.parse(at) - Date.now()) / 86400000) : null);

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

  const now = Date.now();
  const weekLabel = isoWeek(new Date());
  const sites = await get('sites?select=id,org_id,domain,cms,maintenance,consecutive_failures&is_active=eq.true');
  const orgs = await get('organizations?select=id,name');
  const [daily, seo, wp, dom, tls, sec, aeo, perf, gsc, infra, incidents, settings] = await Promise.all([
    get('uptime_daily?select=site_id,day,uptime_pct'),
    get('seo_snapshots?select=site_id,issues,measured_at'),
    get('wp_snapshots?select=site_id,vulns,measured_at'),
    get('domains?select=site_id,expires_at'),
    get('tls_certs?select=site_id,valid_to'),
    get('security_snapshots?select=site_id,measured_at'),
    get('aeo_snapshots?select=site_id,measured_at'),
    get('perf_snapshots?select=site_id,measured_at'),
    get('gsc_snapshots?select=site_id,measured_at'),
    get('infra_snapshots?select=site_id,measured_at'),
    get('incidents?select=site_id&resolved_at=is.null'),
    get('notification_settings?select=org_id,weekly_digest,recipients'),
  ]);

  const by = (arr) => { const m = new Map(); for (const r of arr) m.set(r.site_id, r); return m; };
  const seoM = by(seo), wpM = by(wp), domM = by(dom), tlsM = by(tls), secM = by(sec), aeoM = by(aeo), perfM = by(perf), gscM = by(gsc), infraM = by(infra);
  const openInc = new Set(incidents.map((i) => i.site_id));
  const setById = new Map(settings.map((s) => [s.org_id, s]));

  // uptime 30d priemer per site
  const cutoff = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  const upAcc = new Map();
  for (const d of daily) {
    if (d.day < cutoff || d.uptime_pct == null) continue;
    const a = upAcc.get(d.site_id) ?? { sum: 0, n: 0 };
    a.sum += Number(d.uptime_pct); a.n++; upAcc.set(d.site_id, a);
  }
  const uptime30 = (id) => { const a = upAcc.get(id); return a && a.n ? a.sum / a.n : null; };

  let sent = 0, failed = 0, skipped = 0;
  for (const org of orgs) {
    const st = setById.get(org.id);
    if (st && st.weekly_digest === false) { skipped++; continue; }
    const orgSites = sites.filter((s) => s.org_id === org.id);
    if (!orgSites.length) continue;

    const digestSites = orgSites.map((s) => {
      const status = s.maintenance ? 'maintenance' : (s.consecutive_failures >= 2 || openInc.has(s.id)) ? 'down' : 'up';
      const issues = (seoM.get(s.id)?.issues ?? []);
      const vulnsArr = wpM.get(s.id)?.vulns ?? null;
      const vulns = Array.isArray(vulnsArr) ? vulnsArr.length : 0;
      const criticalVulns = Array.isArray(vulnsArr) ? vulnsArr.filter((v) => v.severity === 'critical' || v.severity === 'high').length : 0;
      const attention = [];
      const tlsD = daysLeft(tlsM.get(s.id)?.valid_to);
      if (tlsD != null && tlsD <= 45) attention.push(`TLS o ${tlsD} d`);
      const domD = daysLeft(domM.get(s.id)?.expires_at);
      if (domD != null && domD <= 45) attention.push(`doména o ${domD} d`);
      const staleCount = [
        staleFor('seo', seoM.get(s.id)?.measured_at, now), staleFor('security', secM.get(s.id)?.measured_at, now),
        staleFor('aeo', aeoM.get(s.id)?.measured_at, now), staleFor('perf', perfM.get(s.id)?.measured_at, now),
        staleFor('gsc', gscM.get(s.id)?.measured_at, now), staleFor('infra', infraM.get(s.id)?.measured_at, now),
        s.cms === 'wordpress' && staleFor('wp', wpM.get(s.id)?.measured_at, now),
      ].filter(Boolean).length;
      if (staleCount) attention.push(`${staleCount} neaktuálnych meraní`);
      return { domain: s.domain, status, uptime30: uptime30(s.id), openIssues: Array.isArray(issues) ? issues.length : 0, vulns, criticalVulns, attention };
    });

    const { subject, html, text } = renderDigest({ weekLabel, orgName: org.name ?? 'Org', sites: digestSites });
    const recipients = (st?.recipients?.length ? st.recipients : (adminTo ? [adminTo] : []));
    if (!resendReady || !recipients.length) {
      skipped++;
      console.log(JSON.stringify({ ev: 'digest.skipped', org: org.id, reason: !resendReady ? 'resend_not_ready' : 'no_recipients', sites: digestSites.length }));
      continue;
    }
    try {
      await sendEmail(resendKey, from, recipients, subject, html, text);
      sent++;
      console.log(JSON.stringify({ ev: 'digest.sent', org: org.id, to: recipients.length, sites: digestSites.length }));
    } catch (e) {
      failed++;
      console.log(JSON.stringify({ ev: 'digest.fail', org: org.id, error: String(e?.message ?? e) }));
    }
  }
  console.log(JSON.stringify({ ev: 'digest.done', sent, failed, skipped }));
  await recordJobRun(url, srv, 'digest', sent, failed);
}

main().catch((e) => { console.error(e); process.exit(1); });
