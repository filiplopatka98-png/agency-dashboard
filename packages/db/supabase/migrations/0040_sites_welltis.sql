-- Nový klient Welltis (Welltis Group) + jeho 4 weby — všetky WordPress
-- (bytylazovna.sk je developerský projekt Welltis Group).
--
-- DÁTOVÁ migrácia: weby sa inak pridávajú cez UI alebo seed-prod.sql (psql so
-- SUPABASE_DB_URL). Cez migráciu ich do produkcie dostane aj agent bez DB hesla
-- — migrate.yml ju aplikuje zo secrets. Rovnaké riadky sú aj v seed-prod.sql.
--
-- Idempotentnosť (migrate.yml púšťa VŠETKY migrácie pri každom behu):
--   • čerstvá DB bez organizácií (lokálny `db reset` — org vzniká až v seede)
--     → no-op,
--   • klient/web sa nevloží, ak už existuje (fixné UUID alebo rovnaký
--     názov/doména — napr. keď ho medzičasom niekto pridal cez UI),
--   • deaktivovaný web (UI robí soft delete `is_active = false`) sa neoživí.
-- `domain` bez www (RDAP/whois); `url` = https://domain ako pri UI inserte —
-- pinger aj PSI nasledujú redirect na www.

-- Poistka: existujú organizácie, ale nie agentúrna z seed-prod → inserty nižšie
-- by prešli ako ticho prázdne. Radšej nech migrate workflow zlyhá nahlas.
do $$
begin
  if exists (select 1 from organizations)
     and not exists (select 1 from organizations where id = '00000000-0000-0000-0000-0000000000a1') then
    raise exception '0040_sites_welltis: org 00000000-0000-0000-0000-0000000000a1 neexistuje — weby Welltis by sa nepridali';
  end if;
end $$;

insert into clients (id, org_id, name, company, status)
select '000000cc-0000-0000-0000-000000000005', o.id, 'Welltis', 'Welltis Group', 'active'
from organizations o
where o.id = '00000000-0000-0000-0000-0000000000a1'
  and not exists (select 1 from clients c where c.org_id = o.id and lower(c.name) = 'welltis')
on conflict (id) do nothing;

insert into sites (id, org_id, client_id, name, url, domain, cms)
select v.id, o.id,
       (select c.id from clients c
         where c.org_id = o.id and lower(c.name) = 'welltis'
         order by c.created_at limit 1),
       v.name, 'https://' || v.domain, v.domain, 'wordpress'
from organizations o
cross join (values
  ('00000000-0000-0000-0000-000000000005'::uuid, 'Welltis',            'welltis.sk'),
  ('00000000-0000-0000-0000-000000000006'::uuid, 'Byty Lazovná',       'bytylazovna.sk'),
  ('00000000-0000-0000-0000-000000000007'::uuid, 'Welltis Group (SK)', 'welltisgroup.sk'),
  ('00000000-0000-0000-0000-000000000008'::uuid, 'Welltis Group (EN)', 'welltisgroup.com')
) as v(id, name, domain)
where o.id = '00000000-0000-0000-0000-0000000000a1'
  and not exists (select 1 from sites s where s.org_id = o.id and s.domain = v.domain)
on conflict (id) do nothing;
