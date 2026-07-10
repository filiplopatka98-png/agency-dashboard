import { supabase, type Alert, type Client } from './supabase';
import {
  STATUS,
  statusKey,
  domainExpiryColor,
  tlsExpiryColor,
  expiryBadgeColor,
  segColor,
  seeded,
  type StatusKey,
} from './design';
import { relativeTime } from './format';

export interface ExpiryIssue {
  label: string;
  color: string;
}
export interface UptimeSeg {
  color: string;
  date: string;
  value: number | null;
}
export interface IncidentVM {
  title: string;
  startTime: string;
  duration: string;
  color: string;
  statusCode: string;
}

export interface SiteVM {
  id: string;
  name: string;
  domain: string;
  url: string;
  clientId: string | null;
  clientName: string;
  clientInitial: string;
  // Karta klienta — reálne z clients (fakturačné/kontaktné údaje)
  client: {
    company: string | null;
    email: string | null;
    phone: string | null;
    ico: string | null;
    monthlyFeeEur: number | null;
    hourlyRateEur: number | null;
    contractType: string | null;
    notionPageId: string | null;
    since: string | null;
  } | null;
  statusKey: StatusKey;
  dotColor: string;
  tintBg: string;
  statusShort: string;
  statusLabel: string;
  pulseClass: string;
  lastCheckTime: string;
  lastStatusChange: string;
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  uptime90d: string;
  uptimeDisplay: string;
  uptimeSegments: UptimeSeg[];
  uptimeCalendar: UptimeSeg[];
  hasExpiry: boolean;
  expiryIssues: ExpiryIssue[];
  domainDaysLeft: number | null;
  domainExpiryColor: string;
  tlsDaysLeft: number | null;
  tlsExpiryColor: string;
  incidents: IncidentVM[];
  // reálne uptime metriky (z uptime_daily + incidents)
  p95Series: number[];
  incidentCount30: number;
  mttrMin: number | null;
  daysSinceIncident: number | null;
  slaOk: boolean;
  // mock (budúce fázy)
  perfScore: number | null;
  openIssues: number;
  isWordPress: boolean;
  gscConnected: boolean;
  seed: number;
  // AEO — reálne (aeo_snapshots) alebo null ak ešte nemerané
  aeo: {
    score: number;
    checks: { id: string; label: string; weight: number; earned: number; pass: boolean }[];
    aiBots: Record<string, string>;
    schemaTypes: string[];
  } | null;
  // SEO — reálne (seo_snapshots) alebo null
  seo: {
    pagesCrawled: number;
    sitemapOk: boolean;
    robotsOk: boolean;
    canonicalOk: boolean;
    issues: { type: string; severity: string; sample: string; count: number; urls: string[] }[];
  } | null;
  // Performance — reálne (perf_snapshots), per stratégia
  perf: { mobile: PerfSnapVM | null; desktop: PerfSnapVM | null } | null;
  // Security — reálne (security_snapshots)
  security: {
    score: number;
    headers: { hsts: boolean; csp: boolean; xframe: boolean; xcto: boolean; referrer: boolean; permissions: boolean };
    safeBrowsingOk: boolean | null;
  } | null;
  // Search Console — reálne (gsc_snapshots) alebo null (nepripojené)
  gsc: {
    clicks: number;
    impressions: number;
    ctr: number; // 0..1
    position: number;
    rangeDays: number;
    topQueries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  } | null;
  // WordPress agent — reálne (wp_snapshots) alebo null (agent nenainštalovaný)
  wp: {
    wpVersion: string | null;
    wpUpdate: string | null;
    phpVersion: string | null;
    mysqlVersion: string | null;
    theme: string | null;
    plugins: { name: string; slug: string; version: string; active: boolean; update_version: string | null }[];
    vulns: { target: string; slug: string; version: string; title: string; cve: string | null; fixed_in: string | null }[];
    backupAt: string | null;
  } | null;
}

export interface PerfSnapVM {
  performanceScore: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  ttfbMs: number | null;
  pageWeightKb: number | null;
  requests: number | null;
  fieldLcpMs: number | null;
  fieldInpMs: number | null;
  fieldCls: number | null;
}

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

function daysUntilDate(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
}

function fmtDuration(sec: number | null): string {
  if (!sec) return '—';
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

/** Načíta všetko pre dashboard: reálna fáza 1 + mock budúce polia. */
export async function loadDashboard(): Promise<{
  sites: SiteVM[];
  clients: Client[];
  alerts: Alert[];
}> {
  const since90 = isoDay(90);
  const [sitesRes, dailyRes, domRes, tlsRes, incRes, cliRes, alRes, aeoRes, seoRes, perfRes, secRes, gscRes, wpRes] = await Promise.all([
    supabase.from('sites').select('*').eq('is_active', true).order('name'),
    supabase.from('uptime_daily').select('site_id, day, uptime_pct, p95_ms').gte('day', since90),
    supabase.from('domains').select('site_id, expires_at, registrar'),
    supabase.from('tls_certs').select('site_id, valid_to, issuer'),
    supabase.from('incidents').select('*').order('started_at', { ascending: false }).limit(200),
    supabase.from('clients').select('*').order('name'),
    supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('aeo_snapshots').select('site_id, score, checks, ai_bots, schema_types'),
    supabase.from('seo_snapshots').select('site_id, pages_crawled, sitemap_ok, robots_ok, canonical_ok, issues, error'),
    supabase.from('perf_snapshots').select('*'),
    supabase.from('security_snapshots').select('site_id, score, headers, safe_browsing_ok'),
    supabase.from('gsc_snapshots').select('site_id, clicks, impressions, ctr, position, range_days, top_queries'),
    supabase.from('wp_snapshots').select('site_id, wp_version, wp_update, php_version, mysql_version, theme, plugins, vulns, backup_at, error'),
  ]);
  const secBySite = new Map((secRes.data ?? []).map((r) => [r.site_id, r]));
  const gscBySite = new Map((gscRes.data ?? []).map((r) => [r.site_id, r]));
  const wpBySite = new Map((wpRes.data ?? []).map((r) => [r.site_id, r]));
  const aeoBySite = new Map((aeoRes.data ?? []).map((a) => [a.site_id, a]));
  const seoBySite = new Map((seoRes.data ?? []).map((s) => [s.site_id, s]));
  const perfBySite = new Map<string, { mobile: PerfSnapVM | null; desktop: PerfSnapVM | null }>();
  for (const p of perfRes.data ?? []) {
    if (p.performance_score === null) continue;
    const snap: PerfSnapVM = {
      performanceScore: p.performance_score,
      accessibility: p.accessibility ?? 0,
      bestPractices: p.best_practices ?? 0,
      seo: p.seo ?? 0,
      lcpMs: p.lcp_ms,
      inpMs: p.inp_ms,
      cls: p.cls === null ? null : Number(p.cls),
      ttfbMs: p.ttfb_ms,
      pageWeightKb: p.page_weight_kb,
      requests: p.requests,
      fieldLcpMs: p.field_lcp_ms,
      fieldInpMs: p.field_inp_ms,
      fieldCls: p.field_cls === null ? null : Number(p.field_cls),
    };
    const cur = perfBySite.get(p.site_id) ?? { mobile: null, desktop: null };
    if (p.strategy === 'mobile') cur.mobile = snap;
    else if (p.strategy === 'desktop') cur.desktop = snap;
    perfBySite.set(p.site_id, cur);
  }

  const clients = (cliRes.data ?? []) as Client[];
  const clientById = new Map(clients.map((c) => [c.id, c]));

  // uptime_daily → map[siteId][day] = pct  a  map[siteId][day] = p95_ms
  const dailyBySite = new Map<string, Map<string, number>>();
  const p95BySite = new Map<string, Map<string, number>>();
  for (const d of dailyRes.data ?? []) {
    const m = dailyBySite.get(d.site_id) ?? new Map<string, number>();
    m.set(d.day as string, Number(d.uptime_pct));
    dailyBySite.set(d.site_id, m);
    if (d.p95_ms != null) {
      const p = p95BySite.get(d.site_id) ?? new Map<string, number>();
      p.set(d.day as string, Number(d.p95_ms));
      p95BySite.set(d.site_id, p);
    }
  }
  const domBySite = new Map((domRes.data ?? []).map((d) => [d.site_id, d]));
  const tlsBySite = new Map((tlsRes.data ?? []).map((t) => [t.site_id, t]));

  // Otvorené issues per site = otvorené incidenty + nevyriešené alerty.
  const openIssuesBySite = new Map<string, number>();
  for (const i of incRes.data ?? []) {
    if (!i.resolved_at) openIssuesBySite.set(i.site_id, (openIssuesBySite.get(i.site_id) ?? 0) + 1);
  }
  for (const a of alRes.data ?? []) {
    if (!a.resolved_at && a.site_id)
      openIssuesBySite.set(a.site_id, (openIssuesBySite.get(a.site_id) ?? 0) + 1);
  }
  const incBySite = new Map<string, IncidentVM[]>();
  for (const i of incRes.data ?? []) {
    const list = incBySite.get(i.site_id) ?? [];
    if (list.length < 10) {
      const open = !i.resolved_at;
      list.push({
        title: open ? 'Prebiehajúci výpadok' : 'Výpadok · vyriešené',
        startTime: new Date(i.started_at).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }),
        duration: open ? 'prebieha' : fmtDuration(i.duration_seconds),
        color: open ? 'var(--critical-color)' : 'var(--warning-color)',
        statusCode: String(i.last_status_code ?? '—'),
      });
    }
    incBySite.set(i.site_id, list);
  }

  // Incident metriky per site (posledných 30 dní).
  const cut30 = Date.now() - 30 * 86400000;
  interface IncStats { count30: number; durSum: number; durN: number; lastStart: number | null }
  const incStats = new Map<string, IncStats>();
  for (const i of incRes.data ?? []) {
    const st = incStats.get(i.site_id) ?? { count30: 0, durSum: 0, durN: 0, lastStart: null };
    const started = new Date(i.started_at).getTime();
    if (started >= cut30) st.count30++;
    if (i.duration_seconds != null) {
      st.durSum += i.duration_seconds;
      st.durN++;
    }
    st.lastStart = st.lastStart === null ? started : Math.max(st.lastStart, started);
    incStats.set(i.site_id, st);
  }

  const agg = (siteId: string, days: number): number | null => {
    const m = dailyBySite.get(siteId);
    if (!m) return null;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < days; i++) {
      const pct = m.get(isoDay(i));
      if (pct !== undefined) {
        sum += pct;
        n++;
      }
    }
    return n === 0 ? null : Math.round((sum / n) * 100) / 100;
  };
  const buildSegs = (siteId: string, days: number): UptimeSeg[] => {
    const m = dailyBySite.get(siteId);
    const out: UptimeSeg[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = isoDay(i);
      const pct = m?.get(day) ?? null;
      out.push({ color: segColor(pct), date: day, value: pct });
    }
    return out;
  };
  const buildP95Series = (siteId: string): number[] => {
    const m = p95BySite.get(siteId);
    if (!m) return [];
    const out: number[] = [];
    for (let i = 29; i >= 0; i--) {
      const v = m.get(isoDay(i));
      if (v !== undefined) out.push(v);
    }
    return out;
  };

  const sites: SiteVM[] = (sitesRes.data ?? []).map((s) => {
    const key = s.maintenance ? 'maintenance' : statusKey(s.consecutive_failures, s.last_checked_at);
    const st = STATUS[key];
    const client = s.client_id ? clientById.get(s.client_id) : null;
    const clientName = client?.name ?? '—';
    const dom = domBySite.get(s.id);
    const tls = tlsBySite.get(s.id);
    const domainDaysLeft = daysUntilDate(dom?.expires_at ?? null);
    const tlsDaysLeft = daysUntilDate(tls?.valid_to ?? null);

    const expiryIssues: ExpiryIssue[] = [];
    if (tlsDaysLeft !== null && tlsDaysLeft <= 45)
      expiryIssues.push({ label: `TLS: ${tlsDaysLeft}d`, color: expiryBadgeColor(tlsDaysLeft, 21) });
    if (domainDaysLeft !== null && domainDaysLeft <= 45)
      expiryIssues.push({ label: `Doména: ${domainDaysLeft}d`, color: expiryBadgeColor(domainDaysLeft, 30) });

    const u30 = agg(s.id, 30);
    const u90 = agg(s.id, 90);
    const seed = hashSeed(s.id);
    const rnd = seeded(seed);

    return {
      id: s.id,
      name: s.name,
      domain: s.domain,
      url: s.url,
      clientId: s.client_id,
      clientName,
      clientInitial: (clientName || '—').replace(/^Klient\s*/i, '').charAt(0).toUpperCase() || '—',
      client: client
        ? {
            company: client.company,
            email: client.email,
            phone: client.phone,
            ico: client.ico,
            monthlyFeeEur: client.monthly_fee_eur === null ? null : Number(client.monthly_fee_eur),
            hourlyRateEur: client.hourly_rate_eur === null ? null : Number(client.hourly_rate_eur),
            contractType: client.contract_type,
            notionPageId: client.notion_page_id,
            since: client.created_at,
          }
        : null,
      statusKey: key,
      dotColor: st.color,
      tintBg: st.bg,
      statusShort: st.short,
      statusLabel: st.label,
      pulseClass: key === 'down' ? 'pulse-dot' : '',
      lastCheckTime: relativeTime(s.last_checked_at),
      lastStatusChange: relativeTime(s.last_checked_at),
      uptime24h: agg(s.id, 1),
      uptime7d: agg(s.id, 7),
      uptime30d: u30,
      uptime90d: u90 === null ? '—' : `${u90}%`,
      uptimeDisplay: u30 === null ? '—' : `${u30}%`,
      uptimeSegments: buildSegs(s.id, 30),
      uptimeCalendar: buildSegs(s.id, 90),
      hasExpiry: expiryIssues.length > 0,
      expiryIssues,
      domainDaysLeft,
      domainExpiryColor: domainExpiryColor(domainDaysLeft),
      tlsDaysLeft,
      tlsExpiryColor: tlsExpiryColor(tlsDaysLeft),
      incidents: incBySite.get(s.id) ?? [],
      p95Series: buildP95Series(s.id),
      incidentCount30: incStats.get(s.id)?.count30 ?? 0,
      mttrMin: (() => {
        const st = incStats.get(s.id);
        return st && st.durN > 0 ? Math.round(st.durSum / st.durN / 60) : null;
      })(),
      daysSinceIncident: (() => {
        const st = incStats.get(s.id);
        return st?.lastStart ? Math.floor((Date.now() - st.lastStart) / 86400000) : null;
      })(),
      slaOk: (u30 ?? 0) >= 99.5,
      // mock — budúce fázy (deterministické podľa seedu)
      perfScore: key === 'unknown' ? null : 60 + Math.floor(rnd() * 39),
      openIssues: openIssuesBySite.get(s.id) ?? 0,
      isWordPress: s.cms === 'wordpress',
      gscConnected: seed % 2 === 1,
      seed,
      aeo: (() => {
        const a = aeoBySite.get(s.id);
        if (!a || a.score === null) return null;
        return {
          score: a.score,
          checks: (a.checks as unknown as { id: string; label: string; weight: number; earned: number; pass: boolean }[]) ?? [],
          aiBots: (a.ai_bots as Record<string, string>) ?? {},
          schemaTypes: (a.schema_types as string[]) ?? [],
        };
      })(),
      seo: (() => {
        const so = seoBySite.get(s.id);
        if (!so || so.error || so.pages_crawled === null || so.pages_crawled === 0) return null;
        return {
          pagesCrawled: so.pages_crawled,
          sitemapOk: Boolean(so.sitemap_ok),
          robotsOk: Boolean(so.robots_ok),
          canonicalOk: Boolean(so.canonical_ok),
          issues: (so.issues as unknown as { type: string; severity: string; sample: string; count: number; urls: string[] }[]) ?? [],
        };
      })(),
      perf: perfBySite.get(s.id) ?? null,
      security: (() => {
        const se = secBySite.get(s.id);
        if (!se || se.score === null) return null;
        return {
          score: se.score,
          headers: (se.headers as unknown as { hsts: boolean; csp: boolean; xframe: boolean; xcto: boolean; referrer: boolean; permissions: boolean }) ?? { hsts: false, csp: false, xframe: false, xcto: false, referrer: false, permissions: false },
          safeBrowsingOk: se.safe_browsing_ok,
        };
      })(),
      gsc: (() => {
        const g = gscBySite.get(s.id);
        if (!g || g.clicks === null) return null;
        return {
          clicks: g.clicks,
          impressions: g.impressions ?? 0,
          ctr: Number(g.ctr ?? 0),
          position: Number(g.position ?? 0),
          rangeDays: g.range_days ?? 28,
          topQueries: (g.top_queries as unknown as { query: string; clicks: number; impressions: number; ctr: number; position: number }[]) ?? [],
        };
      })(),
      wp: (() => {
        const w = wpBySite.get(s.id);
        if (!w || (w.error && w.wp_version === null)) return null;
        return {
          wpVersion: w.wp_version,
          wpUpdate: w.wp_update,
          phpVersion: w.php_version,
          mysqlVersion: w.mysql_version,
          theme: w.theme,
          plugins: (w.plugins as unknown as { name: string; slug: string; version: string; active: boolean; update_version: string | null }[]) ?? [],
          vulns: (w.vulns as unknown as { target: string; slug: string; version: string; title: string; cve: string | null; fixed_in: string | null }[]) ?? [],
          backupAt: w.backup_at,
        };
      })(),
    };
  });

  return { sites, clients, alerts: (alRes.data ?? []) as Alert[] };
}
