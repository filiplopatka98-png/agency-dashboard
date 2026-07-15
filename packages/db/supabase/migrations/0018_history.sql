-- História metrík (pre trendy) + log veľkých zmien (pre feed „čo sa zmenilo").
-- Napĺňa týždenný history job z aktuálnych snapshotov; retencia cez pg_cron.

create table if not exists metric_history (
  id bigint generated always as identity primary key,
  site_id uuid not null references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  metric text not null,              -- 'aeo' | 'security' | 'perf_mobile' | 'perf_desktop' | 'seo_issues' | 'gsc_clicks' | 'gsc_impressions' | 'gsc_position' | 'wp_vulns'
  value numeric,
  captured_at timestamptz not null default now()
);
create index if not exists metric_history_site_metric_idx on metric_history (site_id, metric, captured_at desc);

create table if not exists change_log (
  id bigint generated always as identity primary key,
  site_id uuid references sites on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  kind text not null,                -- 'score' | 'cve' | 'status' | 'expiry' | 'update' | 'seo'
  severity text not null default 'info', -- 'info' | 'warning' | 'critical'
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists change_log_org_created_idx on change_log (org_id, created_at desc);
create index if not exists change_log_site_created_idx on change_log (site_id, created_at desc);

alter table metric_history enable row level security;
alter table change_log enable row level security;
drop policy if exists "org members read" on metric_history;
drop policy if exists "staff write" on metric_history;
drop policy if exists "org members read" on change_log;
drop policy if exists "staff write" on change_log;
create policy "org members read" on metric_history for select using (org_id in (select private.user_orgs()));
create policy "staff write" on metric_history for all using (org_id in (select private.user_write_orgs())) with check (org_id in (select private.user_write_orgs()));
create policy "org members read" on change_log for select using (org_id in (select private.user_orgs()));
create policy "staff write" on change_log for all using (org_id in (select private.user_write_orgs())) with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on metric_history to authenticated;
grant select, insert, update, delete on change_log to authenticated;
grant all on metric_history to service_role;
grant all on change_log to service_role;

-- Retencia: metriky rok, log 6 mesiacov.
select cron.schedule('history_retention', '25 2 * * *', $job$
  delete from metric_history where captured_at < now() - interval '365 days';
  delete from change_log where created_at < now() - interval '180 days';
$job$);
