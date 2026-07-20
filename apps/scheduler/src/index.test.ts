import { describe, expect, it, vi } from 'vitest';
import { runTick } from './index';
import type { Env } from './env';

const env = {} as Env;

describe('runTick — odolnosť ticku (FIX 1)', () => {
  it('hodenie v skoršom kroku (runUptime) NEZABRÁNI odoslaniu alertov', async () => {
    const runAlerts = vi.fn(async () => ({ sent: 1, deferred: 0, failed: 0 }));
    const recordSchedulerRun = vi.fn(async () => {});

    await runTick(env, {
      runUptime: async () => {
        throw new Error('uptime boom');
      },
      runDomains: async () => {},
      runWpCronKick: async () => {},
      runJobHealth: async () => {},
      runAlerts,
      recordSchedulerRun,
    });

    // Aj keď runUptime hodil, drain alertov MUSÍ prebehnúť.
    expect(runAlerts).toHaveBeenCalledTimes(1);
    // Beh sa zaznamená ako error (aspoň jeden krok zlyhal) — dead-man's switch to vidí.
    expect(recordSchedulerRun).toHaveBeenCalledWith(env, 'error', expect.stringContaining('uptime boom'));
  });

  it('keď všetky kroky prejdú, zaznamená sa ok', async () => {
    const recordSchedulerRun = vi.fn(async () => {});
    await runTick(env, {
      runUptime: async () => {},
      runDomains: async () => {},
      runWpCronKick: async () => {},
      runJobHealth: async () => {},
      runAlerts: async () => ({ sent: 0, deferred: 0, failed: 0 }),
      recordSchedulerRun,
    });
    expect(recordSchedulerRun).toHaveBeenCalledWith(env, 'ok', null);
  });
});
