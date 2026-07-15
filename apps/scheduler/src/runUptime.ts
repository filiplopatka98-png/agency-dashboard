import { decideIncidents, hourBucketUtc, LocalPinger, type UptimeProvider } from '@agency/core';
import type { SiteForCheck } from '@agency/shared';
import type { Env } from './env';
import { serviceClient } from './supabase';

interface SiteRow {
  id: string;
  org_id: string;
  url: string;
  expected_string: string | null;
  consecutive_failures: number;
  has_open_incident: boolean;
}

function providerFor(env: Env): UptimeProvider {
  // UptimeRobotProvider je odložený (fáza 1 zámerne). Zatiaľ len local.
  if (env.UPTIME_PROVIDER && env.UPTIME_PROVIDER !== 'local') {
    console.log(JSON.stringify({ ev: 'uptime.provider_fallback', requested: env.UPTIME_PROVIDER }));
  }
  return new LocalPinger();
}

/**
 * Jeden beh uptime monitoringu (každých 5 min).
 * Subrequesty: 1 rpc get + N pingov (+retry) + 1 rpc persist. Ďaleko pod limitom 50.
 */
export async function runUptime(env: Env): Promise<void> {
  const supabase = serviceClient(env);

  const { data, error } = await supabase.rpc('get_sites_to_check');
  if (error) throw new Error(`get_sites_to_check: ${error.message}`);
  const rows = (data ?? []) as SiteRow[];
  if (rows.length === 0) {
    console.log(JSON.stringify({ ev: 'uptime.no_sites' }));
    return;
  }

  const checkSites: SiteForCheck[] = rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    url: r.url,
    expectedString: r.expected_string,
    consecutiveFailures: r.consecutive_failures,
  }));

  const results = await providerFor(env).checkAll(checkSites);

  const stateMap = new Map(
    rows.map((r) => [
      r.id,
      { consecutiveFailures: r.consecutive_failures, hasOpenIncident: r.has_open_incident },
    ]),
  );
  const decision = decideIncidents({ results, sites: stateMap });

  if (decision.regionOutage) {
    // Problém je u nás — checky nezapisuj (nešpini uptime klientov), incidenty
    // neotváraj. Ale vlož region_outage alert (per org, dedupe na hodinu) —
    // odošle ho runAlerts (v noci odložený, warning).
    const down = results.filter((r) => !r.ok).length;
    const total = results.length;
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

    console.log(JSON.stringify({ ev: 'region_outage', down, total, orgs: orgs.length }));
    return;
  }

  const orgById = new Map(rows.map((r) => [r.id, r.org_id]));
  const checks = results.map((r) => ({
    site_id: r.siteId,
    org_id: orgById.get(r.siteId),
    ok: r.ok,
    status_code: r.statusCode ?? null,
    response_ms: r.responseMs ?? null,
    error: r.error ?? null,
  }));
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
}
