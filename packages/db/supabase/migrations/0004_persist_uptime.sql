-- RPC funkcie pre scheduler. Cieľ: celý beh = 2 subrequesty do Supabase
-- (get_sites_to_check + persist_uptime), nie 25. Subrequest limit na Free je 50.
-- Rozhodovacia logika (incidenty) ostáva v core.decideIncidents (testované);
-- tieto funkcie len číšajú/zapisujú.

-- Aktívne weby + či majú otvorený incident (pre decideIncidents stav).
create or replace function get_sites_to_check()
returns table (
  id uuid, org_id uuid, url text, expected_string text,
  consecutive_failures int, has_open_incident boolean
)
language sql stable security definer set search_path = public as $$
  select s.id, s.org_id, s.url, s.expected_string, s.consecutive_failures,
         exists(select 1 from incidents i where i.site_id = s.id and i.resolved_at is null)
  from sites s
  where s.is_active
$$;

-- Atomický zápis jednej dávky: raw checky + counters + otvorenie/zatvorenie incidentov.
--   _checks: [{site_id, org_id, ok, status_code, response_ms, error}]
--   _counts: [{site_id, failures}]  (finálny consecutive_failures z decideIncidents)
--   _open / _close: uuid[] siteIds
create or replace function persist_uptime(_checks jsonb, _counts jsonb, _open uuid[], _close uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 1. raw checky (jeden batch insert)
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

  -- 3. otvorenie incidentov (partial unique index chráni pred race medzi behmi)
  insert into incidents (org_id, site_id, last_status_code)
  select (c->>'org_id')::uuid, (c->>'site_id')::uuid, nullif(c->>'status_code','')::int
  from jsonb_array_elements(coalesce(_checks,'[]'::jsonb)) as c
  where (c->>'site_id')::uuid = any(coalesce(_open,'{}'::uuid[]))
  on conflict (site_id) where (resolved_at is null) do nothing;

  -- 4. zatvorenie incidentov + výpočet trvania
  update incidents i set
    resolved_at = now(),
    duration_seconds = extract(epoch from (now() - i.started_at))::int
  where i.site_id = any(coalesce(_close,'{}'::uuid[])) and i.resolved_at is null;
end $$;

-- Iba scheduler (service_role) smie tieto funkcie volať.
revoke all on function get_sites_to_check() from public;
revoke all on function persist_uptime(jsonb, jsonb, uuid[], uuid[]) from public;
grant execute on function get_sites_to_check() to service_role;
grant execute on function persist_uptime(jsonb, jsonb, uuid[], uuid[]) to service_role;
