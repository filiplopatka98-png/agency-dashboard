-- Alerty pre site_down / site_up vznikajú ATOMICKY s otvorením/zatvorením
-- incidentu (v tej istej persist_uptime transakcii). Dedupe = unique index na
-- alerts.dedupe_key (ON CONFLICT DO NOTHING) — reštart workera nevyrobí duplicitu.
-- Odoslanie mailu rieši scheduler (runAlerts) samostatne: číta alerts.sent_at IS NULL.

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
