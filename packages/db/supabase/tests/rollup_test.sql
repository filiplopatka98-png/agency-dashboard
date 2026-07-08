-- pgTAP test rollup_uptime + retencie. Spustenie: `supabase test db`.
begin;
select plan(7);

-- Fixtures
insert into organizations (id, name) values
  ('cccccccc-0000-0000-0000-000000000001','Rollup Org');
insert into sites (id, org_id, name, url, domain) values
  ('cccccccc-2222-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','W','https://w.sk','w.sk');

-- 4 checky v deň 2026-06-01: 3 ok (100/200/300 ms), 1 fail (null)
insert into uptime_checks (org_id, site_id, checked_at, ok, response_ms) values
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-2222-0000-0000-000000000001','2026-06-01T01:00:00Z',true,100),
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-2222-0000-0000-000000000001','2026-06-01T02:00:00Z',true,200),
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-2222-0000-0000-000000000001','2026-06-01T03:00:00Z',true,300),
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-2222-0000-0000-000000000001','2026-06-01T04:00:00Z',false,null);

select rollup_uptime('2026-06-01'::date);

select is((select checks from uptime_daily where site_id='cccccccc-2222-0000-0000-000000000001'), 4, 'checks = 4');
select is((select up from uptime_daily where site_id='cccccccc-2222-0000-0000-000000000001'), 3, 'up = 3');
select is((select uptime_pct from uptime_daily where site_id='cccccccc-2222-0000-0000-000000000001'), 75.00, 'uptime_pct = 75.00');
select is((select avg_ms from uptime_daily where site_id='cccccccc-2222-0000-0000-000000000001'), 200, 'avg_ms = 200 (ignoruje null)');
select is((select downtime_seconds from uptime_daily where site_id='cccccccc-2222-0000-0000-000000000001'), 300, 'downtime_seconds = 1 fail * 300');

-- Idempotencia: druhý rollup toho istého dňa neduplikuje, prepíše (on conflict)
select rollup_uptime('2026-06-01'::date);
select is((select count(*)::int from uptime_daily where site_id='cccccccc-2222-0000-0000-000000000001'), 1, 'rollup je idempotentný (1 riadok)');

-- Retencia: check starší než 30 dní zmizne, novší ostane
insert into uptime_checks (org_id, site_id, checked_at, ok) values
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-2222-0000-0000-000000000001', now() - interval '40 days', true),
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-2222-0000-0000-000000000001', now() - interval '5 days', true);
delete from uptime_checks where checked_at < now() - interval '30 days';
-- Zostane len 5-dňový check; 40-dňový aj staré júnové (>30 dní) sú preč.
select is(
  (select count(*)::int from uptime_checks where site_id='cccccccc-2222-0000-0000-000000000001'),
  1, 'retencia: iba 5-dňový check ostal (staršie než 30 dní zmazané)');

select * from finish();
rollback;
