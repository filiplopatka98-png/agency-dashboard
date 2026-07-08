import { describe, expect, it, vi } from 'vitest';
import type { Alert } from '@agency/shared';
import { ResendNotifier, renderAlertHtml } from './resendNotifier';

const alert = (over: Partial<Alert> = {}): Alert => ({
  orgId: '00000000-0000-0000-0000-0000000000a1',
  siteId: '00000000-0000-0000-0000-0000000000c1',
  type: 'site_down',
  severity: 'critical',
  title: 'Web je nedostupný',
  body: 'Dve po sebe idúce zlyhania.',
  dedupeKey: 'site:c1:down:i1',
  ...over,
});

describe('renderAlertHtml', () => {
  it('obsahuje title, body aj severity label', () => {
    const html = renderAlertHtml(alert());
    expect(html).toContain('Web je nedostupný');
    expect(html).toContain('Dve po sebe idúce zlyhania.');
    expect(html).toContain('Kritické');
  });

  it('bez body nepridá prázdny paragraf', () => {
    const html = renderAlertHtml(alert({ body: null }));
    expect(html).not.toContain('<p></p>');
  });
});

describe('ResendNotifier', () => {
  it('POST na Resend s Bearer tokenom a správnym payloadom', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response('{"id":"x"}', { status: 200 }),
    );
    const n = new ResendNotifier(
      { apiKey: 'k', from: 'a@lopatka.sk', to: 'b@lopatka.sk' },
      fetchImpl as unknown as typeof fetch,
    );
    await n.send(alert());

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    const payload = JSON.parse(init!.body as string);
    expect(payload.from).toBe('a@lopatka.sk');
    expect(payload.to).toBe('b@lopatka.sk');
    expect(payload.subject).toBe('Web je nedostupný');
    expect(payload.html).toContain('Web je nedostupný');
  });

  it('non-2xx odpoveď → throw', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad key', { status: 401 }));
    const n = new ResendNotifier(
      { apiKey: 'k', from: 'a@lopatka.sk', to: 'b@lopatka.sk' },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(n.send(alert())).rejects.toThrow(/resend 401/);
  });
});
