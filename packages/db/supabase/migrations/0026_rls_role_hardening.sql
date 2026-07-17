-- Audit 2026-07-17, sekcia 6 (spiace míny — dnes nezneužiteľné, zajtra áno).
-- Dve nezávislé opravy rolí v RLS.

-- ── A) `memberships` — staff sa mohol povýšiť na owner (alebo owner zosadiť) ──
-- Pôvodná "staff write" politika (0002_rls.sql:66-74) kontrolovala LEN
-- `org_id in user_write_orgs()` (obsahuje aj staff), nikdy AKÚ rolu daný
-- riadok zapisuje/mení. Staff člen tak mohol:
--   (a) insertnúť/updatnúť SVOJ riadok na role='owner' (sebapovýšenie), alebo
--   (b) updatnúť CUDZÍ riadok s role='owner' (zosadiť skutočného ownera).
--
-- Fix: nová helper funkcia `private.user_owner_orgs()` (analogická k
-- `user_write_orgs()`, ale len role='owner'). Politika teraz vyžaduje, aby
-- KAŽDÝ riadok, ktorý sa dotýka role='owner' — či už existujúci (USING, teda
-- update/delete cieľa) alebo výsledný (WITH CHECK, teda insert/update
-- výsledku) — smel čítať/písať len niekto, kto je už ownerom danej org.
-- Staff naďalej voľne spravuje non-owner riadky (seba, iných staff) — to je
-- legitímna potreba (pridávanie kolegov). Meniť/mazať/vytvárať owner riadok
-- (vrátane demote existujúceho ownera) smie len owner.
create or replace function private.user_owner_orgs()
  returns setof uuid
  language sql stable security definer set search_path = public
as $$
  select org_id from memberships where user_id = auth.uid() and role = 'owner'
$$;

revoke all on function private.user_owner_orgs() from public;
grant execute on function private.user_owner_orgs() to authenticated, anon;

drop policy if exists "staff write" on memberships;
create policy "staff write" on memberships for all
  using (
    org_id in (select private.user_write_orgs())
    and (
      role <> 'owner'::member_role
      or org_id in (select private.user_owner_orgs())
    )
  )
  with check (
    org_id in (select private.user_write_orgs())
    and (
      role <> 'owner'::member_role
      or org_id in (select private.user_owner_orgs())
    )
  );

-- ── B) `member_role` ponúka 'client', ale žiadna politika rolu nekontroluje ──
-- Všetky "org members read" politiky (0002_rls.sql) filtrujú len podľa
-- `org_id`, nikdy podľa role. Produkcia má JEDNU org so VŠETKÝMI klientmi —
-- prihlásenie s role='client' by teda videlo cudzie sadzby, paušály,
-- poznámky aj incidenty všetkých ostatných klientov. Nič to dnes nezneužíva
-- (žiadny takýto login neexistuje), ale schéma tú mínu ponúka a jedného dňa
-- ju niekto stlačí.
--
-- Odobrať hodnotu z enumu `member_role` je v Postgrese nepríjemné (vyžaduje
-- prebudovanie typu + všetkých závislých stĺpcov/politík) a je to väčší zásah
-- než si táto oprava žiada. Namiesto toho: `check` constraint na
-- `memberships.role`, ktorý hodnotu 'client' odmieta pri insert/update — rola
-- ostáva v enume zdokumentovaná (budúci feature môže politiky doriešiť a
-- constraint odstrániť), ale kým nie je per-client izolácia implementovaná,
-- nikto (ani omylom cez SQL/admin) nemôže takú membership vytvoriť.
-- Idempotentné cez DO blok (Postgres nepodporuje `ADD CONSTRAINT IF NOT
-- EXISTS`) — ak už existuje, `duplicate_object` sa potichu preskočí. Ak by
-- existoval riadok s role='client', Postgres migráciu odmietne s jasnou
-- chybou namiesto ticha (na produkcii je dnes jedno owner membership, žiadny
-- 'client' riadok).
do $$ begin
  alter table memberships
    add constraint memberships_role_not_client check (role <> 'client'::member_role);
exception when duplicate_object then null;
end $$;

comment on constraint memberships_role_not_client on memberships is
  'Rola client nemá v RLS žiadnu izoláciu (org members read politiky kontrolujú len org_id) — kým sa nedorobí per-client izolácia, táto rola je zablokovaná. Viď docs/AUDIT-2026-07-17.md sekcia 6.';
