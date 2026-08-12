-- WP e-mail deliverability monitoring. Append-only readings pushed by the WP
-- agent (event-driven on wp_mail_failed + hourly heartbeat). Aggregates only —
-- NO recipient addresses or message bodies (GDPR); last_failure_message is a
-- truncated, address-stripped string produced agent-side.
create table if not exists wp_email_health (
  id                   uuid primary key default gen_random_uuid(),
  site_id              uuid not null references sites on delete cascade,
  org_id               uuid not null references organizations on delete cascade,
  provider             text,
  sent_1h              int,
  failed_1h            int,
  failed_pct_1h        numeric,
  sent_24h             int,
  failed_24h           int,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  last_failure_message text,
  queue_depth          int,
  source               text not null,           -- 'event' | 'heartbeat'
  measured_at          timestamptz not null default now()
);
create index if not exists wp_email_health_site_measured_idx
  on wp_email_health (site_id, measured_at desc);

alter table wp_email_health enable row level security;
drop policy if exists "org members read" on wp_email_health;
drop policy if exists "staff write" on wp_email_health;
create policy "org members read" on wp_email_health for select
  using (org_id in (select private.user_orgs()));
create policy "staff write" on wp_email_health for all
  using (org_id in (select private.user_write_orgs()))
  with check (
    org_id in (select private.user_write_orgs())
    and site_id in (select id from sites where org_id in (select private.user_write_orgs()))
  );
grant select, insert, update, delete on wp_email_health to authenticated;
grant all on wp_email_health to service_role;

-- Retention: 90 days (rolling readings). Named job → re-run updates, not duplicates.
select cron.schedule('wp_email_health_retention', '40 2 * * *', $job$
  delete from wp_email_health where measured_at < now() - interval '90 days';
$job$);
