-- Audit 2026-07-17, sekcia 6 ("org_id/site_id nesúlad pri zápise"). 0024
-- opravila presne túto triedu chyby pre `work_log`: pôvodná "staff write"
-- politika overovala LEN `org_id`, nie že `site_id` skutočne patrí do
-- writeable org — staff org A tak mohol vložiť riadok s `org_id = A`, ale
-- `site_id` patriacim webu org B (cudzí web dostane fabrikovaný/cudzí obsah).
-- Rovnaký vzor bol nedopravený na zvyšných 15 tabuľkách so `site_id`
-- stĺpcom. Dnes cez UI nedosiahnuteľné (browser klient píše len do `clients`,
-- `sites`, `notification_settings`, `work_log`, `alerts`) a service_role
-- skripty RLS obchádzajú — takže ide o defense-in-depth, nie o aktívne
-- zneužiteľnú dieru.
--
-- Nullabilita `site_id` overená pred písaním tejto migrácie (grep cez
-- `create table` v 0001/0008-0018): jediné dve tabuľky z 15, kde `site_id`
-- SMIE byť NULL, sú `alerts` (org-wide alerty typu `region_outage`,
-- `job_overdue`) a `change_log` (rovnaký dôvod — 0018_history.sql). Ostatných
-- 13 má `site_id` ako `not null` (často priamo primary key). Fix preto
-- rozlišuje dve vetvy:
--   (a) 13 tabuliek s `site_id not null` → rovnaký `with check` vzor ako
--       0024 (work_log): site_id musí patriť medzi weby writeable org.
--   (b) `alerts` + `change_log` → to isté, ale `site_id is null` ostáva
--       povolené (org-wide riadok), inak by táto oprava zablokovala
--       existujúcu legitímnu funkčnosť.
--
-- `using` klauzula sa nemení (zostáva len org_id — kontroluje viditeľnosť
-- existujúcich riadkov/cieľ update-u/delete-u, nie integritu nového zápisu)
-- — mení sa len `with check` (kontroluje výsledok insert/update).

-- (a) 13 tabuliek, site_id NOT NULL.
do $$
declare t text;
begin
  foreach t in array array[
    'aeo_snapshots', 'seo_snapshots', 'perf_snapshots', 'security_snapshots',
    'gsc_snapshots', 'wp_snapshots', 'infra_snapshots', 'metric_history',
    'uptime_checks', 'uptime_daily', 'incidents', 'domains', 'tls_certs'
  ]
  loop
    execute format('drop policy if exists "staff write" on %I', t);
    execute format(
      'create policy "staff write" on %I for all '
      || 'using (org_id in (select private.user_write_orgs())) '
      || 'with check ('
      || '  org_id in (select private.user_write_orgs())'
      || '  and site_id in (select id from sites where org_id in (select private.user_write_orgs()))'
      || ')', t);
  end loop;
end $$;

-- (b) alerts + change_log, site_id NULLABLE (org-wide riadky povolené).
drop policy if exists "staff write" on alerts;
create policy "staff write" on alerts for all
  using (org_id in (select private.user_write_orgs()))
  with check (
    org_id in (select private.user_write_orgs())
    and (
      site_id is null
      or site_id in (select id from sites where org_id in (select private.user_write_orgs()))
    )
  );

drop policy if exists "staff write" on change_log;
create policy "staff write" on change_log for all
  using (org_id in (select private.user_write_orgs()))
  with check (
    org_id in (select private.user_write_orgs())
    and (
      site_id is null
      or site_id in (select id from sites where org_id in (select private.user_write_orgs()))
    )
  );
