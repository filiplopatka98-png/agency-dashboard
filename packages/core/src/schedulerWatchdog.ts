// Externá poistka (dead-man's switch zvonku) pre scheduler Worker — čistá
// logika; IO robí tools/scheduler-watchdog/index.mjs (GitHub Action, */15).
//
// runJobHealth beží V scheduleri, takže jeho vlastnú smrť neodhalí: keď
// Cloudflare prestane volať cron trigger (incident „Workers Cron Triggers
// degraded", 2026-09-11 13:26–14:35 UTC), nebeží uptime ani odosielanie alertov
// a nikto sa nič nedozvie. Watchdog beží nezávisle v GitHub Actions — žiadna
// nová externá služba — a keď je heartbeat schedulera (job_runs.job='scheduler')
// príliš starý, alert pošle e-mailom priamo.
// `.js` prípona je nutná: tools/scheduler-watchdog importuje priamo dist/ v Node
// ESM, ktorý import bez prípony nenájde (rovnako ako export './emailHealth.js').
import { isOverdue, JOB_SCHEDULES } from './jobSchedule.js';

// 4× 5-min interval = 20 min ticha. Jeden-dva vynechané ticky Cloudflare
// cronu sú bežné a nesmú budiť e-mailom; 4 za sebou už sú výpadok.
export const SCHEDULER_WATCHDOG_FACTOR = 4;

export interface SchedulerHeartbeat {
  stale: boolean;
  /** Minúty od posledného heartbeatu; null = žiadny/nevalidný záznam. */
  minutesSince: number | null;
}

// Žiadny heartbeat (čerstvá DB) nie je výpadok — rovnaká konvencia ako isOverdue.
export function schedulerHeartbeat(finishedAt: string | null | undefined, now: number): SchedulerHeartbeat {
  const t = finishedAt ? Date.parse(finishedAt) : NaN;
  if (Number.isNaN(t)) return { stale: false, minutesSince: null };
  return {
    stale: isOverdue(finishedAt, JOB_SCHEDULES['scheduler']!, now, SCHEDULER_WATCHDOG_FACTOR),
    minutesSince: Math.floor((now - t) / 60_000),
  };
}

// Max 1 job_overdue alert za job za deň (UTC). Zdieľa ho runJobHealth — keď
// scheduler po výpadku ožije a sám zistí, že meškal, jeho insert sa
// odfiltruje ako duplikát watchdog alertu (žiadny druhý e-mail).
export function jobOverdueDedupeKey(job: string, now: Date): string {
  return `job_overdue:${job}:${now.toISOString().slice(0, 10)}`;
}

export interface SchedulerStaleAlertRow {
  org_id: string;
  site_id: null;
  type: 'job_overdue';
  severity: 'critical';
  title: string;
  body: string;
  dedupe_key: string;
}

const utc = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

function staleBody(finishedAt: string, minutesSince: number): string {
  return (
    `Posledný beh schedulera (Cloudflare Worker, cron každých 5 min): ${utc(finishedAt)} — pred ${minutesSince} min. ` +
    'Kým nebeží, nekontroluje sa uptime webov a neodchádzajú alert e-maily. ' +
    'Najčastejšia príčina je výpadok Cloudflare Cron Triggers (https://www.cloudflarestatus.com); ' +
    'detail v Cloudflare → Workers → agency-dashboard-scheduler → Observability.'
  );
}

export function schedulerStaleAlertRows(
  orgIds: string[],
  finishedAt: string,
  minutesSince: number,
  now: Date,
): SchedulerStaleAlertRow[] {
  return orgIds.map((orgId) => ({
    org_id: orgId,
    site_id: null,
    type: 'job_overdue',
    severity: 'critical',
    title: `Scheduler nebeží ${minutesSince} min — uptime monitoring stojí`,
    body: staleBody(finishedAt, minutesSince),
    dedupe_key: jobOverdueDedupeKey('scheduler', now),
  }));
}

export function renderSchedulerStaleEmail(
  finishedAt: string,
  minutesSince: number,
): { subject: string; text: string; html: string } {
  const body = staleBody(finishedAt, minutesSince);
  return {
    subject: `Monitorix: scheduler nebeží ${minutesSince} min (uptime monitoring stojí)`,
    text: `${body}\n\n— Monitorix watchdog (GitHub Actions)`,
    html: `<p>${body}</p><p style="color:#666;font-size:13px">— Monitorix watchdog (GitHub Actions)</p>`,
  };
}
