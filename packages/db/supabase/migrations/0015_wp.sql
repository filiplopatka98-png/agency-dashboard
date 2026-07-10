-- WordPress agent snapshoty — verzie (WP/PHP/MySQL), pluginy + updaty, téma, záloha,
-- a CVE matica z WPScan (plugin/verzia × známa zraniteľnosť).
-- Zdroj: mu-plugin monitorix-agent (HMAC) + WPScan API.
create table if not exists wp_snapshots (
  site_id uuid primary key references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  wp_version text,
  wp_update text,                  -- dostupná novšia verzia jadra (null = aktuálne)
  php_version text,
  mysql_version text,
  theme text,
  plugins jsonb,                   -- [{name,slug,version,active,update_version}]
  vulns jsonb,                     -- [{target,slug,version,title,cve,severity,fixed_in}]
  backup_at timestamptz,           -- posledná záloha (best-effort, null ak nezistené)
  measured_at timestamptz,
  error text
);

alter table wp_snapshots enable row level security;
drop policy if exists "org members read" on wp_snapshots;
drop policy if exists "staff write" on wp_snapshots;
create policy "org members read" on wp_snapshots for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on wp_snapshots for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on wp_snapshots to authenticated;
grant all on wp_snapshots to service_role;
