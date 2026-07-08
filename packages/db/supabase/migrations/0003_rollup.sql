-- Denný rollup uptime_checks → uptime_daily + retencia raw checkov (30 dní).
-- Prehľadová stránka nikdy nečíta uptime_checks za viac než 24 h; všetko dlhšie
-- ide z uptime_daily (bez toho by pri 25 weboch a 90 dňoch skenovala 650k riadkov).

create or replace function rollup_uptime(target_day date) returns void as $$
  insert into uptime_daily (org_id, site_id, day, checks, up, uptime_pct, avg_ms, p95_ms, downtime_seconds)
  select org_id, site_id, target_day,
         count(*), count(*) filter (where ok),
         round(100.0 * count(*) filter (where ok) / nullif(count(*),0), 2),
         avg(response_ms)::int,
         percentile_cont(0.95) within group (order by response_ms)::int,
         (count(*) filter (where not ok)) * 300
  from uptime_checks
  where checked_at >= target_day and checked_at < target_day + 1
  group by org_id, site_id
  on conflict (site_id, day) do update set
    checks = excluded.checks, up = excluded.up, uptime_pct = excluded.uptime_pct,
    avg_ms = excluded.avg_ms, p95_ms = excluded.p95_ms, downtime_seconds = excluded.downtime_seconds;
$$ language sql;

-- pg_cron: rollup včerajška o 02:15 UTC + zmazanie raw checkov starších než 30 dní.
-- cron.schedule je pomenovaný → re-run migrácie job aktualizuje, nezduplikuje.
select cron.schedule('rollup', '15 2 * * *', $job$
  select rollup_uptime((now() - interval '1 day')::date);
  delete from uptime_checks where checked_at < now() - interval '30 days';
$job$);
