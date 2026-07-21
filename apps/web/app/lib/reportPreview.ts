// Náhľad klientskeho mesačného reportu — presne tá istá skladačka ako
// tools/monthly-report/index.mjs (časť "2) Klientsky report"), len cez
// browser Supabase klienta (anon key, RLS) namiesto service_role REST volaní.
// Renderer je zdieľaný (@agency/core: renderClientReport + buildClientLines) —
// nič sa tu neduplikuje, takže náhľad sa nemôže rozísť s tým, čo klientovi
// naozaj príde mailom.
import { supabase } from './supabase';
import {
  renderClientReport,
  buildClientLines,
  type ClientReportSite,
  type ChangeEvent,
} from '@agency/core';

// Čistá dátová matematika (period, výber mesiaca) žije v `./reportPeriod` —
// testovateľná bez `./supabase`. Re-exportované kvôli spätnej kompatibilite
// (report/page.tsx importuje tieto z `./reportPreview`).
export { previousMonthValue, periodForMonthValue, type ReportPeriod } from './reportPeriod';
import type { ReportPeriod } from './reportPeriod';

export interface ReportClientOption {
  id: string;
  label: string;
  hasReportEmail: boolean;
}

/** Aktívni klienti pre výber v UI (rovnaká populácia ako `clientsList` v monthly-report). */
export async function loadReportClientOptions(): Promise<ReportClientOption[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, company, report_email')
    .eq('status', 'active')
    .order('name');
  if (error) throw new Error(`clients: ${error.message}`);
  return (data ?? []).map((c) => ({
    id: c.id,
    label: c.company || c.name,
    hasReportEmail: Boolean(c.report_email),
  }));
}

export interface ClientReportPreview {
  clientLabel: string;
  siteCount: number;
  subject: string;
  html: string;
  text: string;
}

function groupBySiteId<T extends { site_id: string | null }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.site_id) continue;
    const list = m.get(r.site_id) ?? [];
    list.push(r);
    m.set(r.site_id, list);
  }
  return m;
}

/**
 * Zostaví ClientReportData pre jedného klienta a obdobie presne podľa
 * tools/monthly-report/index.mjs (vigilance z uptime_daily, udalosti z
 * change_log filtrované na `payload`, denník z work_log, vyriešené
 * incidenty, knownVulns/pluginsCurrent s prísnymi null-vs-nula pravidlami —
 * pozri komentáre pri renderClientReport/buildClientLines v @agency/core).
 */
export async function loadClientReportPreview(clientId: string, period: ReportPeriod): Promise<ClientReportPreview> {
  const [cliRes, siteRes] = await Promise.all([
    supabase.from('clients').select('id, name, company').eq('id', clientId).maybeSingle(),
    supabase.from('sites').select('id, domain').eq('client_id', clientId).eq('is_active', true).order('domain'),
  ]);
  if (cliRes.error) throw new Error(`clients: ${cliRes.error.message}`);
  if (siteRes.error) throw new Error(`sites: ${siteRes.error.message}`);

  const label = cliRes.data?.company || cliRes.data?.name || 'Klient';
  const clientSites = siteRes.data ?? [];
  const siteIds = clientSites.map((s) => s.id);

  if (siteIds.length === 0) {
    const { subject, html, text } = renderClientReport({ monthLabel: period.monthLabel, periodLabel: period.periodLabel, clientName: label, sites: [] });
    return { clientLabel: label, siteCount: 0, subject, html, text };
  }

  const [dailyRes, resolvedIncRes, changeRes, workRes, wpRes] = await Promise.all([
    supabase.from('uptime_daily').select('site_id, uptime_pct, checks, downtime_seconds').in('site_id', siteIds).gte('day', period.startDay).lt('day', period.endDay),
    supabase.from('incidents').select('site_id, started_at, resolved_at').in('site_id', siteIds).gte('started_at', period.startIso).lt('started_at', period.endIso).not('resolved_at', 'is', null),
    supabase.from('change_log').select('site_id, kind, severity, message, payload, created_at').in('site_id', siteIds).gte('created_at', period.startIso).lt('created_at', period.endIso).order('created_at', { ascending: true }),
    supabase.from('work_log').select('site_id, happened_at, text').in('site_id', siteIds).gte('happened_at', period.startDay).lt('happened_at', period.endDay).order('happened_at', { ascending: true }),
    supabase.from('wp_snapshots').select('site_id, vulns, plugins').in('site_id', siteIds),
  ]);
  const named = [
    ['uptime_daily', dailyRes] as const,
    ['incidents', resolvedIncRes] as const,
    ['change_log', changeRes] as const,
    ['work_log', workRes] as const,
    ['wp_snapshots', wpRes] as const,
  ];
  for (const [name, res] of named) {
    if (res.error) throw new Error(`${name}: ${res.error.message}`);
  }

  const changeBySite = groupBySiteId(changeRes.data ?? []);
  const diaryBySite = groupBySiteId((workRes.data ?? []).map((r) => ({ ...r, site_id: r.site_id as string | null })));
  const resolvedBySite = groupBySiteId(resolvedIncRes.data ?? []);
  const wpBySite = new Map((wpRes.data ?? []).map((r) => [r.site_id, r]));

  // Vigilance = kontroly/dostupnosť/výpadok za obdobie (rovnaký akumulátor ako monthly-report).
  const upAcc = new Map<string, { sum: number; n: number; checks: number; downtime: number }>();
  for (const d of dailyRes.data ?? []) {
    const a = upAcc.get(d.site_id) ?? { sum: 0, n: 0, checks: 0, downtime: 0 };
    if (d.uptime_pct != null) {
      a.sum += Number(d.uptime_pct);
      a.n++;
    }
    a.checks += Number(d.checks ?? 0);
    a.downtime += Number(d.downtime_seconds ?? 0);
    upAcc.set(d.site_id, a);
  }

  const reportSites: ClientReportSite[] = clientSites.map((s) => {
    const a = upAcc.get(s.id);
    const wp = wpBySite.get(s.id);
    const vulnsArr = (wp?.vulns as unknown as { severity: string }[] | null) ?? null;
    // Prázdne pole pluginov je nerozlíšiteľné od zlyhaného/nedokončeného skenu
    // (wpIngest.ts vždy zapíše `plugins: body.plugins ?? []`) — preto `[]`
    // (aj non-array/chýbajúci riadok) znamená "nevieme", nie "všetko OK".
    const plugins = (wp?.plugins as unknown as { update_version: string | null }[] | null) ?? null;
    const events = (changeBySite.get(s.id) ?? []).filter((e) => e.payload);
    const lines = buildClientLines({
      events: events.map((e) => ({
        at: e.created_at,
        ev: {
          kind: e.kind as ChangeEvent['kind'],
          severity: e.severity as ChangeEvent['severity'],
          message: e.message,
          payload: e.payload as unknown as ChangeEvent['payload'],
        },
      })),
      diary: (diaryBySite.get(s.id) ?? []).map((d) => ({ happened_at: d.happened_at, text: d.text })),
      incidents: (resolvedBySite.get(s.id) ?? []).map((i) => ({ started_at: i.started_at, resolved_at: i.resolved_at as string })),
    }).map((l) => l.text);

    return {
      domain: s.domain,
      vigilance: { checks: a?.checks ?? 0, uptimePct: a && a.n ? a.sum / a.n : null, downtimeSeconds: a?.downtime ?? 0 },
      lines,
      knownVulns: Array.isArray(vulnsArr) ? vulnsArr.length : null,
      pluginsCurrent: Array.isArray(plugins) && plugins.length > 0 ? plugins.every((p) => !p.update_version) : null,
    };
  });

  const { subject, html, text } = renderClientReport({ monthLabel: period.monthLabel, periodLabel: period.periodLabel, clientName: label, sites: reportSites });
  return { clientLabel: label, siteCount: clientSites.length, subject, html, text };
}
