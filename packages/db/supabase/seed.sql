-- Seed pre lokálny vývoj a testy. Fixné UUID + on conflict do nothing → idempotentné.
-- 3 fake weby s predvídateľným správaním (httpstat.us) pre test LocalPingera:
--   zdravý (200), trvalý 503, pomalý (~5 s, pod 10 s timeoutom).
-- Reálne weby zo seedu doplní krok 10.

insert into organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'Lopatka Agency')
on conflict (id) do nothing;

insert into clients (id, org_id, name, company, status) values
  ('00000000-0000-0000-0000-0000000000b1',
   '00000000-0000-0000-0000-0000000000a1', 'Demo Klient', 'Demo s.r.o.', 'active')
on conflict (id) do nothing;

insert into sites (id, org_id, client_id, name, url, domain, cms, is_free, expected_string) values
  ('00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   'Zdravý web', 'https://httpstat.us/200', 'httpstat.us', 'static', false, '200 OK'),
  ('00000000-0000-0000-0000-0000000000c2',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   'Padnutý web (503)', 'https://httpstat.us/503', 'httpstat.us', 'other', false, null),
  ('00000000-0000-0000-0000-0000000000c3',
   '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
   'Pomalý web (~5 s)', 'https://httpstat.us/200?sleep=5000', 'httpstat.us', 'other', false, '200 OK')
on conflict (id) do nothing;
