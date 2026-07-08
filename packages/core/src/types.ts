import type { Alert, CheckResult, SiteForCheck } from '@agency/shared';

/**
 * Runtime-agnostické porty (interfaces). Konkrétne implementácie žijú buď
 * v core (čistý TS, napr. LocalPinger) alebo v apps/scheduler (keď potrebujú
 * cloudflare:* runtime, napr. whois:43 socket).
 */

export interface UptimeProvider {
  checkAll(sites: SiteForCheck[]): Promise<CheckResult[]>;
}

export interface Notifier {
  send(alert: Alert): Promise<void>;
}
