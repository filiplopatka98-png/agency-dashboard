-- Verejná status page per klient — LEN dostupnosť (žiadne skóre/interné dáta).
-- Prístup: anon cez security-definer RPC (RLS inak blokuje). Čitateľný slug
-- z názvu klienta. Zapnuté pre všetkých; stránka je noindex (rieši frontend + _headers).

create extension if not exists unaccent;

alter table clients add column if not exists slug text;

-- Slugify: bez diakritiky, malé písmená, nealfanumerické → '-', orež pomlčky.
create or replace function slugify(txt text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(unaccent(coalesce(nullif(txt,''),'klient'))), '[^a-z0-9]+', '-', 'g'));
$$;

-- Backfill unikátnych slugov (kolízia → + krátky hex z id).
do $$
declare r record; base text; cand text;
begin
  for r in select id, coalesce(nullif(name,''), company, 'klient') as label from clients where slug is null loop
    base := slugify(r.label);
    if base = '' then base := 'klient'; end if;
    cand := base;
    if exists (select 1 from clients where slug = cand and id <> r.id) then
      cand := base || '-' || left(replace(r.id::text,'-',''), 4);
    end if;
    update clients set slug = cand where id = r.id;
  end loop;
end $$;

create unique index if not exists clients_slug_uidx on clients (slug);

-- Nový klient dostane slug automaticky (aj pri DB inserte).
create or replace function set_client_slug() returns trigger language plpgsql as $$
declare base text; cand text;
begin
  if new.slug is null or new.slug = '' then
    base := slugify(coalesce(nullif(new.name,''), new.company, 'klient'));
    if base = '' then base := 'klient'; end if;
    cand := base;
    if exists (select 1 from clients where slug = cand) then
      cand := base || '-' || left(replace(new.id::text,'-',''), 4);
    end if;
    new.slug := cand;
  end if;
  return new;
end $$;
drop trigger if exists trg_set_client_slug on clients;
create trigger trg_set_client_slug before insert on clients for each row execute function set_client_slug();

-- Zoznam slugov pre build (generateStaticParams). Anon-safe (slug je verejný).
create or replace function public_status_slugs() returns setof text
language sql security definer set search_path = public stable as $$
  select slug from clients where slug is not null;
$$;

-- Verejný stav klienta — LEN dostupnosť. Vracia meno + weby (doména, stav,
-- uptime 30d, otvorený incident). Žiadne skóre, financie ani iné interné dáta.
create or replace function public_client_status(p_slug text) returns json
language sql security definer set search_path = public stable as $$
  with c as (select id, coalesce(nullif(name,''), company, 'Klient') as label from clients where slug = p_slug),
  s as (
    select st.id, st.domain, st.maintenance, st.consecutive_failures,
           exists (select 1 from incidents i where i.site_id = st.id and i.resolved_at is null) as has_incident,
           (select round(avg(ud.uptime_pct)::numeric, 2) from uptime_daily ud
              where ud.site_id = st.id and ud.day >= (current_date - 30)) as uptime30
    from sites st join c on st.client_id = c.id
    where st.is_active = true
  )
  select case when not exists (select 1 from c) then null else json_build_object(
    'client', (select label from c),
    'generated_at', now(),
    'sites', coalesce((select json_agg(json_build_object(
        'domain', s.domain,
        'status', case when s.maintenance then 'maintenance'
                       when s.consecutive_failures >= 2 or s.has_incident then 'down'
                       else 'up' end,
        'uptime30', s.uptime30
      ) order by s.domain) from s), '[]'::json)
  ) end;
$$;

grant execute on function public_status_slugs() to anon, authenticated;
grant execute on function public_client_status(text) to anon, authenticated;
