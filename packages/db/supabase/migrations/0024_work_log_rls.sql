-- Oprava `work_log` RLS: pôvodná "staff write" politika (0022) overuje LEN
-- org_id, nie väzbu site_id → org_id. Staff používateľ org A tak mohol
-- vložiť riadok s org_id = A ale site_id patriacim webu org B — monthly-report
-- zoskupuje denník PODĽA site_id, takže by sa taký text zjavil v KLIENTSKOM
-- e-maile organizácie B (fabrikovaný/cudzí obsah v jej reporte).
-- Fix: `with check` navyše vyžaduje, aby site_id patril medzi weby
-- writeable org (rovnaký vzor ako 0022_report_events.sql).

drop policy if exists "staff write" on work_log;
create policy "staff write" on work_log for all
  using (org_id in (select private.user_write_orgs()))
  with check (
    org_id in (select private.user_write_orgs())
    and site_id in (select id from sites where org_id in (select private.user_write_orgs()))
  );
