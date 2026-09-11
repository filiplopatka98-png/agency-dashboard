#!/usr/bin/env node
// Externá poistka pre scheduler Worker (GitHub Action, každých 15 min).
// runJobHealth beží V scheduleri, takže jeho smrť (Cloudflare prestane volať
// cron — 2026-09-11, 70 min bez uptime a bez jediného e-mailu) neodhalí.
// Watchdog pozrie posledný heartbeat schedulera (job_runs.job='scheduler');
// keď je starší než 20 min, vloží job_overdue alert (rovnaký dedupe_key ako
// runJobHealth → max 1× za deň, po zotavení žiadny duplikát) a pošle ho
// e-mailom PRIAMO cez Resend — runAlerts, ktorý alerty inak odosiela, beží
// práve v mŕtvom Workeri. Logika (prah, texty) je v core schedulerWatchdog.ts.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO
import { runJob } from '../_shared/runJob.mjs';
import {
  jobOverdueDedupeKey,
  renderSchedulerStaleEmail,
  schedulerHeartbeat,
  schedulerStaleAlertRows,
} from '../../packages/core/dist/schedulerWatchdog.js';

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');
  const now = new Date();

  const hbRes = await fetch(`${url}/rest/v1/job_runs?select=finished_at&job=eq.scheduler&order=finished_at.desc&limit=1`, { headers: restHeaders(key) });
  if (!hbRes.ok) throw new Error(`job_runs ${hbRes.status}`);
  const [last] = await hbRes.json();
  const hb = schedulerHeartbeat(last?.finished_at ?? null, now.getTime());
  if (!hb.stale) {
    console.log(JSON.stringify({ ev: 'watchdog.ok', minutes_since: hb.minutesSince }));
    return { ok: 1, failed: 0 };
  }

  const orgRes = await fetch(`${url}/rest/v1/organizations?select=id`, { headers: restHeaders(key) });
  if (!orgRes.ok) throw new Error(`organizations ${orgRes.status}`);
  const orgs = await orgRes.json();
  const rows = schedulerStaleAlertRows(orgs.map((o) => o.id), last.finished_at, hb.minutesSince, now);
  const ins = await fetch(`${url}/rest/v1/alerts?on_conflict=dedupe_key`, {
    method: 'POST',
    headers: { ...restHeaders(key), Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!ins.ok) throw new Error(`alerts insert ${ins.status}: ${(await ins.text()).slice(0, 200)}`);

  // Pošli všetko NEVYSLANÉ s dnešným kľúčom — nový alert aj ten, čo minulý
  // beh vložil, ale e-mail mu zlyhal. Už odoslaný dnes → ticho.
  const dedupeKey = jobOverdueDedupeKey('scheduler', now);
  const pendRes = await fetch(`${url}/rest/v1/alerts?select=id&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&sent_at=is.null`, { headers: restHeaders(key) });
  if (!pendRes.ok) throw new Error(`alerts select ${pendRes.status}`);
  const pending = await pendRes.json();
  if (pending.length === 0) {
    console.log(JSON.stringify({ ev: 'watchdog.already_alerted', minutes_since: hb.minutesSince }));
    return { ok: 1, failed: 0 };
  }

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  const to = (process.env.ALERT_EMAIL_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // Bez Resendu alert ostane v DB nevyslaný — pošle ho runAlerts, keď scheduler ožije.
  if (!resendKey || !resendKey.startsWith('re_') || !from || !to.length) {
    throw new Error('Resend nie je nakonfigurovaný (RESEND_API_KEY/ALERT_EMAIL_FROM/ALERT_EMAIL_TO) — alert čaká v DB');
  }
  const mail = renderSchedulerStaleEmail(last.finished_at, hb.minutesSince);
  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!sent.ok) throw new Error(`resend ${sent.status}: ${(await sent.text()).slice(0, 200)}`);

  // Označ ako odoslané, nech ho runAlerts po zotavení nepošle znova.
  const ids = pending.map((a) => a.id).join(',');
  const upd = await fetch(`${url}/rest/v1/alerts?id=in.(${ids})`, {
    method: 'PATCH',
    headers: { ...restHeaders(key), Prefer: 'return=minimal' },
    body: JSON.stringify({ sent_at: now.toISOString() }),
  });
  if (!upd.ok) console.log(JSON.stringify({ ev: 'watchdog.mark_sent_fail', status: upd.status }));
  console.log(JSON.stringify({ ev: 'watchdog.alert_sent', minutes_since: hb.minutesSince, alerts: pending.length }));
  return { ok: 1, failed: 0 };
}

async function main() {
  await runJob('scheduler-watchdog', run);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
