-- Notifikačné nastavenia per org: zapnutie týždenného digestu / mesačného reportu
-- + zoznam príjemcov (prázdny = fallback na admin ALERT_EMAIL_TO). Zdieľané
-- medzi proaktívnymi alertami (#1) a mesačným reportom (#4).

create table if not exists notification_settings (
  org_id uuid primary key references organizations on delete cascade,
  weekly_digest boolean not null default true,
  monthly_report boolean not null default true,
  recipients text[] not null default '{}',   -- prázdne → fallback admin email
  updated_at timestamptz not null default now()
);

alter table notification_settings enable row level security;
drop policy if exists "org members read" on notification_settings;
drop policy if exists "staff write" on notification_settings;
create policy "org members read" on notification_settings for select using (org_id in (select private.user_orgs()));
create policy "staff write" on notification_settings for all using (org_id in (select private.user_write_orgs())) with check (org_id in (select private.user_write_orgs()));

grant select, insert, update, delete on notification_settings to authenticated;
grant all on notification_settings to service_role;

-- Predvolený riadok pre každý existujúci org (idempotentne).
insert into notification_settings (org_id)
select id from organizations
on conflict (org_id) do nothing;
