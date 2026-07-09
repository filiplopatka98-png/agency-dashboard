-- Security snapshoty — bezpečnostné hlavičky (skóre) + Google Safe Browsing.
-- Vuln/CVE matica (plugin × CVE) príde neskôr (WPScan token). Fáza 4, tabuľka teraz.
create table if not exists security_snapshots (
  site_id uuid primary key references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  score int,                       -- 0..100 z security headers
  headers jsonb,                   -- {hsts,csp,xframe,xcto,referrer,permissions} : bool
  safe_browsing_ok boolean,        -- true=čistý · false=nález · null=nezistené
  measured_at timestamptz,
  error text
);

alter table security_snapshots enable row level security;
drop policy if exists "org members read" on security_snapshots;
drop policy if exists "staff write" on security_snapshots;
create policy "org members read" on security_snapshots for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on security_snapshots for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on security_snapshots to authenticated;
grant all on security_snapshots to service_role;
