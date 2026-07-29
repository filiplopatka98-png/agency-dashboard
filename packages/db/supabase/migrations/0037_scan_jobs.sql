-- On-demand PSI sken (Performance SP2). scan_jobs = stav manuálneho skenu:
-- in-flight zámok proti dvojkliku + rate-limit (60 s) + status pre UI polling.
-- Worker (/scan) píše service_role; UI číta cez JWT (org members read).

create table if not exists scan_jobs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references monitored_pages on delete cascade,
  org_id uuid not null references organizations on delete cascade,
  strategy text not null,                  -- 'mobile' | 'desktop'
  status text not null default 'pending',  -- 'pending' | 'done' | 'error'
  error text,
  requested_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists scan_jobs_page_strategy_requested_idx
  on scan_jobs (page_id, strategy, requested_at desc);

alter table scan_jobs enable row level security;
drop policy if exists "org members read" on scan_jobs;
drop policy if exists "staff write" on scan_jobs;
create policy "org members read" on scan_jobs for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on scan_jobs for all
  using (org_id in (select private.user_write_orgs()))
  with check (org_id in (select private.user_write_orgs()));
grant select, insert, update, delete on scan_jobs to authenticated;
grant all on scan_jobs to service_role;

-- Retencia: len operačné stavy, drž 7 dní. Pomenovaný job → re-run migrácie aktualizuje.
select cron.schedule('scan_jobs_retention', '45 2 * * *', $job$
  delete from scan_jobs where requested_at < now() - interval '7 days';
$job$);
