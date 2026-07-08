-- pgTAP RLS test. Spustenie: `supabase test db`.
-- Dokazuje org izoláciu: user org A nevidí ani nezapíše dáta org B.
begin;
select plan(6);

-- ── Fixtures (beží ako superuser → RLS sa obchádza pri príprave) ────────────
insert into auth.users (id, instance_id, email, aud, role) values
  ('aaaaaaaa-1111-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','a@test.sk','authenticated','authenticated'),
  ('bbbbbbbb-1111-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','b@test.sk','authenticated','authenticated');

insert into organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000001','Org B');

insert into memberships (org_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','staff'),
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-1111-0000-0000-000000000001','staff');

insert into sites (id, org_id, name, url, domain) values
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Web A','https://a.test.sk','a.test.sk'),
  ('bbbbbbbb-2222-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Web B','https://b.test.sk','b.test.sk');

-- ── Act as user A ───────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaaa-1111-0000-0000-000000000001','role','authenticated')::text, true);

select is((select count(*) from sites)::int, 1,
  'user A vidí presne 1 web (len svojej org)');
select is((select count(*) from sites where org_id = 'bbbbbbbb-0000-0000-0000-000000000001')::int, 0,
  'user A nevidí žiadny web org B');
select is((select count(*) from organizations)::int, 1,
  'user A vidí len svoju organizáciu');

-- zápis do cudzej org musí zlyhať (with check policy)
select throws_ok(
  $$insert into sites (org_id, name, url, domain)
    values ('bbbbbbbb-0000-0000-0000-000000000001','Hack','https://x.sk','x.sk')$$,
  '42501',
  null,
  'user A nemôže zapísať web do org B (RLS with check)');

-- zápis do vlastnej org musí prejsť
select lives_ok(
  $$insert into sites (org_id, name, url, domain)
    values ('aaaaaaaa-0000-0000-0000-000000000001','Web A2','https://a2.test.sk','a2.test.sk')$$,
  'user A môže zapísať web do vlastnej org');

-- ── Act as user B ───────────────────────────────────────────────────────────
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','bbbbbbbb-1111-0000-0000-000000000001','role','authenticated')::text, true);

select is((select count(*) from sites)::int, 1,
  'user B vidí presne 1 web (Web A2 z org A je preň neviditeľný)');

select * from finish();
rollback;
