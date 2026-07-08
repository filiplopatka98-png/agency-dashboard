-- RLS na KAŽDEJ tabuľke fázy 1. Autorizáciu v UI robí Supabase (anon key + RLS);
-- service_role (iba scheduler) RLS obchádza.

-- Helper funkcie sú SECURITY DEFINER — čítajú memberships bez RLS, čím sa
-- vyhne nekonečnej rekurzii pri RLS politike na samotnej tabuľke memberships.
create schema if not exists private;

create or replace function private.user_orgs()
  returns setof uuid
  language sql stable security definer set search_path = public
as $$
  select org_id from memberships where user_id = auth.uid()
$$;

create or replace function private.user_write_orgs()
  returns setof uuid
  language sql stable security definer set search_path = public
as $$
  select org_id from memberships
  where user_id = auth.uid() and role in ('owner','staff')
$$;

revoke all on function private.user_orgs() from public;
revoke all on function private.user_write_orgs() from public;
grant execute on function private.user_orgs() to authenticated, anon;
grant execute on function private.user_write_orgs() to authenticated, anon;

-- Explicitné grants (RLS aj tak filtruje riadky). anon (neprihlásený) nedostane nič.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Tabuľky s org_id stĺpcom — uniformná dvojica politík.
do $$
declare t text;
begin
  foreach t in array array[
    'clients','sites','uptime_checks','uptime_daily',
    'incidents','domains','tls_certs','alerts'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "org members read" on %I', t);
    execute format('drop policy if exists "staff write" on %I', t);
    execute format(
      'create policy "org members read" on %I for select '
      || 'using (org_id in (select private.user_orgs()))', t);
    execute format(
      'create policy "staff write" on %I for all '
      || 'using (org_id in (select private.user_write_orgs())) '
      || 'with check (org_id in (select private.user_write_orgs()))', t);
  end loop;
end $$;

-- organizations — kľúč je `id`, nie `org_id`.
alter table organizations enable row level security;
drop policy if exists "org members read" on organizations;
drop policy if exists "staff write" on organizations;
create policy "org members read" on organizations for select
  using (id in (select private.user_orgs()));
create policy "staff write" on organizations for all
  using (id in (select private.user_write_orgs()))
  with check (id in (select private.user_write_orgs()));

-- memberships — má org_id, ale politiky používajú helper (bez self-rekurzie).
alter table memberships enable row level security;
drop policy if exists "org members read" on memberships;
drop policy if exists "staff write" on memberships;
create policy "org members read" on memberships for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on memberships for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));
