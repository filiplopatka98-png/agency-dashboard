import { describe, expect, it, vi } from 'vitest';
import { clientReportSubject, run } from './index.mjs';

const FILIP = 'filip@example.sk';
const KLIENTKA = 'klientka@example.sk';

const renderers = {
  renderMonthlyReport: ({ orgName }) => ({ subject: `Report ${orgName}`, html: '<p>org</p>', text: 'org' }),
  buildClientLines: () => [],
  renderClientReport: ({ clientName }) => ({ subject: `Report pre ${clientName}`, html: '<p>klient</p>', text: 'klient' }),
};

// Supabase REST + Resend v jednom falošnom fetchi; zaznamená každý e-mail.
function fakeFetch() {
  const emails = [];
  const data = {
    sites: [{ id: 's1', org_id: 'o1', domain: 'klientka.sk', client_id: 'c1' }],
    organizations: [{ id: 'o1', name: 'Lopatka' }],
    clients: [{ id: 'c1', org_id: 'o1', name: 'Klientka', company: null, report_email: KLIENTKA }],
    // Aj keby v nastaveniach org boli iní príjemcovia, report ide len Filipovi.
    notification_settings: [{ org_id: 'o1', monthly_report: true, recipients: [KLIENTKA] }],
  };
  const fetchImpl = vi.fn(async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      emails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'e1' }), { status: 200 });
    }
    const table = new URL(url).pathname.split('/').pop();
    return new Response(JSON.stringify(data[table] ?? []), { status: 200 });
  });
  return { fetchImpl, emails };
}

const env = {
  SUPABASE_URL: 'https://db.example',
  SUPABASE_SERVICE_ROLE_KEY: 'srv',
  RESEND_API_KEY: 're_test',
  ALERT_EMAIL_FROM: 'monitorix@example.sk',
  ALERT_EMAIL_TO: KLIENTKA, // ani alertová adresa nesmie byť príjemca reportu
  REPORT_EMAIL_TO: FILIP,
};

describe('mesačný report — poistka príjemcu', () => {
  it('pri vyplnenom report_email klienta ide KAŽDÝ e-mail len na REPORT_EMAIL_TO', async () => {
    const { fetchImpl, emails } = fakeFetch();
    await run({ env, fetchImpl, renderers, now: new Date('2026-10-01T07:00:00Z') });

    expect(emails).toHaveLength(2); // org + klientsky
    for (const e of emails) expect(e.to).toEqual([FILIP]);
    expect(JSON.stringify(emails.map((e) => e.to))).not.toContain(KLIENTKA);
  });

  it('report_email klienta je len v predmete (komu preposlať)', async () => {
    const { fetchImpl, emails } = fakeFetch();
    await run({ env, fetchImpl, renderers, now: new Date('2026-10-01T07:00:00Z') });
    const client = emails.find((e) => e.subject.includes('Report pre'));
    expect(client.subject).toBe(clientReportSubject('Report pre Klientka', KLIENTKA));
    expect(client.subject).toContain(KLIENTKA);
  });

  it('bez REPORT_EMAIL_TO neodíde nič a beh skončí chybou (žiadny fallback)', async () => {
    const { fetchImpl, emails } = fakeFetch();
    const { REPORT_EMAIL_TO: _, ...noReportTo } = env;
    await expect(run({ env: noReportTo, fetchImpl, renderers })).rejects.toThrow(/REPORT_EMAIL_TO/);
    await expect(run({ env: { ...env, REPORT_EMAIL_TO: '  ' }, fetchImpl, renderers })).rejects.toThrow(/REPORT_EMAIL_TO/);
    expect(emails).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
