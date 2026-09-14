-- welltis.com (EN verzia welltis.sk, pridaná v 0042) sa nesleduje —
-- rozhodnutie ownera 2026-09-14. V produkcii je už deaktivovaný cez UI;
-- táto migrácia to drží aj pri novej databáze: migrate.yml púšťa VŠETKY
-- migrácie pri každom behu a 0042 by web inak vložil znova ako aktívny.
-- Soft delete ako v UI (is_active = false) — dáta ostanú. Idempotentné.

update sites
set is_active = false
where domain = 'welltis.com'
  and is_active;
