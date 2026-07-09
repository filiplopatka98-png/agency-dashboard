-- Príznak „plánovaná údržba" na webe. Takýto web sa NEpinguje (get_sites_to_check
-- ho vynechá) → žiadne falošné výpadky/incidenty/alerty. UI ho zobrazí ako „Údržba".
alter table sites add column if not exists maintenance boolean not null default false;

-- get_sites_to_check: vynechaj weby v údržbe (okrem is_active).
create or replace function get_sites_to_check()
returns table (
  id uuid, org_id uuid, url text, expected_string text,
  consecutive_failures int, has_open_incident boolean
)
language sql stable security definer set search_path = public as $$
  select s.id, s.org_id, s.url, s.expected_string, s.consecutive_failures,
         exists(select 1 from incidents i where i.site_id = s.id and i.resolved_at is null)
  from sites s
  where s.is_active and not s.maintenance
$$;

revoke all on function get_sites_to_check() from public;
grant execute on function get_sites_to_check() to service_role;
