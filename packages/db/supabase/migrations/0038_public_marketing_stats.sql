-- Verejné marketingové RPC pre lopatka.sk. LEN anonymné agregáty + výkon jednej
-- (verejne prezentovanej) domény. Žiadne mená/zoznam klientov, financie ani skóre.
-- SECURITY DEFINER + search_path='' (audit vzor). Anon execute (necitlivé dáta).

create or replace function public.public_agency_stats() returns json
language sql security definer set search_path = '' stable as $$
  select json_build_object(
    'sites_monitored',    (select count(*) from public.sites where is_active),
    'avg_uptime_30d',     (select round(avg(uptime_pct),2) from public.uptime_daily
                             where day >= current_date - 30),
    'avg_uptime_90d',     (select round(avg(uptime_pct),2) from public.uptime_daily
                             where day >= current_date - 90),
    'checks_total',       (select coalesce(sum(checks),0) from public.uptime_daily),
    'incidents_resolved', (select count(*) from public.incidents where resolved_at is not null),
    'avg_response_ms',    (select round(avg(avg_ms)) from public.uptime_daily
                             where day >= current_date - 30 and avg_ms is not null),
    'monitoring_since',   (select min(created_at) from public.sites),
    'generated_at',       now()
  );
$$;

create or replace function public.public_site_perf(p_domain text) returns json
language sql security definer set search_path = '' stable as $$
  with s as (
    select id from public.sites
    where domain = lower(regexp_replace(lower(p_domain), '^www\.', '')) and is_active
    limit 1
  ),
  p as (
    select pr.performance_score, pr.accessibility, pr.seo, pr.lcp_ms, pr.measured_at
    from public.perf_runs pr
    join public.monitored_pages mp on mp.id = pr.page_id
    join s on mp.site_id = s.id
    where mp.is_homepage and pr.strategy = 'mobile' and pr.performance_score is not null
    order by pr.measured_at desc limit 1
  ),
  u as (
    select round(avg(uptime_pct),2) as uptime30
    from public.uptime_daily ud join s on ud.site_id = s.id
    where ud.day >= current_date - 30
  )
  select case when not exists (select 1 from s) then null else json_build_object(
    'performance_score', (select performance_score from p),
    'accessibility',     (select accessibility from p),
    'seo',               (select seo from p),
    'lcp_ms',            (select lcp_ms from p),
    'uptime_30d',        (select uptime30 from u),
    'measured_at',       (select measured_at from p)
  ) end;
$$;

grant execute on function public.public_agency_stats() to anon;
grant execute on function public.public_site_perf(text) to anon;

notify pgrst, 'reload schema';
