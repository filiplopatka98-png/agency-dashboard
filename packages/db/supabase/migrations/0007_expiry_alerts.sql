-- Expiry alerty (doména 30/14/7 dní, TLS 21/7 dní) ako SQL funkcia spúšťaná
-- denne cez pg_cron. Insert alert riadkov s dedupe cez unique index (alerts.dedupe_key);
-- odoslanie mailu rieši scheduler runAlerts. Bucket logika = práve JEDEN alert na
-- prah pri jeho prekročení (robustné aj keď cron deň vynechá — dedupe drží 1×).

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
  where d.expires_at is not null and b.thr is not null and d.expires_at >= current_date
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
  where t.valid_to is not null and b.thr is not null and t.valid_to::date >= current_date
  on conflict (dedupe_key) do nothing;
end $$;

select cron.schedule('expiry-alerts', '30 2 * * *', $job$ select insert_expiry_alerts(); $job$);
