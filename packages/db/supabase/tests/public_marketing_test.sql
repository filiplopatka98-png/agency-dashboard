-- pgTAP: verejné marketingové RPC (public_agency_stats, public_site_perf).
-- Spustenie: `pnpm --filter @agency/db exec supabase test db`.
begin;
select plan(7);

-- Fixtures (superuser → RLS sa obchádza). Site insert cez trigger 0036 založí
-- homepage monitored_pages automaticky, preto perf_runs vieme naň naviazať.
insert into organizations (id, name) values
  ('cccccccc-0000-0000-0000-000000000001','Org C');
insert into sites (id, org_id, name, url, domain, is_active, created_at) values
  ('cccccccc-2222-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',
   'Web C','https://c.test.sk','c.test.sk', true, now() - interval '400 days');
insert into uptime_daily (org_id, site_id, day, checks, up, uptime_pct, avg_ms) values
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-2222-0000-0000-000000000001',
   current_date - 1, 288, 288, 100.00, 210),
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-2222-0000-0000-000000000001',
   current_date - 2, 288, 286, 99.31, 230);
insert into incidents (org_id, site_id, started_at, resolved_at) values
  ('cccccccc-0000-0000-0000-000000000001','cccccccc-2222-0000-0000-000000000001',
   now() - interval '10 days', now() - interval '10 days' + interval '5 min');
insert into perf_runs (page_id, org_id, strategy, performance_score, accessibility, seo, lcp_ms)
  select mp.id, mp.org_id, 'mobile', 95, 99, 98, 1180
  from monitored_pages mp
  where mp.site_id = 'cccccccc-2222-0000-0000-000000000001' and mp.is_homepage;

-- json (na rozdiel od jsonb) nemá operátor `=`, preto porovnávame ::text.
select isnt(public_agency_stats()::text, null, 'public_agency_stats vracia JSON');
select ok((public_agency_stats()->>'sites_monitored')::int >= 1, 'sites_monitored >= 1');
select isnt(public_site_perf('c.test.sk')::text, null, 'public_site_perf pre c.test.sk');
select is((public_site_perf('c.test.sk')->>'performance_score')::int, 95, 'performance_score = 95');
select is(public_site_perf('neexistuje.sk')::text, null, 'neexistujúca doména vracia null');
select ok(has_function_privilege('anon','public.public_agency_stats()','execute'),
  'anon môže spustiť public_agency_stats');
select is((public_site_perf('WWW.c.test.sk')->>'performance_score')::int, 95,
  'uppercase WWW. prefix sa strippuje case-insensitive a resolvuje na rovnaký web');

select * from finish();
rollback;
