import type { CheckResult, SiteForCheck } from '@agency/shared';
import type { UptimeProvider } from './types';

const USER_AGENT = 'AgencyDashboard/1.0 (+https://dash.lopatka.sk)';
const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 3_000;
const WAF_MARKERS = /cloudflare|wordfence/i;

export interface LocalPingerDeps {
  /** Injektovateľné kvôli testom. Default: globálny fetch (Workers/Node 18+). */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Default uptime provider (UPTIME_PROVIDER=local). Pinguje weby priamo cez fetch.
 *
 * Detaily, na ktorých záleží:
 *  - Identifikovateľný User-Agent (inak Wordfence/Cloudflare WAF zablokuje).
 *  - HTTP 403/429 s 'cloudflare'/'wordfence' v tele NIE je výpadok → ok:true,
 *    error:'blocked'. Radšej slepé miesto než falošný poplach o tretej ráno.
 *  - expected_string sa číta LEN keď ho web má (res.text() je jediná reálna
 *    CPU záťaž workera).
 *  - Pri zlyhaní JEDEN okamžitý retry po 3 s.
 */
export class LocalPinger implements UptimeProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: LocalPingerDeps = {}) {
    // .bind(globalThis) je nutné: na Cloudflare Workers musí byť `fetch` volaný s
    // `this===globalThis`, inak „Illegal invocation" (uložená referencia stráca väzbu).
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async checkAll(sites: SiteForCheck[]): Promise<CheckResult[]> {
    return Promise.all(sites.map((s) => this.checkOne(s)));
  }

  private async checkOne(site: SiteForCheck): Promise<CheckResult> {
    const first = await this.attempt(site);
    if (first.ok) return first;
    await this.sleep(RETRY_DELAY_MS);
    return this.attempt(site);
  }

  private async attempt(site: SiteForCheck): Promise<CheckResult> {
    const t0 = this.now();
    try {
      const res = await this.fetchImpl(site.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': USER_AGENT },
      });
      const responseMs = this.now() - t0;
      const status = res.status;
      const httpOk = status >= 200 && status <= 399;

      // WAF blok (403/429) nie je výpadok, ak telo prezrádza CF/Wordfence.
      if (!httpOk && (status === 403 || status === 429)) {
        const body = await this.safeText(res);
        if (WAF_MARKERS.test(body)) {
          return { siteId: site.id, ok: true, statusCode: status, responseMs, error: 'blocked' };
        }
        return { siteId: site.id, ok: false, statusCode: status, responseMs };
      }

      if (httpOk && site.expectedString) {
        const body = await this.safeText(res);
        if (!body.includes(site.expectedString)) {
          return {
            siteId: site.id,
            ok: false,
            statusCode: status,
            responseMs,
            error: 'expected_string_missing',
          };
        }
      }

      return { siteId: site.id, ok: httpOk, statusCode: status, responseMs };
    } catch (err) {
      const responseMs = this.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      return { siteId: site.id, ok: false, responseMs, error: message };
    }
  }

  private async safeText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return '';
    }
  }
}
