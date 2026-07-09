-- AEO (Answer Engine Optimization) snapshoty — deterministické skóre pripravenosti
-- webu pre AI vyhľadávače. Fáza 3, ale tabuľku pridávame teraz (napojenie AEO tabu).
create table if not exists aeo_snapshots (
  site_id uuid primary key references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  score int,                       -- 0..100
  checks jsonb,                    -- [{id,label,pass,weight,earned}]
  schema_types text[],
  has_llms_txt boolean,
  ai_bots jsonb,                   -- {GPTBot:'allow'|'block'|'unset', ...}
  measured_at timestamptz,
  error text
);

alter table aeo_snapshots enable row level security;
drop policy if exists "org members read" on aeo_snapshots;
drop policy if exists "staff write" on aeo_snapshots;
create policy "org members read" on aeo_snapshots for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on aeo_snapshots for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on aeo_snapshots to authenticated;
grant all on aeo_snapshots to service_role;
