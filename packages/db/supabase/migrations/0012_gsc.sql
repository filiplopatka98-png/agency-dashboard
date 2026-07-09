-- Google Search Console snapshoty — reálne výkonnostné čísla vyhľadávania.
-- Kliknutia, impresie, CTR, priemerná pozícia + top dopyty za posledné obdobie.
-- Zdroj: GSC Search Analytics API (service account s webmasters.readonly).
create table if not exists gsc_snapshots (
  site_id uuid primary key references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  clicks int,                      -- súčet kliknutí za obdobie
  impressions int,                 -- súčet impresií
  ctr numeric,                     -- 0..1 (priemerné CTR)
  position numeric,                -- priemerná pozícia
  range_days int,                  -- dĺžka okna (napr. 28)
  top_queries jsonb,               -- [{query,clicks,impressions,ctr,position}]
  property text,                   -- ktorá GSC property sa použila (sc-domain:… / https://…)
  measured_at timestamptz,
  error text
);

alter table gsc_snapshots enable row level security;
drop policy if exists "org members read" on gsc_snapshots;
drop policy if exists "staff write" on gsc_snapshots;
create policy "org members read" on gsc_snapshots for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on gsc_snapshots for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on gsc_snapshots to authenticated;
grant all on gsc_snapshots to service_role;
