import { decideIncidents, hourBucketUtc, LocalPinger, type UptimeProvider } from '@agency/core';
import type { SiteForCheck } from '@agency/shared';
import type { Env } from './env';
import { serviceClient, type Db } from './supabase';
import { planBatch, selectBatch, type BatchPlan } from './uptimeBatch';

interface SiteRow {
  id: string;
  org_id: string;
  url: string;
  expected_string: string | null;
  consecutive_failures: number;
  has_open_incident: boolean;
  // Posledný výsledok pingu bez ohľadu na region outage (migrácia 0046). Pred
  // migráciou chýbajú → region sa posúdi len na dávke (bezpečný smer: nepotláča).
  last_probe_ok?: boolean | null;
  last_probe_at?: string | null;
}

/** Pozorovanie webu mimo dávky staršie než toto sa do region rozhodnutia neráta. */
export const OBSERVATION_FRESH_MS = 15 * 60_000;

export interface RunUptimeDeps {
  supabase?: Db;
  /** Dávkovanie: lane = ktorý uptime cron (0…UPTIME_LANES-1), scheduledTime z cron eventu. Bez neho celá flotila. */
  batch?: { lane: number; scheduledTime: number };
  provider?: UptimeProvider;
  now?: Date;
}

export interface RunUptimeStats {
  total: number;
  checked: number;
  failed: number;
  redirected: number;
  withExpectedString: number;
  otherObservations: number;
  regionOutage: boolean;
  opened: number;
  closed: number;
  plan: BatchPlan | null;
}

function providerFor(env: Env): UptimeProvider {
  // UptimeRobotProvider je odložený (fáza 1 zámerne). Zatiaľ len local.
  if (env.UPTIME_PROVIDER && env.UPTIME_PROVIDER !== 'local') {
    console.log(JSON.stringify({ ev: 'uptime.provider_fallback', requested: env.UPTIME_PROVIDER }));
  }
  return new LocalPinger();
}

/**
 * Jeden beh uptime monitoringu — s `deps.batch` len dávka tohto cronu (viď uptimeBatch.ts).
 * Subrequesty: 1 rpc get + pingy dávky (+retry, +presmerovania) + 1 rpc persist
 * (pri region outage upsert alertu + note_probes).
 *
 * Web mimo dávky sa v tomto spustení vôbec nerozhoduje: jeho consecutive_failures,
 * incident ani alerty sa nemenia (decideIncidents aj persist_uptime pracujú len
 * s výsledkami dávky). Jeho posledný výsledok sa použije len na region outage.
 */
export async function runUptime(env: Env, deps: RunUptimeDeps = {}): Promise<RunUptimeStats> {
  const supabase = deps.supabase ?? serviceClient(env);
  const now = deps.now ?? new Date();

  const { data, error } = await supabase.rpc('get_sites_to_check');
  if (error) throw new Error(`get_sites_to_check: ${error.message}`);
  const all = (data ?? []) as SiteRow[];
  const plan = deps.batch ? planBatch(all.length, deps.batch.lane, deps.batch.scheduledTime) : null;
  const rows = plan ? selectBatch(all, plan) : all;
  const stats: RunUptimeStats = {
    total: all.length,
    checked: rows.length,
    failed: 0,
    redirected: 0,
    withExpectedString: rows.filter((r) => r.expected_string).length,
    otherObservations: 0,
    regionOutage: false,
    opened: 0,
    closed: 0,
    plan,
  };
  // Dočasné meranie (CPU v Observability → korelácia s počtom pingov/presmerovaní/tiel).
  const logBatch = () => console.log(JSON.stringify({ ev: 'uptime.batch', ...stats, plan: undefined, ...plan }));
  if (rows.length === 0) {
    console.log(JSON.stringify({ ev: 'uptime.no_sites' }));
    logBatch();
    return stats;
  }

  const inBatch = new Set(rows.map((r) => r.id));
  const freshSince = now.getTime() - OBSERVATION_FRESH_MS;
  const otherObservations = all
    .filter((r) => !inBatch.has(r.id) && r.last_probe_ok != null && r.last_probe_at && Date.parse(r.last_probe_at) >= freshSince)
    .map((r) => r.last_probe_ok as boolean);
  stats.otherObservations = otherObservations.length;

  const checkSites: SiteForCheck[] = rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    url: r.url,
    expectedString: r.expected_string,
    consecutiveFailures: r.consecutive_failures,
  }));

  const results = await (deps.provider ?? providerFor(env)).checkAll(checkSites);
  stats.failed = results.filter((r) => !r.ok).length;
  stats.redirected = results.filter((r) => r.redirected).length;

  const stateMap = new Map(
    rows.map((r) => [
      r.id,
      { consecutiveFailures: r.consecutive_failures, hasOpenIncident: r.has_open_incident },
    ]),
  );
  const decision = decideIncidents({ results, sites: stateMap, otherObservations });
  stats.regionOutage = decision.regionOutage;

  const orgById = new Map(rows.map((r) => [r.id, r.org_id]));
  const checks = results.map((r) => ({
    site_id: r.siteId,
    org_id: orgById.get(r.siteId),
    ok: r.ok,
    status_code: r.statusCode ?? null,
    response_ms: r.responseMs ?? null,
    error: r.error ?? null,
  }));

  if (decision.regionOutage) {
    // Problém je u nás — checky nezapisuj (nešpini uptime klientov), incidenty
    // neotváraj. Ale vlož region_outage alert (per org, dedupe na hodinu) —
    // odošle ho runAlerts (v noci odložený, warning).
    const down = stats.failed + otherObservations.filter((ok) => !ok).length;
    const total = results.length + otherObservations.length;
    const bucket = hourBucketUtc(new Date());
    const orgs = [...new Set(rows.map((r) => r.org_id))];
    const alertRows = orgs.map((orgId) => ({
      org_id: orgId,
      site_id: null,
      type: 'region_outage',
      severity: 'warning',
      title: 'Možný výpadok regiónu',
      body: `Viac než polovica sledovaných webov je nedostupná (${down}/${total}) — pravdepodobne problém na strane monitoringu/CDN, nie klientov.`,
      dedupe_key: `region:${bucket}:${orgId}`,
    }));
    const { error: aErr } = await supabase
      .from('alerts')
      .upsert(alertRows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (aErr) throw new Error(`region alert: ${aErr.message}`);

    // Posledný výsledok pingu zapíš aj teraz (len sites.last_probe_*, nie uptime_checks
    // ani counts) — ďalšie dávky tak vidia, že výpadok trvá, a neotvoria falošné incidenty.
    // Best-effort: bez neho sa region posúdi len na dávke.
    const { error: nErr } = await supabase.rpc('note_probes', { _checks: checks });
    if (nErr) console.log(JSON.stringify({ ev: 'uptime.note_probes_fail', message: nErr.message }));

    console.log(JSON.stringify({ ev: 'region_outage', down, total, orgs: orgs.length }));
    logBatch();
    return stats;
  }

  const counts = [...decision.newFailureCounts.entries()].map(([site_id, failures]) => ({
    site_id,
    failures,
  }));

  const { error: pErr } = await supabase.rpc('persist_uptime', {
    _checks: checks,
    _counts: counts,
    _open: decision.openIncident,
    _close: decision.closeIncident,
  });
  if (pErr) throw new Error(`persist_uptime: ${pErr.message}`);
  stats.opened = decision.openIncident.length;
  stats.closed = decision.closeIncident.length;

  // Log veľkých zmien: výpadok / obnova (feed „čo sa zmenilo").
  const nameById = new Map(rows.map((r) => [r.id, r.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')]));
  const logs = [
    ...decision.openIncident.map((sid) => ({ site_id: sid, org_id: orgById.get(sid), kind: 'status', severity: 'critical', message: `${nameById.get(sid) ?? 'web'} je nedostupný` })),
    ...decision.closeIncident.map((sid) => ({ site_id: sid, org_id: orgById.get(sid), kind: 'status', severity: 'info', message: `${nameById.get(sid) ?? 'web'} je opäť dostupný` })),
  ];
  if (logs.length) {
    const { error: lErr } = await supabase.from('change_log').insert(logs);
    if (lErr) console.log(JSON.stringify({ ev: 'changelog.fail', message: lErr.message }));
  }

  console.log(
    JSON.stringify({
      ev: 'uptime.persisted',
      checks: checks.length,
      opened: decision.openIncident.length,
      closed: decision.closeIncident.length,
    }),
  );
  logBatch();
  return stats;
}
