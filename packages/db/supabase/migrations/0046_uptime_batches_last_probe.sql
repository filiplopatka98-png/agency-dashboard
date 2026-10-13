-- Dávkovanie uptime kontrol (scheduler: uptime v 3 cronoch, každý pingne len
-- svoju dávku webov — apps/scheduler/src/uptimeBatch.ts). Workers Free dáva
-- 10 ms CPU na spustenie a monitor s 10 pingmi mal 12–15 ms.
--
-- Výpadok regiónu (> polovica webov dole = problém u nás) sa musí posudzovať na
-- celej flotile, nie na 4–5 weboch dávky. Preto si každý web pamätá posledný
-- výsledok pingu aj vtedy, keď sa pri region outage nezapisuje uptime_checks
-- ani consecutive_failures (tie sa správajú rovnako ako doteraz).
--
-- Iba schéma a funkcie, žiadne zmeny dát. Idempotentné (migrate.yml aplikuje
-- všetky súbory znova). PORADIE: najprv táto migrácia, potom Worker — starý
-- Worker s ňou funguje (nové stĺpce ignoruje), nový bez nej len posudzuje
-- región na dávke a zaloguje uptime.note_probes_fail.

alter table sites add column if not exists last_probe_ok boolean;
alter table sites add column if not exists last_probe_at timestamptz;

-- Návratový typ sa mení → drop + create (create or replace to nedovolí).
drop function if exists get_sites_to_check();
create function get_sites_to_check()
returns table (
  id uuid, org_id uuid, url text, expected_string text,
  consecutive_failures int, has_open_incident boolean,
  last_probe_ok boolean, last_probe_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, s.org_id, s.url, s.expected_string, s.consecutive_failures,
         exists(select 1 from incidents i where i.site_id = s.id and i.resolved_at is null),
         s.last_probe_ok, s.last_probe_at
  from sites s
  where s.is_active and not s.maintenance
$$;
revoke all on function get_sites_to_check() from public, anon, authenticated;
grant execute on function get_sites_to_check() to service_role;

-- Posledný výsledok pingu bez zápisu checkov/counts (volá runUptime pri region outage).
--   _checks: [{site_id, ok, ...}] — rovnaký tvar ako v persist_uptime
create or replace function note_probes(_checks jsonb)
returns void language sql security definer set search_path = public as $$
  update sites s set
    last_probe_ok = (c->>'ok')::boolean,
    last_probe_at = now()
  from jsonb_array_elements(coalesce(_checks, '[]'::jsonb)) as c
  where s.id = (c->>'site_id')::uuid;
$$;
revoke all on function note_probes(jsonb) from public, anon, authenticated;
grant execute on function note_probes(jsonb) to service_role;

-- persist_uptime (telo z 0005) + krok 2b: posledný výsledok pingu. Rovnaká signatúra.
create or replace function persist_uptime(_checks jsonb, _counts jsonb, _open uuid[], _close uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 1. raw checky
  insert into uptime_checks (org_id, site_id, ok, status_code, response_ms, error)
  select (c->>'org_id')::uuid, (c->>'site_id')::uuid, (c->>'ok')::boolean,
         nullif(c->>'status_code','')::int, nullif(c->>'response_ms','')::int,
         nullif(c->>'error','')
  from jsonb_array_elements(coalesce(_checks,'[]'::jsonb)) as c;

  -- 2. counters + last_checked_at
  update sites s set
    consecutive_failures = (cnt->>'failures')::int,
    last_checked_at = now()
  from jsonb_array_elements(coalesce(_counts,'[]'::jsonb)) as cnt
  where s.id = (cnt->>'site_id')::uuid;

  -- 2b. posledný výsledok pingu (region outage naprieč dávkami)
  update sites s set
    last_probe_ok = (c->>'ok')::boolean,
    last_probe_at = now()
  from jsonb_array_elements(coalesce(_checks,'[]'::jsonb)) as c
  where s.id = (c->>'site_id')::uuid;

  -- 3. otvorenie incidentov + site_down alert (critical)
  with opened as (
    insert into incidents (org_id, site_id, last_status_code)
    select (c->>'org_id')::uuid, (c->>'site_id')::uuid, nullif(c->>'status_code','')::int
    from jsonb_array_elements(coalesce(_checks,'[]'::jsonb)) as c
    where (c->>'site_id')::uuid = any(coalesce(_open,'{}'::uuid[]))
    on conflict (site_id) where (resolved_at is null) do nothing
    returning id, org_id, site_id
  )
  insert into alerts (org_id, site_id, type, severity, title, body, dedupe_key)
  select o.org_id, o.site_id, 'site_down', 'critical',
         s.name || ' je nedostupný',
         'Web ' || s.name || ' (' || s.domain || ') je nedostupný — dve po sebe idúce zlyhania.',
         'site:' || o.site_id || ':down:' || o.id
  from opened o join sites s on s.id = o.site_id
  on conflict (dedupe_key) do nothing;

  -- 4. zatvorenie incidentov + site_up alert (info)
  with closed as (
    update incidents i set
      resolved_at = now(),
      duration_seconds = extract(epoch from (now() - i.started_at))::int
    where i.site_id = any(coalesce(_close,'{}'::uuid[])) and i.resolved_at is null
    returning i.id, i.org_id, i.site_id, i.duration_seconds
  )
  insert into alerts (org_id, site_id, type, severity, title, body, dedupe_key)
  select c.org_id, c.site_id, 'site_up', 'info',
         s.name || ' je opäť dostupný',
         'Web ' || s.name || ' (' || s.domain || ') je opäť dostupný. Výpadok trval '
           || coalesce(c.duration_seconds, 0) || ' s.',
         'site:' || c.site_id || ':up:' || c.id
  from closed c join sites s on s.id = c.site_id
  on conflict (dedupe_key) do nothing;
end $$;

-- Retencia častých heartbeatov (0044) + nové crony uptime dávok B/C.
-- Rovnaké meno cron jobu → prepíše 0044.
select cron.schedule('job_runs_retention_scheduler', '*/15 * * * *', $job$
  delete from job_runs
  where finished_at < now() - interval '6 hours'
    and (
      (job in ('scheduler', 'scheduler-uptime-b', 'scheduler-uptime-c', 'scheduler-upkeep', 'scheduler-watchdog') and status = 'ok')
      or job in ('scheduler:start', 'scheduler-uptime-b:start', 'scheduler-uptime-c:start', 'scheduler-upkeep:start')
    );
$job$);
