import type { Alert } from '@agency/shared';
import type { Notifier } from './types';

export interface ResendConfig {
  apiKey: string;
  from: string;
  to: string;
}

const SEVERITY_LABEL: Record<Alert['severity'], string> = {
  critical: '🔴 Kritické',
  warning: '🟠 Upozornenie',
  info: '🟢 Info',
};

/** Plain HTML, žiadne šablóny (fáza 1). */
export function renderAlertHtml(a: Alert): string {
  const label = SEVERITY_LABEL[a.severity];
  const body = a.body ? `<p>${a.body}</p>` : '';
  return `<div><p><strong>${label}</strong></p><h2>${a.title}</h2>${body}</div>`;
}

/** POST https://api.resend.com/emails. fetch je injektovateľný kvôli testom. */
export class ResendNotifier implements Notifier {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly cfg: ResendConfig,
    fetchImpl?: typeof fetch,
  ) {
    // .bind(globalThis): na Cloudflare Workers musí byť `fetch` volaný s
    // this===globalThis, inak „Illegal invocation" (uložená referencia stráca väzbu).
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async send(a: Alert): Promise<void> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.cfg.from,
        to: this.cfg.to,
        subject: a.title,
        html: renderAlertHtml(a),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`resend ${res.status}: ${text}`);
    }
  }
}
