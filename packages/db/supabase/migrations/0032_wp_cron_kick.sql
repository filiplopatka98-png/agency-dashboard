-- WP-cron kick (audit 2026-07-17 nasledné): reálny incident — dva z troch WP
-- webov po inštalácii plugin agenta neposlali NIČ, kým ich niekto ručne
-- nenavštívil v prehliadači. Príčina: WP-cron (`monitorix_agent_push`) nie je
-- skutočný cron — spustí sa len keď niekto načíta stránku (`init`). Na
-- málo navštevovanom webe sa tak naplánovaný denný push nikdy nevykoná.
--
-- Riešenie v tomto Workeri (runWpCronKick.ts): keď je `wp_snapshots.measured_at`
-- staršie než ~25h (plugin pushuje denne → >25h = push zlyhal/nespustil sa) ALEBO
-- snapshot vôbec neexistuje (web nikdy nepushol), Worker spraví obyčajný GET na
-- `https://<domain>/wp-cron.php?doing_wp_cron=<ts>` — presne ako si WordPress
-- sám spúšťa cron pri návšteve. To donúti web spustiť svoje due joby vrátane
-- nášho pushu, bez potreby skutočného návštevníka.
--
-- `cron_kicked_at` (nový stĺpec na wp_snapshots — 1:1 so `sites` cez site_id,
-- rovnaká tabuľka ako pre WPScan/plugin dáta, žiadna nová tabuľka netreba) drží
-- KEDY sme web naposledy kopli (bez ohľadu na výsledok) — "neham­ruj" rate limit
-- nezávislý od measured_at: keby sme rate-limitovali len cez measured_at, mŕtvy
-- web (DISABLE_WP_CRON, deaktivovaný plugin) by ostal navždy "starý" a kopli by
-- sme ho pri KAŽDOM 5-min ticku donekonečna.
alter table wp_snapshots add column if not exists cron_kicked_at timestamptz;

-- Round-robin výber webov na kopnutie (rovnaký vzor ako get_domains_to_check
-- v 0006_domains_to_check.sql): najstarší/chýbajúci measured_at ide prvý,
-- _limit obmedzuje subrequesty za tick, cooldown na cron_kicked_at bráni
-- opakovanému kopnutiu toho istého (pravdepodobne trvalo nefunkčného) webu.
create or replace function get_wp_sites_to_kick(_limit int default 3)
returns table (id uuid, org_id uuid, domain text)
language sql stable security definer set search_path = public as $$
  select s.id, s.org_id, s.domain
  from sites s
  left join wp_snapshots w on w.site_id = s.id
  where s.is_active
    and s.cms = 'wordpress'
    and (w.measured_at is null or w.measured_at < now() - interval '25 hours')
    and (w.cron_kicked_at is null or w.cron_kicked_at < now() - interval '6 hours')
  order by w.measured_at asc nulls first
  limit greatest(_limit, 0)
$$;

revoke all on function get_wp_sites_to_kick(int) from public;
grant execute on function get_wp_sites_to_kick(int) to service_role;
