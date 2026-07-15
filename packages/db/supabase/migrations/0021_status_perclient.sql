-- Per-klient ovládanie verejnej status page + report e-mail + denné uptime
-- segmenty na verejnej stránke.

alter table clients add column if not exists status_enabled boolean not null default true;
alter table clients add column if not exists report_email text;

-- Zoznam slugov pre build — LEN klienti so zapnutou status page.
create or replace function public_status_slugs() returns setof text
language sql security definer set search_path = public stable as $$
  select slug from clients where slug is not null and status_enabled = true;
$$;

-- Verejný stav klienta — dostupnosť + 90-dňový denný uptime pásik. Vracia null
-- ak klient neexistuje alebo má status page vypnutú. Žiadne interné dáta.
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
    from uptime_daily ud
    join s on s.id = ud.site_id
    where ud.day >= (current_date - 90)
    group by ud.site_id
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
        'history', coalesce((select h.days from hist h where h.site_id = s.id), '[]'::json)
      ) order by s.domain) from s), '[]'::json)
  ) end;
$$;

grant execute on function public_status_slugs() to anon, authenticated;
grant execute on function public_client_status(text) to anon, authenticated;
