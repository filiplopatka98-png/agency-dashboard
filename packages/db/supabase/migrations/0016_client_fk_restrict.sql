-- Klient s priradenými webmi sa NESMIE zmazať. Pôvodné ON DELETE SET NULL ticho
-- odpojilo weby (client_id → NULL) — nechcené. RESTRICT → DB mazanie odmietne;
-- najprv treba weby prehodiť na iného klienta. (UI to blokuje tiež, toto je backstop.)
alter table sites drop constraint if exists sites_client_id_fkey;
alter table sites
  add constraint sites_client_id_fkey
  foreign key (client_id) references clients (id) on delete restrict;
