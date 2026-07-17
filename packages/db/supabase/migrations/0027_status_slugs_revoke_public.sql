-- Dodatok k 0025 (audit 1.1). Migrácia 0025 odobrala EXECUTE roli `anon`, ale
-- NEZABRALA: overené na prod hneď po jej aplikovaní — anon kľúč naďalej vrátil
-- zoznam všetkých klientov (HTTP 200).
--
-- Príčina: Postgres pri `create function` automaticky grantne EXECUTE roli
-- PUBLIC. `proacl` to ukázal ako `{=X/postgres, ...}` — prázdny príjemca pred
-- `=` je PUBLIC. `anon` teda nepotreboval vlastný grant, dedil ho po PUBLIC.
-- Odobranie grantu konkrétnej roli je za týchto okolností bez účinku.
--
-- Preto revoke od PUBLIC. `authenticated` si EXECUTE ponecháva (prihlásený je
-- len vlastník) a build berie slugy cez service_role, ktorý RLS aj granty
-- obchádza.
--
-- POZOR pri pridávaní ďalších neverejných funkcií: `create or replace function`
-- grant PUBLIC znova NEobnovuje, ale `drop` + `create` áno. Ak sa táto funkcia
-- niekedy dropne a vytvorí nanovo, tento revoke treba zopakovať.

revoke execute on function public_status_slugs() from public;

-- Service_role dedil EXECUTE po PUBLIC tiež — po revoke vyššie stratil prístup
-- a `next build` spadol na prázdnom generateStaticParams. Preto mu ho grantni
-- výslovne: build (a len build) túto funkciu volá.
-- Pozn.: service_role obchádza RLS, ale NIE granty na funkcie — to je iný
-- mechanizmus a treba ho riešiť zvlášť.
grant execute on function public_status_slugs() to service_role;

-- public_client_status(text) je zámerne verejná (je to samotná status page)
-- a PUBLIC grant si ponecháva.
