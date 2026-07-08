import { decideIncidents, LocalPinger, type UptimeProvider } from '@agency/core';
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
    // Problém je u nás — nič nezapisuj, nič neotváraj. Alert rieši krok 8.
    console.log(
      JSON.stringify({
        ev: 'region_outage',
        down: results.filter((r) => !r.ok).length,
        total: results.length,
      }),
    );
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

  console.log(
    JSON.stringify({
      ev: 'uptime.persisted',
      checks: checks.length,
      opened: decision.openIncident.length,
      closed: decision.closeIncident.length,
    }),
  );
}
