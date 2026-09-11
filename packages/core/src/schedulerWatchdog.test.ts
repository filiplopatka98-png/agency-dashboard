import { describe, expect, it } from 'vitest';
import {
  jobOverdueDedupeKey,
  renderSchedulerStaleEmail,
  schedulerHeartbeat,
  schedulerStaleAlertRows,
} from './schedulerWatchdog';

const NOW = new Date('2026-09-11T14:36:00Z');
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe('schedulerHeartbeat', () => {
  it('heartbeat spred 19 min → ešte nie je stale (jeden-dva vynechané ticky nebudia e-mailom)', () => {
    expect(schedulerHeartbeat(minAgo(19), NOW.getTime())).toEqual({ stale: false, minutesSince: 19 });
  });
  it('heartbeat spred 21 min → stale (4+ zmeškané 5-min ticky)', () => {
    expect(schedulerHeartbeat(minAgo(21), NOW.getTime())).toEqual({ stale: true, minutesSince: 21 });
  });
  it('žiadny heartbeat (čerstvá DB) ani nevalidný dátum → nie stale, bez minút', () => {
    expect(schedulerHeartbeat(null, NOW.getTime())).toEqual({ stale: false, minutesSince: null });
    expect(schedulerHeartbeat('nie-je-datum', NOW.getTime())).toEqual({ stale: false, minutesSince: null });
  });
});

describe('jobOverdueDedupeKey', () => {
  it('max 1× za job za deň (UTC) — zdieľaný s runJobHealth, nech watchdog a scheduler neposielajú duplikát', () => {
    expect(jobOverdueDedupeKey('scheduler', NOW)).toBe('job_overdue:scheduler:2026-09-11');
  });
});

describe('schedulerStaleAlertRows', () => {
  it('critical job_overdue alert per org s kľúčom rovnakým ako runJobHealth', () => {
    const rows = schedulerStaleAlertRows(['org-1'], minAgo(70), 70, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      org_id: 'org-1',
      site_id: null,
      type: 'job_overdue',
      severity: 'critical',
      dedupe_key: 'job_overdue:scheduler:2026-09-11',
    });
    expect(rows[0]!.title).toContain('70 min');
    expect(rows[0]!.body).toContain('2026-09-11 13:26 UTC');
  });
});

describe('renderSchedulerStaleEmail', () => {
  it('predmet s dĺžkou výpadku, telo s posledným behom a odkazom na Cloudflare status', () => {
    const mail = renderSchedulerStaleEmail(minAgo(70), 70);
    expect(mail.subject).toContain('70 min');
    expect(mail.text).toContain('2026-09-11 13:26 UTC');
    expect(mail.text).toContain('https://www.cloudflarestatus.com');
    expect(mail.html).toContain('2026-09-11 13:26 UTC');
  });
});
