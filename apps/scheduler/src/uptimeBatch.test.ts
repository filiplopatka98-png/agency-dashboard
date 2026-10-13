import { describe, expect, it } from 'vitest';
import { MAX_SITES_PER_INVOCATION, UPTIME_LANES, planBatch, selectBatch } from './uptimeBatch';

const FIVE = 5 * 60_000;
const T0 = Date.parse('2026-10-13T10:00:00Z');
const fleet = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(2, '0')}`, url: `https://site${String(i).padStart(2, '0')}.sk` }));

/** Všetky spustenia (lane × 5-min okno) za `minutes` → koľkokrát a kedy bol web pingnutý. */
function simulate(n: number, minutes: number) {
  const seen = new Map<string, number[]>();
  const perInvocation: number[] = [];
  for (let t = T0; t < T0 + minutes * 60_000; t += FIVE) {
    for (let lane = 0; lane < UPTIME_LANES; lane++) {
      const at = t + lane * 60_000; // lane = minúta posunu cronu
      const batch = selectBatch(fleet(n), planBatch(n, lane, at));
      perInvocation.push(batch.length);
      for (const s of batch) seen.set(s.id, [...(seen.get(s.id) ?? []), at]);
    }
  }
  return { seen, perInvocation };
}

const maxGapMin = (times: number[]) => Math.max(...times.slice(1).map((t, i) => (t - times[i]!) / 60_000));

describe('dávkovanie uptime — každý web aspoň raz za 10 min, ≤ MAX webov na spustenie', () => {
  it.each([1, 3, 11, 15])('%i webov → každý web každých 5 min, presne raz za 5-min okno', (n) => {
    const { seen, perInvocation } = simulate(n, 60);
    expect(seen.size).toBe(n);
    for (const times of seen.values()) {
      expect(times).toHaveLength(12);
      expect(maxGapMin(times)).toBe(5);
    }
    expect(Math.max(...perInvocation)).toBeLessThanOrEqual(MAX_SITES_PER_INVOCATION);
  });

  it.each([16, 25, 30])('%i webov → každý web presne raz za 10 min, ≤ MAX na spustenie', (n) => {
    const { seen, perInvocation } = simulate(n, 60);
    expect(seen.size).toBe(n);
    for (const times of seen.values()) {
      expect(times).toHaveLength(6);
      expect(maxGapMin(times)).toBe(10);
    }
    expect(Math.max(...perInvocation)).toBeLessThanOrEqual(MAX_SITES_PER_INVOCATION);
    expect(planBatch(n, 0, T0).overCapacity).toBe(false);
  });

  it('11 webov (dnes) → dávky 4/4/3', () => {
    expect(simulate(11, 5).perInvocation).toEqual([4, 4, 3]);
  });

  it('nad 30 webov hlási overCapacity (treba ďalší cron), kontrola ide ďalej', () => {
    const plan = planBatch(31, 0, T0);
    expect(plan.overCapacity).toBe(true);
    expect(simulate(31, 60).seen.size).toBe(31);
  });

  it('weby jedného klienta (spoločný hosting) idú do rôznych dávok', () => {
    const sites = ['welltis.sk', 'welltisgroup.sk', 'welltisgroup.com', 'bytylazovna.sk', 'lopatka.sk', 'krivosik.sk'].map((d, i) => ({
      id: `id-${i}`,
      url: `https://${d}`,
    }));
    const batchOf = (host: string) =>
      [0, 1, 2].find((slot) => selectBatch(sites, { batches: 3, slot }).some((s) => s.url.endsWith(host)));
    expect(new Set([batchOf('welltis.sk'), batchOf('welltisgroup.sk'), batchOf('welltisgroup.com')]).size).toBe(3);
  });

  it('priradenie nezávisí od poradia riadkov z DB', () => {
    const sites = fleet(11);
    const a = selectBatch(sites, { batches: 3, slot: 1 }).map((s) => s.id);
    const b = selectBatch([...sites].reverse(), { batches: 3, slot: 1 }).map((s) => s.id);
    expect(b).toEqual(a);
  });
});
