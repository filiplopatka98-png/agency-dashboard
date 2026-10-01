import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MONITOR_CRON, UPKEEP_CRON, runTick, runUpkeep, tickKind } from './index';
import type { Env } from './env';

const env = {} as Env;

describe('tickKind — dva crony, každý pod 10 ms CPU / 50 subrequestov (Workers Free)', () => {
  it('upkeep cron → upkeep, monitor cron → monitor', () => {
    expect(tickKind(UPKEEP_CRON)).toBe('upkeep');
    expect(tickKind(MONITOR_CRON)).toBe('monitor');
  });
  it('neznámy cron (napr. ručný test trigger) → monitor — kritický tick radšej navyše než vôbec', () => {
    expect(tickKind('0 0 * * *')).toBe('monitor');
  });
  it('wrangler.jsonc registruje presne crony, s ktorými počíta kód', () => {
    const cfg = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    expect(cfg).toContain(`"${MONITOR_CRON}"`);
    expect(cfg).toContain(`"${UPKEEP_CRON}"`);
  });
});

describe('runTick (monitor: uptime + job_health + alerty) — odolnosť (FIX 1)', () => {
  it('hodenie v runUptime NEZABRÁNI job_health ani odoslaniu alertov', async () => {
    const runJobHealth = vi.fn(async () => {});
    const runAlerts = vi.fn(async () => ({ sent: 1, deferred: 0, failed: 0 }));
    const recordRun = vi.fn(async () => {});

    await runTick(env, {
      runUptime: async () => {
        throw new Error('uptime boom');
      },
      runJobHealth,
      runAlerts,
      recordRun,
    });

    expect(runJobHealth).toHaveBeenCalledTimes(1);
    expect(runAlerts).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledWith(env, 'scheduler', 'error', expect.stringContaining('uptime boom'));
  });

  it('keď všetky kroky prejdú, zaznamená sa scheduler ok', async () => {
    const recordRun = vi.fn(async () => {});
    await runTick(env, {
      runUptime: async () => {},
      runJobHealth: async () => {},
      runAlerts: async () => ({ sent: 0, deferred: 0, failed: 0 }),
      recordRun,
    });
    expect(recordRun).toHaveBeenCalledWith(env, 'scheduler', 'ok', null);
  });
});

describe('runUpkeep (domény + wp-cron + e-mail health) — odolnosť', () => {
  it('hodenie v runDomains NEZABRÁNI wp-cron kicku ani e-mail health; zapíše scheduler-upkeep error', async () => {
    const runWpCronKick = vi.fn(async () => {});
    const runEmailHealth = vi.fn(async () => {});
    const recordRun = vi.fn(async () => {});

    await runUpkeep(env, {
      runDomains: async () => {
        throw new Error('domains boom');
      },
      runWpCronKick,
      runEmailHealth,
      recordRun,
    });

    expect(runWpCronKick).toHaveBeenCalledTimes(1);
    expect(runEmailHealth).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledWith(env, 'scheduler-upkeep', 'error', expect.stringContaining('domains boom'));
  });

  it('keď všetky kroky prejdú, zaznamená sa scheduler-upkeep ok', async () => {
    const recordRun = vi.fn(async () => {});
    await runUpkeep(env, {
      runDomains: async () => {},
      runWpCronKick: async () => {},
      runEmailHealth: async () => {},
      recordRun,
    });
    expect(recordRun).toHaveBeenCalledWith(env, 'scheduler-upkeep', 'ok', null);
  });
});

describe('štartovací záznam (poistka proti tichému zlyhaniu, alert 2026-09-05)', () => {
  it('monitor zapíše štart PRED prvým krokom, heartbeat až na konci', async () => {
    const order: string[] = [];
    await runTick(env, {
      markStart: async (_e, job) => void order.push(`start:${job}`),
      runUptime: async () => void order.push('uptime'),
      runJobHealth: async () => void order.push('job_health'),
      runAlerts: async () => void order.push('alerts'),
      recordRun: async (_e, job) => void order.push(`end:${job}`),
    });
    expect(order).toEqual(['start:scheduler', 'uptime', 'job_health', 'alerts', 'end:scheduler']);
  });

  it('upkeep zapíše štart pod vlastným jobom', async () => {
    const markStart = vi.fn(async () => {});
    await runUpkeep(env, {
      markStart,
      runDomains: async () => {},
      runWpCronKick: async () => {},
      runEmailHealth: async () => {},
      recordRun: async () => {},
    });
    expect(markStart).toHaveBeenCalledWith(env, 'scheduler-upkeep');
  });

  it('zlyhanie default zápisu štartu (bez DB) nezhodí tick — alerty aj heartbeat prebehnú', async () => {
    const runAlerts = vi.fn(async () => ({ sent: 0, deferred: 0, failed: 0 }));
    const recordRun = vi.fn(async () => {});
    // env bez SUPABASE_URL → createClient hodí; markStart to musí zhltnúť
    await runTick(env, { runUptime: async () => {}, runJobHealth: async () => {}, runAlerts, recordRun });
    expect(runAlerts).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledWith(env, 'scheduler', 'ok', null);
  });
});
