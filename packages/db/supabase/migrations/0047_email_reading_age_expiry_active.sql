-- 1) email_health_inputs vracia aj measured_at posledného readingu. Pravidlá
--    email_stuck/email_silent (evaluatePeriodic) bežali nad posledným ULOŽENÝM
--    readingom bez ohľadu na jeho vek — v noci, keď WP-cron bez návštevníkov
--    nepošle heartbeat, sa vyhodnocovali hodiny staré failed_1h (falošný
--    email_stuck 23. 10. 2026 3:23, soccercoacheshub.com). Vek kontroluje
--    TS (EMAIL_READING_MAX_AGE_MIN v @agency/core), SQL len dodá measured_at.
--
--    Návratový typ sa mení → drop + create. 0041 pred svojím create or replace
--    tiež robí drop, inak by re-beh migrate.yml na 0041 zlyhal
--    („cannot change return type of existing function").
--
--    PORADIE: najprv táto migrácia, potom Worker. Starý Worker s ňou funguje
--    (measured_at ignoruje); nový Worker bez nej nedostane measured_at → všetky
--    readingy berie ako bez čerstvých dát a pravidlá 2/3 mlčia (fail-quiet).
drop function if exists email_health_inputs(timestamptz);
create function email_health_inputs(_since timestamptz)
returns table (
  site_id uuid, org_id uuid, domain text,
  provider text, sent_1h int, failed_1h int, failed_pct_1h numeric,
  sent_24h int, failed_24h int, last_success_at timestamptz, last_failure_at timestamptz,
  last_failure_message text, queue_depth int, typical_daily_14d double precision,
  measured_at timestamptz
)
language sql stable set search_path = public as $$
  select s.id, s.org_id, s.domain,
         l.provider, l.sent_1h, l.failed_1h, l.failed_pct_1h, l.sent_24h, l.failed_24h,
         l.last_success_at, l.last_failure_at, l.last_failure_message, l.queue_depth,
         coalesce(m.med, 0), l.measured_at
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

-- 2) Expiry alerty (0007) len pre AKTÍVNE weby. Funkcia brala všetky riadky
--    domains/tls_certs — deaktivovaný web si v nich nechal posledné hodnoty,
--    takže 23. 10. 2026 2:30 prišiel „Profihouse: TLS certifikát expiruje o
--    21 dní", hoci profihouse.sk je od 13. 10. deaktivovaný. Telo je inak
--    zhodné s 0007.
create or replace function insert_expiry_alerts() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Doména (critical). Bucket: tightest prekročený prah.
  insert into alerts (org_id, site_id, type, severity, title, body, dedupe_key)
  select d.org_id, d.site_id, 'domain_expiring', 'critical',
         s.name || ': doména expiruje o ' || (d.expires_at - current_date) || ' dní',
         'Doména ' || d.domain || ' expiruje ' || to_char(d.expires_at,'YYYY-MM-DD')
           || ' (o ' || (d.expires_at - current_date) || ' dní).',
         'site:' || d.site_id || ':domain:' || to_char(d.expires_at,'YYYY-MM-DD') || ':' || b.thr
  from domains d
  join sites s on s.id = d.site_id
  cross join lateral (
    select case
      when d.expires_at - current_date <= 7  then 7
      when d.expires_at - current_date <= 14 then 14
      when d.expires_at - current_date <= 30 then 30
      else null end as thr
  ) b
  where s.is_active
    and d.expires_at is not null and b.thr is not null and d.expires_at >= current_date
  on conflict (dedupe_key) do nothing;

  -- TLS (warning; critical ak ≤ 7 dní).
  insert into alerts (org_id, site_id, type, severity, title, body, dedupe_key)
  select t.org_id, t.site_id, 'tls_expiring',
         (case when b.thr <= 7 then 'critical' else 'warning' end)::alert_severity,
         s.name || ': TLS certifikát expiruje o ' || (t.valid_to::date - current_date) || ' dní',
         'Certifikát pre ' || s.domain || ' expiruje ' || to_char(t.valid_to,'YYYY-MM-DD') || '.',
         'site:' || t.site_id || ':tls:' || to_char(t.valid_to,'YYYY-MM-DD') || ':' || b.thr
  from tls_certs t
  join sites s on s.id = t.site_id
  cross join lateral (
    select case
      when t.valid_to::date - current_date <= 7  then 7
      when t.valid_to::date - current_date <= 21 then 21
      else null end as thr
  ) b
  where s.is_active
    and t.valid_to is not null and b.thr is not null and t.valid_to::date >= current_date
  on conflict (dedupe_key) do nothing;
end $$;
