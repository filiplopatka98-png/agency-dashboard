-- Per-page PSI monitoring + denná história (Performance overhaul SP1).
-- monitored_pages = entita stránky (homepage auto + ručne pridané); perf_runs =
-- append-only história meraní (skóre + vitals + FCP + CrUX + opportunities).
-- perf_snapshots (latest, per-web) ostáva NEZMENENÉ — psi-probe ho pre homepage
-- naďalej upsertuje kvôli spätnej kompatibilite existujúcich konzumentov.

create table if not exists monitored_pages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  url text not null,                       -- plná URL vrátane https://
  is_homepage boolean not null default false,
  active boolean not null default true,
  added_at timestamptz not null default now(),
  unique (site_id, url)
);

alter table monitored_pages enable row level security;
drop policy if exists "org members read" on monitored_pages;
drop policy if exists "staff write" on monitored_pages;
create policy "org members read" on monitored_pages for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on monitored_pages for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));
grant select, insert, update, delete on monitored_pages to authenticated;
grant all on monitored_pages to service_role;

-- Seed homepage pre každý web (idempotentné). sites.url je plná URL.
insert into monitored_pages (site_id, org_id, url, is_homepage)
  select s.id, s.org_id, s.url, true from sites s
  on conflict (site_id, url) do nothing;

create table if not exists perf_runs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references monitored_pages on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  strategy text not null,                  -- 'mobile' | 'desktop'
  performance_score int, accessibility int, best_practices int, seo int,
  lcp_ms int, fcp_ms int, inp_ms int, cls numeric, tbt_ms int, ttfb_ms int,
  page_weight_kb int, requests int,
  field_lcp_ms int, field_inp_ms int, field_cls numeric,
  opportunities jsonb not null default '[]' check (jsonb_typeof(opportunities) = 'array'),
  measured_at timestamptz not null default now(),
  error text
);
create index if not exists perf_runs_page_strategy_measured_idx
  on perf_runs (page_id, strategy, measured_at desc);

alter table perf_runs enable row level security;
drop policy if exists "org members read" on perf_runs;
drop policy if exists "staff write" on perf_runs;
create policy "org members read" on perf_runs for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on perf_runs for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));
grant select, insert, update, delete on perf_runs to authenticated;
grant all on perf_runs to service_role;

-- Retencia: denné záznamy, drž 1 rok (owner rozhodnutie). Pomenovaný job →
-- re-run migrácie aktualizuje, nezduplikuje.
select cron.schedule('perf_runs_retention', '35 2 * * *', $job$
  delete from perf_runs where measured_at < now() - interval '365 days';
$job$);
