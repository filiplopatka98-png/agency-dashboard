-- PROD seed — reálna agentúra + klienti + weby (idempotentný, on conflict do nothing).
-- Púšťaj na PROD Supabase RAZ po migráciách:
--   psql "$SUPABASE_DB_URL" -f packages/db/supabase/seed-prod.sql
-- (NIE seed.sql — ten má fake httpstat.us test weby pre lokálny vývoj.)
-- Fixné UUID → bezpečné opakovať; collectory (uptime/PSI/GSC/…) si dáta doplnia samy.

insert into organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Lopatka — webová agentúra')
on conflict (id) do nothing;

insert into clients (id, org_id, name, company, contract_type, monthly_fee_eur, status) values
  ('000000cc-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Lopatka',          'Filip Lopatka', 'Vlastný',  0.00,  'active'),
  ('000000cc-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'Krivošík',         'Krivošík',      'Standard', 39.00, 'active'),
  ('000000cc-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'Profihouse',       'Profihouse',    'Standard', 39.00, 'active'),
  ('000000cc-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'Kuko detský svet', 'Kuko',          'Standard', 39.00, 'active')
on conflict (id) do nothing;

insert into sites (id, org_id, client_id, name, url, domain, cms, is_free, expected_string) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '000000cc-0000-0000-0000-000000000001', 'Lopatka portfólio', 'https://lopatka.sk',        'lopatka.sk',        'static',    true,  null),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '000000cc-0000-0000-0000-000000000002', 'Krivošík',          'https://krivosik.sk',       'krivosik.sk',       'wordpress', false, null),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', '000000cc-0000-0000-0000-000000000003', 'Profihouse',        'https://profihouse.sk',     'profihouse.sk',     'wordpress', false, null),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', '000000cc-0000-0000-0000-000000000004', 'Kuko detský svet',  'https://kukodetskysvet.sk', 'kukodetskysvet.sk', 'wordpress', false, null)
on conflict (id) do nothing;
