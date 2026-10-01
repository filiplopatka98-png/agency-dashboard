-- 1) Web, ktorý sa prestane kontrolovať (deaktivácia alebo údržba), uzavrie
--    svoje otvorené incidenty. Incident uzatvára len uptime kontrola
--    (persist_uptime, 0004) a tá sa na neaktívne weby ani weby v údržbe nespustí
--    (get_sites_to_check, 0014) — incident tak visel natrvalo. Reálne:
--    vzdelavanie.digital, otvorený 2026-09-10 (526), web neskôr deaktivovaný.
--    Trigger na DB, nie v UI: zachytí aj zmenu cez SQL (0043 deaktivovala
--    welltis.com migráciou). Nulujú sa aj consecutive_failures — inak by po
--    reaktivácii prvé zlyhanie hneď otvorilo incident podľa starého počtu.
create or replace function close_incidents_when_unmonitored()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.is_active and not new.is_active) or (not old.maintenance and new.maintenance) then
    update incidents i set
      resolved_at = now(),
      duration_seconds = extract(epoch from (now() - i.started_at))::int,
      cause = coalesce(i.cause, case when not new.is_active then 'web deaktivovaný — monitoring ukončený'
                                     else 'web v údržbe — monitoring pozastavený' end)
    where i.site_id = new.id and i.resolved_at is null;
    new.consecutive_failures := 0;
  end if;
  return new;
end $$;
revoke all on function close_incidents_when_unmonitored() from public, anon, authenticated;

drop trigger if exists trg_close_incidents_when_unmonitored on sites;
create trigger trg_close_incidents_when_unmonitored
  before update of is_active, maintenance on sites
  for each row execute function close_incidents_when_unmonitored();

-- 2) Archív alertov — „vymazanie" v UI je len skrytie (archived_at), riadok
--    ostane (dedupe_key, história, report). Obnoviť = archived_at null.
alter table alerts add column if not exists archived_at timestamptz;
create index if not exists alerts_archived_idx on alerts (org_id, archived_at) where archived_at is not null;
