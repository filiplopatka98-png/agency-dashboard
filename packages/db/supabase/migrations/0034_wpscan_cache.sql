-- Perzistentná cache WPScan odpovedí — rieši nekonvergenciu CVE zberu.
--
-- Problém: WPScan free tier = 25 lookupov/deň, ale 6 webov potrebuje 185
-- unikátnych plugin slugov + 3 verzie jadra = 188 lookupov. Cache v collectore
-- bola `new Map()` vnútri run() — zomrela s procesom, takže KAŽDÝ denný beh sa
-- pýtal WPScanu odznova. V kombinácii s pravidlom „ak ktorýkoľvek cieľ webu
-- narazil na rate-limit → preskoč celý web" to znamenalo, že CVE dáta dostal
-- len PRVÝ web (12 pluginov) a všetky ostatné sa preskakovali každý deň
-- donekonečna. Nulový akumulovaný progres.
--
-- S perzistentnou cache platí 25/deň rozpočet len za slugy, ktoré ešte nemáme
-- → pokrytie sa doplní za ~8 dní a ustálený refresh je 188/30 ≈ 6/deň, hlboko
-- pod free tier limitom.
--
-- Prečo kľúč (kind, slug) a NIE verzia: WPScan odpovedá PER SLUG, nie per
-- verziu. `GET /plugins/{slug}` vráti VŠETKY známe zraniteľnosti pluginu, každú
-- s `fixed_in`. Porovnanie s nainštalovanou verziou robí lokálne
-- `isAffected(installed, fixed_in)` v collectore. Cachovaná odpoveď teda ostáva
-- platná aj keď web plugin medzitým aktualizuje — zneplatniť ju môže len novo
-- zverejnené CVE. Preto TTL (30 dní), nie verzovanie kľúča.
--
-- Prečo `vulns` ukladáme UŽ OBOHATENÉ (s `cvss` + `severity`): obohatenie robí
-- NVD lookup na každé CVE s 6.5 s pauzou (bez API kľúča). Keď cache funguje,
-- každý web sa vyrieši každý deň — obohacovanie pri čítaní by bolo mnohominútové
-- denné zdržanie a mlátili by sme NVD kvôli skóre, ktoré už dávno poznáme.
-- Obohatením pri fetchi je počet NVD volaní zhora ohraničený počtom novo
-- stiahnutých slugov (≤25/deň) a vyhodnotenie webu je čistý lokálny výpočet.
create table if not exists wpscan_cache (
  kind text not null check (kind in ('plugin','core')),
  slug text not null,          -- plugin slug, alebo verzia jadra pre kind='core'
  -- UŽ OBOHATENÝ zoznam (title, cve, fixed_in, cvss, severity). `not null` samo
  -- osebe NEstačí — pripúšťa JSON literál `null` aj skalár/objekt. Tvar „nie je
  -- pole" je nerozlíšiteľný od prázdneho poľa až v konzumentovi, kde by sa
  -- prečítal ako „žiadne zraniteľnosti" → fabrikované „vyriešené". Vynúť pole tu.
  vulns jsonb not null check (jsonb_typeof(vulns) = 'array'),
  fetched_at timestamptz not null default now(),
  primary key (kind, slug)
);

-- Refresh berie najstaršie záznamy ako prvé (planLookups: stale → oldest first).
create index if not exists wpscan_cache_fetched_at_idx on wpscan_cache (fetched_at);

-- Globálne referenčné dáta odvodené z verejnej WPScan DB — žiadne klientske
-- dáta, nič z UI to nečíta. RLS zapnuté BEZ policies → default deny pre
-- anon/authenticated; číta a píše výhradne collector cez service_role.
alter table wpscan_cache enable row level security;

revoke all on wpscan_cache from anon, authenticated;
grant all on wpscan_cache to service_role;

-- Retencia: zmaž slugy, ktorých sa nikto nedotkol 180 dní. Bez nej tabuľka rastie
-- monotónne (odinštalované pluginy sa už nikdy nerefreshnú, ale ostanú tu) a obe
-- čítania collectora sú nestránkované — po prekročení PostgREST `max_rows` (1000)
-- by sa odpoveď TICHO orezala, živý cieľ by vypadol z `presentKeys` a KAŽDÝ web
-- by sa navždy preskakoval bez akejkoľvek diagnostiky.
-- Prečo 180 dní: stále nainštalovaný slug sa refreshuje každých 30 dní (TTL), takže
-- 180 dní bez dotyku = slug, ktorý nie je na žiadnom webe. Ak sa vráti, doplní sa
-- štandardným fill-om. Pomenovaný job → re-run migrácie aktualizuje, nezduplikuje.
select cron.schedule('wpscan_cache_retention', '40 2 * * *', $job$
  delete from wpscan_cache where fetched_at < now() - interval '180 days';
$job$);
