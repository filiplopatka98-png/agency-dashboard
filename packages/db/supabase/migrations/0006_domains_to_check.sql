-- Round-robin výber webov pre doménovú kontrolu: najstarší domains.checked_at
-- (NULL = ešte nekontrolované) ide prvý. Filter na >20 h zabráni hameraniu SK-NIC —
-- keď sú všetky čerstvé, RPC vráti prázdno. Worker spracuje _limit za tick, takže
-- žiadna invokácia neprekročí subrequest/CPU limit (odchýlka od denného blastu).
create or replace function get_domains_to_check(_limit int default 5)
returns table (id uuid, org_id uuid, domain text)
language sql stable security definer set search_path = public as $$
  select s.id, s.org_id, s.domain
  from sites s
  left join domains d on d.site_id = s.id
  where s.is_active
    and (d.checked_at is null or d.checked_at < now() - interval '20 hours')
  order by d.checked_at asc nulls first
  limit greatest(_limit, 0)
$$;

revoke all on function get_domains_to_check(int) from public;
grant execute on function get_domains_to_check(int) to service_role;
