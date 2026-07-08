import { describe, expect, it, vi } from 'vitest';
import type { SiteForCheck } from '@agency/shared';
import { LocalPinger } from './localPinger';

const site = (over: Partial<SiteForCheck> = {}): SiteForCheck => ({
  id: '00000000-0000-0000-0000-0000000000c1',
  orgId: '00000000-0000-0000-0000-0000000000a1',
  url: 'https://example.sk',
  expectedString: null,
  consecutiveFailures: 0,
  ...over,
});

/** fetch mock, ktorý vracia responses z fronty (jedna na volanie). */
function queuedFetch(responses: Response[]) {
  const fn = vi.fn(async () => {
    const r = responses.shift();
    if (!r) throw new Error('no more queued responses');
    return r;
  });
  return fn as unknown as typeof fetch & { mock: typeof fn.mock };
}

/** now() vracia rastúcu sekvenciu → responseMs je deterministický. */
function seqNow(...vals: number[]) {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)]!;
}

const noSleep = () => Promise.resolve();

describe('LocalPinger', () => {
  it('200 → ok, statusCode 200, responseMs zmeraný', async () => {
    const p = new LocalPinger({
      fetchImpl: queuedFetch([new Response('hello', { status: 200 })]),
      now: seqNow(1000, 1120),
      sleep: noSleep,
    });
    const [r] = await p.checkAll([site()]);
    expect(r!.ok).toBe(true);
    expect(r!.statusCode).toBe(200);
    expect(r!.responseMs).toBe(120);
  });

  it('3xx (301) je stále ok (rozsah 200–399)', async () => {
    const p = new LocalPinger({
      fetchImpl: queuedFetch([new Response('', { status: 301 })]),
      now: seqNow(0, 10),
      sleep: noSleep,
    });
    const [r] = await p.checkAll([site()]);
    expect(r!.ok).toBe(true);
  });

  it('503 → ok:false a JEDEN retry (fetch 2×)', async () => {
    const fetchImpl = queuedFetch([
      new Response('err', { status: 503 }),
      new Response('err', { status: 503 }),
    ]);
    const p = new LocalPinger({ fetchImpl, now: seqNow(0, 5, 10, 15), sleep: noSleep });
    const [r] = await p.checkAll([site()]);
    expect(r!.ok).toBe(false);
    expect(r!.statusCode).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retry sa zotaví: prvý 503, druhý 200 → ok', async () => {
    const fetchImpl = queuedFetch([
      new Response('err', { status: 503 }),
      new Response('ok', { status: 200 }),
    ]);
    const p = new LocalPinger({ fetchImpl, now: seqNow(0, 1, 2, 3), sleep: noSleep });
    const [r] = await p.checkAll([site()]);
    expect(r!.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('expected_string prítomný → ok', async () => {
    const p = new LocalPinger({
      fetchImpl: queuedFetch([new Response('<h1>Vitajte v detskom svete</h1>', { status: 200 })]),
      now: seqNow(0, 1),
      sleep: noSleep,
    });
    const [r] = await p.checkAll([site({ expectedString: 'detskom svete' })]);
    expect(r!.ok).toBe(true);
  });

  it('200 ale expected_string chýba → ok:false (aj po retry)', async () => {
    const p = new LocalPinger({
      fetchImpl: queuedFetch([
        new Response('prázdna stránka', { status: 200 }),
        new Response('prázdna stránka', { status: 200 }),
      ]),
      now: seqNow(0, 1, 2, 3),
      sleep: noSleep,
    });
    const [r] = await p.checkAll([site({ expectedString: 'detskom svete' })]);
    expect(r!.ok).toBe(false);
    expect(r!.error).toBe('expected_string_missing');
  });

  it('403 s "cloudflare" v tele → ok:true, error:blocked (žiadny incident)', async () => {
    const p = new LocalPinger({
      fetchImpl: queuedFetch([
        new Response('<title>Attention Required! | Cloudflare</title>', { status: 403 }),
      ]),
      now: seqNow(0, 1),
      sleep: noSleep,
    });
    const [r] = await p.checkAll([site()]);
    expect(r!.ok).toBe(true);
    expect(r!.error).toBe('blocked');
    expect(r!.statusCode).toBe(403);
  });

  it('429 s "wordfence" v tele → ok:true, error:blocked', async () => {
    const p = new LocalPinger({
      fetchImpl: queuedFetch([new Response('Blocked by Wordfence', { status: 429 })]),
      now: seqNow(0, 1),
      sleep: noSleep,
    });
    const [r] = await p.checkAll([site()]);
    expect(r!.ok).toBe(true);
    expect(r!.error).toBe('blocked');
  });

  it('403 bez WAF markerov → ok:false (reálny výpadok)', async () => {
    const p = new LocalPinger({
      fetchImpl: queuedFetch([
        new Response('Forbidden', { status: 403 }),
        new Response('Forbidden', { status: 403 }),
      ]),
      now: seqNow(0, 1, 2, 3),
      sleep: noSleep,
    });
    const [r] = await p.checkAll([site()]);
    expect(r!.ok).toBe(false);
    expect(r!.statusCode).toBe(403);
  });

  it('sieťová chyba / timeout → ok:false s error správou', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout');
    }) as unknown as typeof fetch;
    const p = new LocalPinger({ fetchImpl, now: seqNow(0, 1, 2, 3), sleep: noSleep });
    const [r] = await p.checkAll([site()]);
    expect(r!.ok).toBe(false);
    expect(r!.error).toContain('timeout');
  });

  it('checkAll zvládne viac webov paralelne', async () => {
    const p = new LocalPinger({
      fetchImpl: queuedFetch([
        new Response('a', { status: 200 }),
        new Response('b', { status: 200 }),
      ]),
      now: seqNow(0, 1, 2, 3),
      sleep: noSleep,
    });
    const out = await p.checkAll([site({ id: 's1' }), site({ id: 's2' })]);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.ok)).toBe(true);
  });
});
