import { diffCore, diffPlugins, emailHealthPayloadSchema, readingFromPayload, evaluateIngest, type ChangeEvent } from '@agency/core';
import type { Env } from './env';
import { serviceClient } from './supabase';

interface WpPayload {
  url?: string;
  wp_version?: string | null;
  wp_update?: string | null;
  php_version?: string | null;
  mysql_version?: string | null;
  theme?: string | null;
  plugins?: unknown;
  backup_at?: string | null;
  agent_version?: string;
  email_health?: unknown;
}

const host = (u: string): string => {
  try {
    return new URL(u).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return u.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase();
  }
};

/**
 * WP agent push endpoint — plugin sám posiela svoj stav (verzie/pluginy/updaty).
 * Autentifikácia: zdieľaný token (X-Monitorix-Token) zapečený v plugine. Web sa páruje
 * podľa domény; zapíše sa len ak je aktívny web v DB. `vulns` sa NEprepisuje (CVE rieši
 * samostatný krok), preto nie je v upserte.
 */
export async function wpIngest(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get('x-monitorix-token') ?? '';
  if (!env.WP_INGEST_TOKEN || token !== env.WP_INGEST_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  let body: WpPayload;
  try {
    body = (await request.json()) as WpPayload;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  if (!body.url) return new Response(JSON.stringify({ error: 'url required' }), { status: 400, headers: { 'content-type': 'application/json' } });

  const db = serviceClient(env);
  const h = host(body.url);
  const { data: sites } = await db.from('sites').select('id, org_id, domain').eq('is_active', true);
  const site = (sites ?? []).find((s) => host(`https://${s.domain}`) === h);
  if (!site) {
    return new Response(JSON.stringify({ error: 'site not found', host: h }), { status: 404, headers: { 'content-type': 'application/json' } });
  }

  // Diff pred prepísaním snapshotu — inak sa stará verzia stratí. Prvý ingest
  // (žiadny predchádzajúci riadok) zámerne nelogujeme.
  const { data: prevSnap, error: prevErr } = await db
    .from('wp_snapshots')
    .select('wp_version, plugins')
    .eq('site_id', site.id)
    .maybeSingle();
  if (prevErr) console.log(JSON.stringify({ ev: 'wp.prev_read_fail', message: prevErr.message }));

  // Diff funkcie čítajú nedôveryhodný jsonb stĺpec (`prevSnap.plugins`) — sú defenzívne,
  // ale keby aj napriek tomu niečo prehodili, diff je len "pekné-mať" a nesmie zhodiť
  // ingest (upsert nižšie musí prebehnúť, aby sa prípadný zlý riadok prepísal).
  let events: ChangeEvent[] = [];
  if (prevSnap) {
    try {
      events = [
        ...diffCore(prevSnap.wp_version, body.wp_version ?? null),
        ...diffPlugins(prevSnap.plugins, body.plugins ?? []),
      ];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(JSON.stringify({ ev: 'wp.diff_fail', message }));
    }
  }

  const { error } = await db.from('wp_snapshots').upsert(
    {
      site_id: site.id,
      org_id: site.org_id,
      wp_version: body.wp_version ?? null,
      wp_update: body.wp_update ?? null,
      php_version: body.php_version ?? null,
      mysql_version: body.mysql_version ?? null,
      theme: body.theme ?? null,
      plugins: body.plugins ?? [],
      backup_at: body.backup_at ?? null,
      measured_at: new Date().toISOString(),
      error: null,
    },
    { onConflict: 'site_id' },
  );
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }

  // E-mail deliverability (best-effort; must never fail the ingest). The payload
  // is untrusted → Zod at the boundary. source distinguishes the wp_mail_failed
  // event push from the hourly heartbeat.
  if (body.email_health !== undefined) {
    try {
      const parsed = emailHealthPayloadSchema.safeParse(body.email_health);
      if (!parsed.success) {
        console.log(JSON.stringify({ ev: 'wp.email_health_invalid', site_id: site.id, issues: parsed.error.issues.length }));
      } else {
        const reading = readingFromPayload(parsed.data);
        const source = request.headers.get('x-monitorix-source') === 'event' ? 'event' : 'heartbeat';
        const { error: ehErr } = await db.from('wp_email_health').insert({
          site_id: site.id,
          org_id: site.org_id,
          provider: reading.provider,
          sent_1h: reading.sent_1h,
          failed_1h: reading.failed_1h,
          failed_pct_1h: reading.failed_pct_1h,
          sent_24h: reading.sent_24h,
          failed_24h: reading.failed_24h,
          last_success_at: reading.last_success_at,
          last_failure_at: reading.last_failure_at,
          last_failure_message: reading.last_failure_message,
          queue_depth: reading.queue_depth,
          source,
        });
        if (ehErr) console.log(JSON.stringify({ ev: 'wp.email_health_insert_fail', site_id: site.id, message: ehErr.message }));

        // Rule 1 at ingest → fastest path for the acute case.
        const alerts = evaluateIngest(reading, { siteId: site.id, domain: site.domain, now: new Date() });
        if (alerts.length) {
          const { error: aErr } = await db.from('alerts').upsert(
            alerts.map((a) => ({ org_id: site.org_id, site_id: site.id, type: a.type, severity: a.severity, title: a.title, body: a.body, dedupe_key: a.dedupeKey })),
            { onConflict: 'dedupe_key', ignoreDuplicates: true },
          );
          if (aErr) console.log(JSON.stringify({ ev: 'wp.email_alert_fail', site_id: site.id, message: aErr.message }));
          else console.log(JSON.stringify({ ev: 'wp.email_alert', site_id: site.id, types: alerts.map((a) => a.type) }));
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(JSON.stringify({ ev: 'wp.email_health_error', site_id: site.id, message }));
    }
  }

  // Zápis udalostí je best-effort — nesmie zhodiť ingest (dáta > zoznam udalostí).
  if (events.length) {
    const { error: logErr } = await db.from('change_log').insert(
      events.map((e) => ({
        site_id: site.id,
        org_id: site.org_id,
        kind: e.kind,
        severity: e.severity,
        message: e.message,
        payload: e.payload as unknown as Record<string, unknown>,
      })),
    );
    if (logErr) console.log(JSON.stringify({ ev: 'wp.changelog_fail', message: logErr.message }));
  }

  console.log(JSON.stringify({ ev: 'wp.ingest', domain: site.domain, wp: body.wp_version }));
  return new Response(JSON.stringify({ ok: true, matched: site.domain }), { status: 200, headers: { 'content-type': 'application/json' } });
}
