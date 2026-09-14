-- welltis.com — EN verzia welltis.sk (jedna WP inštalácia s WPML, jazyk podľa
-- domény), 5. web klienta Welltis. Rovnaký vzor ako 0040; riadok je aj v
-- seed-prod.sql.
--
-- `url` je ZÁMERNE https://www.welltis.com, nie https://domain ako pri 0040:
-- apex welltis.com dnes WordPress presmeruje na www.welltis.sk (WPML pozná len
-- www.welltis.com), takže pinger aj PSI by merali slovenskú verziu. `domain`
-- ostáva bez www (RDAP/whois, TLS, párovanie WP pushu podľa hosta).
--
-- Idempotentnosť: čerstvá DB bez organizácií → no-op; web s rovnakou doménou
-- (napr. pridaný cez UI) sa nevloží znova; deaktivovaný web sa neoživí.

do $$
begin
  if exists (select 1 from organizations)
     and not exists (select 1 from organizations where id = '00000000-0000-0000-0000-0000000000a1') then
    raise exception '0042_site_welltis_com: org 00000000-0000-0000-0000-0000000000a1 neexistuje — welltis.com by sa nepridal';
  end if;
end $$;

insert into sites (id, org_id, client_id, name, url, domain, cms)
select '00000000-0000-0000-0000-000000000009'::uuid, o.id,
       (select c.id from clients c
         where c.org_id = o.id and lower(c.name) = 'welltis'
         order by c.created_at limit 1),
       'Welltis (EN)', 'https://www.welltis.com', 'welltis.com', 'wordpress'
from organizations o
where o.id = '00000000-0000-0000-0000-0000000000a1'
  and not exists (select 1 from sites s where s.org_id = o.id and s.domain = 'welltis.com')
on conflict (id) do nothing;
