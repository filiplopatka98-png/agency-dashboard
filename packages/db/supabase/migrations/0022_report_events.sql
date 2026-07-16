-- Štruktúrované fakty k udalostiam (jazyk sa skladá až pri renderovaní) +
-- pracovný denník operátora (manuálne záznamy o vykonanej práci).

alter table change_log add column if not exists payload jsonb;

create table if not exists work_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations on delete cascade,
  site_id uuid not null references sites on delete cascade,
  happened_at date not null default current_date,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists work_log_site_happened_idx on work_log (site_id, happened_at desc);

alter table work_log enable row level security;
drop policy if exists "org members read" on work_log;
drop policy if exists "staff write" on work_log;
create policy "org members read" on work_log for select using (org_id in (select private.user_orgs()));
create policy "staff write" on work_log for all using (org_id in (select private.user_write_orgs())) with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on work_log to authenticated;
grant all on work_log to service_role;
