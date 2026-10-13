import { describe, expect, it } from 'vitest';
import type { CheckResult, SiteForCheck } from '@agency/shared';
import type { UptimeProvider } from '@agency/core';
import { runUptime } from './runUptime';
import { UPTIME_LANES } from './uptimeBatch';
import { fakeSupabase, type FakeStore } from './fakeSupabase';
import type { Env } from './env';

const env = {} as Env;
const ORG = 'org-1';
const T0 = Date.parse('2026-10-13T10:00:00Z');
const FIVE = 5 * 60_000;

const siteId = (i: number) => `site-${String(i).padStart(2, '0')}`;

function storeWith(n: number): FakeStore {
  return {
    alerts: [],
    job_runs: [],
    organizations: [{ id: ORG }],
    change_log: [],
    incidents: [],
    sites: Array.from({ length: n }, (_, i) => ({
      id: siteId(i),
      org_id: ORG,
      url: `https://web${String(i).padStart(2, '0')}.sk`,
      is_active: true,
      consecutive_failures: 0,
    })),
  };
}

/** Provider podľa funkcie „je web hore?" + záznam, ktoré weby sa pingli. */
function provider(isUp: (id: string) => boolean, pinged: string[]): UptimeProvider {
  return {
    async checkAll(sites: SiteForCheck[]): Promise<CheckResult[]> {
      return sites.map((s) => {
        pinged.push(s.id);
        return isUp(s.id) ? { siteId: s.id, ok: true, statusCode: 200 } : { siteId: s.id, ok: false, statusCode: 503 };
      });
    },
  };
}

/** Všetky uptime spustenia (3 lanes, posun o minútu) v `rounds` 5-min oknách. */
async function runRounds(store: FakeStore, rounds: number, isUp: (id: string, at: number) => boolean, startRound = 0) {
  const log: { at: number; lane: number; pinged: string[] }[] = [];
  for (let r = startRound; r < startRound + rounds; r++) {
    for (let lane = 0; lane < UPTIME_LANES; lane++) {
      const at = T0 + r * FIVE + lane * 60_000;
      const pinged: string[] = [];
      await runUptime(env, {
        supabase: fakeSupabase(store, () => new Date(at)),
        batch: { lane, scheduledTime: at },
        provider: provider((id) => isUp(id, at), pinged),
        now: new Date(at),
      });
      log.push({ at, lane, pinged });
    }
  }
  return log;
}

const openIncidents = (store: FakeStore) => store.incidents!.filter((i) => i.resolved_at == null).map((i) => i.site_id);
const alertsOf = (store: FakeStore, type: string) => store.alerts.filter((a) => a.type === type).map((a) => a.site_id);

describe('runUptime s dávkami — incidenty sa menia LEN výsledkom vlastnej dávky', () => {
  it('11 webov: každý web práve raz za 5-min okno, všetky 3 lanes spolu = celá flotila', async () => {
    const store = storeWith(11);
    const log = await runRounds(store, 1, () => true);
    expect(log.map((l) => l.pinged.length)).toEqual([4, 4, 3]);
    expect(new Set(log.flatMap((l) => l.pinged)).size).toBe(11);
  });

  it('padnutý web: incident sa otvorí po 2. vlastnej kontrole (5–10 min ako dnes), raz; ostatné nič', async () => {
    const store = storeWith(11);
    const down = siteId(4);
    const log = await runRounds(store, 3, (id) => id !== down);

    expect(openIncidents(store)).toEqual([down]);
    expect(alertsOf(store, 'site_down')).toEqual([down]);
    // Otvoril ho tick, ktorý web reálne pingol (2. kontrola), nie iná dávka.
    const checks = log.filter((l) => l.pinged.includes(down));
    expect(checks).toHaveLength(3);
    expect(checks[1]!.at - checks[0]!.at).toBe(FIVE);
  });

  it('otvorený incident webu mimo dávky ostane otvorený; zavrie ho až jeho vlastná úspešná kontrola', async () => {
    const store = storeWith(11);
    const target = siteId(7);
    store.sites!.find((s) => s.id === target)!.consecutive_failures = 3;
    store.incidents!.push({ id: 'inc-1', site_id: target, org_id: ORG, resolved_at: null });

    // Web je stále dole — ticky ostatných dávok s ním nesmú pohnúť.
    let log = await runRounds(store, 2, (id) => id !== target);
    expect(openIncidents(store)).toEqual([target]);
    expect(store.sites!.find((s) => s.id === target)!.consecutive_failures).toBe(5); // +1 len pri jeho 2 kontrolách

    // Web je hore: incident sa zavrie práve v ticku, ktorý ho pingol.
    log = await runRounds(store, 1, () => true, 2);
    const closer = log.find((l) => l.pinged.includes(target))!;
    expect(store.incidents!.find((i) => i.id === 'inc-1')!.resolved_at).toBe(new Date(closer.at).toISOString());
    expect(alertsOf(store, 'site_up')).toEqual([target]);
  });

  it('web, ktorý v ticku nebol v dávke, nemá zmenený count ani last_checked_at', async () => {
    const store = storeWith(11);
    for (const s of store.sites!) s.consecutive_failures = 1;
    const pinged: string[] = [];
    await runUptime(env, {
      supabase: fakeSupabase(store, () => new Date(T0)),
      batch: { lane: 0, scheduledTime: T0 },
      provider: provider(() => false, pinged),
      now: new Date(T0),
    });
    for (const s of store.sites!) {
      if (pinged.includes(s.id as string)) expect(s.consecutive_failures).toBe(2);
      else {
        expect(s.consecutive_failures).toBe(1);
        expect(s.last_checked_at).toBeUndefined();
      }
    }
    expect(openIncidents(store).sort()).toEqual([...pinged].sort());
  });

  it('výpadok regiónu (všetko dole) naprieč dávkami → žiadne incidenty ani site_down, len region alert', async () => {
    const store = storeWith(11);
    await runRounds(store, 6, () => false);
    expect(openIncidents(store)).toEqual([]);
    expect(alertsOf(store, 'site_down')).toEqual([]);
    expect(store.alerts.some((a) => a.type === 'region_outage')).toBe(true);
    // Prvá dávka výpadok ešte nerozpozná (zvyšok flotily bol naposledy OK) → count 1, nie incident.
    expect(Math.max(...store.sites!.map((s) => s.consecutive_failures as number))).toBe(1);
  });

  it('po skončení výpadku regiónu sa monitoring hneď vráti — dávky sa nezaseknú v region režime', async () => {
    const store = storeWith(11);
    await runRounds(store, 3, () => false);
    await runRounds(store, 2, () => true, 3);
    expect(store.sites!.every((s) => s.consecutive_failures === 0)).toBe(true);
    expect(openIncidents(store)).toEqual([]);
  });

  it('reálny výpadok 3 webov jedného klienta (spoločný hosting) sa NEpovažuje za región', async () => {
    const store = storeWith(11);
    const shared = [siteId(0), siteId(1), siteId(2)];
    await runRounds(store, 3, (id) => !shared.includes(id));
    expect(openIncidents(store).sort()).toEqual(shared);
  });

  it('25 webov: každý web raz za 10 min, ≤ 5 pingov na spustenie; výpadok sa otvorí po 2 kontrolách', async () => {
    const store = storeWith(25);
    const down = siteId(12);
    const log = await runRounds(store, 4, (id) => id !== down);
    expect(Math.max(...log.map((l) => l.pinged.length))).toBeLessThanOrEqual(5);
    for (const s of store.sites!) expect(log.filter((l) => l.pinged.includes(s.id as string))).toHaveLength(2);
    expect(openIncidents(store)).toEqual([down]);
  });

  it('bez batch (napr. integračné testy) kontroluje celú flotilu ako predtým', async () => {
    const store = storeWith(11);
    const pinged: string[] = [];
    const stats = await runUptime(env, { supabase: fakeSupabase(store), provider: provider(() => true, pinged) });
    expect(pinged).toHaveLength(11);
    expect(stats).toMatchObject({ total: 11, checked: 11, plan: null });
  });
});
