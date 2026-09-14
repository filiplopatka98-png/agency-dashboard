-- Scheduler Worker beží na Workers Free: max 50 subrequestov a 10 ms CPU na
-- jedno spustenie. Pôvodný tick mal ~49 subrequestov bez kontroly domén a
-- heartbeatu — job_health robil 14 dotazov (1 per job) a email_health 1 + 2
-- per web vrátane ~336 hodinových readingov za 14 dní, ktorých parsovanie bolo
-- najväčšia CPU záťaž. Oboje sa presúva do SQL: 1 RPC = 1 subrequest a v JSON
-- ide len výsledok. Idempotentné (create or replace, cron.schedule podľa mena).

-- 1) Posledný beh každého jobu. Používa ho scheduler (runJobHealth) aj
--    Nastavenia — tie predtým čítali 500 posledných riadkov, čo by pri jobe
--    každých 15 min (scheduler-watchdog) za ~5 dní vytlačilo týždenné joby.
--    Security invoker: prihlásený vidí job_runs cez RLS „authenticated read".
create or replace function latest_job_runs()
returns table (job text, status text, ok int, failed int, error text, finished_at timestamptz)
language sql stable set search_path = public as $$
  select distinct on (j.job) j.job, j.status, j.ok, j.failed, j.error, j.finished_at
  from job_runs j
  order by j.job, j.finished_at desc, j.id desc;
$$;
-- Supabase grantuje EXECUTE anon/authenticated explicitne (default privileges),
-- revoke od PUBLIC ich nezruší — preto aj explicitne (vzor 0025/0027).
revoke all on function latest_job_runs() from public, anon;
grant execute on function latest_job_runs() to authenticated, service_role;

-- 2) Vstupy e-mail health pravidiel 2 a 3: posledný reading každého aktívneho
--    webu (len s providerom) + medián sent_24h > 0 za okno od `_since`. Rovnaká
--    sémantika ako pôvodný TS median(): párny počet → priemer dvoch stredných
--    (= percentile_cont(0.5)), bez histórie → 0.
create or replace function email_health_inputs(_since timestamptz)
returns table (
  site_id uuid, org_id uuid, domain text,
  provider text, sent_1h int, failed_1h int, failed_pct_1h numeric,
  sent_24h int, failed_24h int, last_success_at timestamptz, last_failure_at timestamptz,
  last_failure_message text, queue_depth int, typical_daily_14d double precision
)
language sql stable set search_path = public as $$
  select s.id, s.org_id, s.domain,
         l.provider, l.sent_1h, l.failed_1h, l.failed_pct_1h, l.sent_24h, l.failed_24h,
         l.last_success_at, l.last_failure_at, l.last_failure_message, l.queue_depth,
         coalesce(m.med, 0)
  from sites s
  cross join lateral (
    select w.* from wp_email_health w where w.site_id = s.id order by w.measured_at desc limit 1
  ) l
  cross join lateral (
    select percentile_cont(0.5) within group (order by w.sent_24h) as med
    from wp_email_health w
    where w.site_id = s.id and w.measured_at >= _since and w.sent_24h > 0
  ) m
  where s.is_active and l.provider is not null;
$$;
revoke all on function email_health_inputs(timestamptz) from public, anon, authenticated;
grant execute on function email_health_inputs(timestamptz) to service_role;

-- 3) Časté joby (každých 5/15 min) — ok riadky staršie než 6 h preč, rovnako
--    ako scheduler v 0031 (rovnaké meno cron jobu → prepíše ho). Error riadky
--    ostávajú (30-dňová retencia z 0035).
select cron.schedule('job_runs_retention_scheduler', '*/15 * * * *', $job$
  delete from job_runs
  where job in ('scheduler', 'scheduler-upkeep', 'scheduler-watchdog')
    and status = 'ok' and finished_at < now() - interval '6 hours';
$job$);
