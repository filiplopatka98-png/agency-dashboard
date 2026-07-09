-- Performance snapshoty z PageSpeed Insights (lab Lighthouse + field CrUX).
-- Jeden riadok per (web, strategy=mobile|desktop). Fáza 2, tabuľka teraz.
create table if not exists perf_snapshots (
  site_id uuid not null references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  strategy text not null,                 -- 'mobile' | 'desktop'
  performance_score int,
  accessibility int,
  best_practices int,
  seo int,
  lcp_ms int, inp_ms int, cls numeric, tbt_ms int, ttfb_ms int,
  page_weight_kb int, requests int,
  field_lcp_ms int, field_inp_ms int, field_cls numeric,   -- CrUX (reálni návštevníci), nullable
  measured_at timestamptz,
  error text,
  primary key (site_id, strategy)
);

alter table perf_snapshots enable row level security;
drop policy if exists "org members read" on perf_snapshots;
drop policy if exists "staff write" on perf_snapshots;
create policy "org members read" on perf_snapshots for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on perf_snapshots for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on perf_snapshots to authenticated;
grant all on perf_snapshots to service_role;
