-- Cooldown na kopnutie wp-cron: 6 h → 12 h (rozhodnutie vlastníka 2026-07-17).
--
-- Dôvod: kopnutie je jeden GET na wp-cron.php — presne to, čo WordPress spraví
-- pri každej návšteve stránky, takže web ich denne dostane stovky. Ale pri 6 h
-- by sme trvalo nefunkčný web (DISABLE_WP_CRON, deaktivovaný plugin) kopli 4×
-- denne úplne zbytočne. 12 h = 2× denne: polovica dotykov, a po nahodení
-- pluginu na web bez návštevnosti čakáš na prvé dáta nanajvýš pol dňa.
--
-- Prahy zámerne NIE sú rovnaké: staleness ostáva 25 h (plugin pushuje denne,
-- hodina navyše je rezerva na posun cronu), cooldown je 12 h — kratší než
-- staleness, aby sme oneskorený push stihli kopnúť ešte v ten istý deň.

create or replace function get_wp_sites_to_kick(_limit int default 3)
returns table (id uuid, org_id uuid, domain text)
language sql stable security definer set search_path = public as $$
  select s.id, s.org_id, s.domain
  from sites s
  left join wp_snapshots w on w.site_id = s.id
  where s.is_active
    and s.cms = 'wordpress'
    and (w.measured_at is null or w.measured_at < now() - interval '25 hours')
    and (w.cron_kicked_at is null or w.cron_kicked_at < now() - interval '12 hours')
  order by w.measured_at asc nulls first
  limit greatest(_limit, 0)
$$;

revoke all on function get_wp_sites_to_kick(int) from public;
grant execute on function get_wp_sites_to_kick(int) to service_role;
