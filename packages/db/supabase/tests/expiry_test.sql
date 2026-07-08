-- pgTAP test insert_expiry_alerts. Spustenie: `supabase test db`.
-- Dátumy relatívne k current_date → stabilné bez ohľadu na deň spustenia.
begin;
select plan(7);

insert into organizations (id, name) values ('dddddddd-0000-0000-0000-000000000001','Expiry Org');
insert into sites (id, org_id, name, url, domain) values
  ('dddddddd-2222-0000-0000-00000000000a','dddddddd-0000-0000-0000-000000000001','A','https://a.sk','a.sk'),
  ('dddddddd-2222-0000-0000-00000000000b','dddddddd-0000-0000-0000-000000000001','B','https://b.sk','b.sk'),
  ('dddddddd-2222-0000-0000-00000000000c','dddddddd-0000-0000-0000-000000000001','C','https://c.sk','c.sk'),
  ('dddddddd-2222-0000-0000-00000000000d','dddddddd-0000-0000-0000-000000000001','D','https://d.sk','d.sk');

-- doména: A o 5 dní (→ :7 critical), B o 40 dní (→ žiadny)
insert into domains (site_id, org_id, domain, expires_at, source) values
  ('dddddddd-2222-0000-0000-00000000000a','dddddddd-0000-0000-0000-000000000001','a.sk', current_date + 5, 'whois43'),
  ('dddddddd-2222-0000-0000-00000000000b','dddddddd-0000-0000-0000-000000000001','b.sk', current_date + 40, 'whois43');

-- TLS: C o 20 dní (→ :21 warning), D o 5 dní (→ :7 critical)
insert into tls_certs (site_id, org_id, valid_to, source) values
  ('dddddddd-2222-0000-0000-00000000000c','dddddddd-0000-0000-0000-000000000001', now() + interval '20 days', 'probe'),
  ('dddddddd-2222-0000-0000-00000000000d','dddddddd-0000-0000-0000-000000000001', now() + interval '5 days', 'probe');

select insert_expiry_alerts();

select is((select count(*)::int from alerts where type='domain_expiring'), 1,
  'domain_expiring: len A (5 dní), B (40 dní) nie');
select is((select severity::text from alerts where type='domain_expiring'), 'critical',
  'domain_expiring je critical');
select ok((select dedupe_key from alerts where type='domain_expiring') like '%:7',
  'domain dedupe_key má prah :7 (5 dní → tightest bucket)');

select is((select count(*)::int from alerts where type='tls_expiring'), 2,
  'tls_expiring: C aj D');
select is((select severity::text from alerts where type='tls_expiring' and site_id='dddddddd-2222-0000-0000-00000000000c'),
  'warning', 'TLS 20 dní → warning (:21)');
select is((select severity::text from alerts where type='tls_expiring' and site_id='dddddddd-2222-0000-0000-00000000000d'),
  'critical', 'TLS 5 dní → critical (:7)');

-- idempotencia: druhé volanie neduplikuje
select insert_expiry_alerts();
select is((select count(*)::int from alerts where type in ('domain_expiring','tls_expiring')), 3,
  'druhé volanie neduplikuje (dedupe): stále 3 alerty');

select * from finish();
rollback;
