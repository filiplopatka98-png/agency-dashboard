-- Verejná status page: história vyriešených výpadkov (90 dní) + dôkaz dohľadu.
-- Naďalej LEN dostupnosť — žiadne verzie, CVE, skóre ani denník.

create or replace function public_client_status(p_slug text) returns json
language sql security definer set search_path = public stable as $$
  with c as (
    select id, coalesce(nullif(name,''), company, 'Klient') as label
    from clients where slug = p_slug and status_enabled = true
  ),
  s as (
    select st.id, st.domain, st.maintenance, st.consecutive_failures,
           exists (select 1 from incidents i where i.site_id = st.id and i.resolved_at is null) as has_incident,
           (select round(avg(ud.uptime_pct)::numeric, 2) from uptime_daily ud
              where ud.site_id = st.id and ud.day >= (current_date - 30)) as uptime30
    from sites st join c on st.client_id = c.id
    where st.is_active = true
  ),
  hist as (
    select ud.site_id,
           json_agg(json_build_object('d', to_char(ud.day, 'YYYY-MM-DD'), 'u', ud.uptime_pct) order by ud.day) as days
    from uptime_daily ud join s on s.id = ud.site_id
    where ud.day >= (current_date - 90)
    group by ud.site_id
  ),
  vig as (
    select ud.site_id, sum(ud.checks)::bigint as checks, round(avg(ud.uptime_pct)::numeric, 2) as uptime_pct
    from uptime_daily ud join s on s.id = ud.site_id
    where ud.day >= (current_date - 90)
    group by ud.site_id
  ),
  inc as (
    select i.site_id,
           json_agg(json_build_object(
             'started_at', i.started_at,
             'minutes', greatest(1, round(extract(epoch from (i.resolved_at - i.started_at)) / 60))
           ) order by i.started_at desc) as items
    from incidents i join s on s.id = i.site_id
    where i.resolved_at is not null and i.started_at >= (now() - interval '90 days')
    group by i.site_id
  )
  select case when not exists (select 1 from c) then null else json_build_object(
    'client', (select label from c),
    'generated_at', now(),
    'sites', coalesce((select json_agg(json_build_object(
        'domain', s.domain,
        'status', case when s.maintenance then 'maintenance'
                       when s.consecutive_failures >= 2 or s.has_incident then 'down'
                       else 'up' end,
        'uptime30', s.uptime30,
        'history', coalesce((select h.days from hist h where h.site_id = s.id), '[]'::json),
        'vigilance', (select json_build_object('checks', v.checks, 'uptime_pct', v.uptime_pct) from vig v where v.site_id = s.id),
        'incidents', coalesce((select i.items from inc i where i.site_id = s.id), '[]'::json)
      ) order by s.domain) from s), '[]'::json)
  ) end;
$$;

grant execute on function public_client_status(text) to anon, authenticated;
