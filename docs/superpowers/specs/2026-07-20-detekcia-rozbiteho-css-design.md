# Detekcia rozbitého CSS (Elementor stale-cache) — design

**Dátum:** 2026-07-20
**Kontext:** Owner hlási, že sa na WP weboch „sem tam" rozbije CSS — typicky
Elementor prečísluje/zmaže vygenerovaný CSS súbor, no zacachovaná HTML naň
stále odkazuje → súbor vráti 404 → stránka sa načíta neoštýlovaná. Pomôže až
premazanie cache. Chceme to detekovať a upozorniť skôr, než to owner zistí od
klienta.

## Empirický základ (overené 2026-07-20)
Stiahnutím homepage a kontrolou stavu každého `<link rel="stylesheet">`:
- soccercoacheshub.com — 122 stylesheetov (9 Elementor), teraz 0 rozbitých
- vzdelavanie.digital — 107 stylesheetov, teraz 0 rozbitých
Mechanizmus je teda merateľný: rozbitý CSS = referencovaný súbor vráti non-200.
Vzor Elementor CSS: `/wp-content/.../elementor.css?ver=X`, resp. per-page
`/wp-content/uploads/elementor/css/post-<N>.css`.

## Signál (čo presne je „rozbité")
Referencovaný stylesheet vráti **404 / iný non-200 / 0 bajtov**. To je tvrdý
fakt. Dva režimy rozbitia existujú:
1. **súbor 404** — spoľahlivo detekovateľné (TENTO detektor).
2. **súbor 200, ale prázdny/starý obsah** — ťažšie (renderovanie/diff). NErieši
   sa teraz. Ak sa web rozbije a detektor nič nenájde, vieme, že ide o režim 2
   a doriešime ho samostatne (rovnaký „najprv tvrdý signál, potom podľa dát"
   prístup ako pri PSI/CVE).

## Rozsah
- **5 stránok na web:** homepage + ~4 hlavné položky z hlavného menu.
  - Menu sa parsuje z homepage: odkazy v `<nav>`/`<header>`/menu kontajneri,
    prvých ~4 unikátne INTERNÉ odkazy. Fallback ak sa menu nenájde: doplniť
    prvými internými odkazmi z homepage, nech je vždy 5 (alebo menej, ak web
    toľko stránok nemá).
  - Dôvod pre viac stránok: Elementor generuje CSS per stránku (`post-N.css`),
    takže rozbitie môže byť len na jednej podstránke — homepage-only by ho
    prehliadlo.
- **Všetky aktívne weby** (nie len WP). Rozbité CSS je zlé všade; pre statické
  weby je kontrola lacná (málo stylesheetov).
- **CSS deduplikácia:** naprieč 5 stránkami sa zdieľané stylesheety (theme/global)
  kontrolujú len raz. V alerte sa uvedie, na ktorej stránke je rozbitý CSS
  referencovaný.

## Kadencia
**Každú hodinu.** Rozbité CSS vidí návštevník okamžite → vysoká viditeľnosť,
blízko k „web dole". Cena je zanedbateľná: HEAD kontroly sú ľahšie než jeden
reálny návštevník (ten sťahuje assety cez GET). Nový collector na GitHub Actions
cron `0 * * * *`, konzistentný s ostatnými collectormi.

## Alert
- Typ `css_broken`, severity `warning`.
- **Posiela sa hneď** (NIE v `NIGHT_DEFERRED_TYPES`) — návštevník to vidí teraz.
- Telo: ktoré CSS spadli (URL + HTTP stav) a na ktorej stránke sú referencované.
- **Dedupe `css_broken:<site>:<YYYY-MM-DD>`** — 1× za deň na web, nech hodinové
  kontroly nezasypú. Ak je rozbité aj ďalší deň → nový deň = pripomenutie.
- Cez zdieľaný `tools/_shared/raiseAlert.mjs`.

## Zero-fabrication poistka
- Rozbité = LEN definitívny non-200 na strane webu (404/410/5xx/…), prípadne
  0-bajtový 200. **Timeout/sieťová chyba NAŠEJ kontroly sa NEhlási ako rozbité
  CSS** — to je náš problém, nie webu. Každý podozrivý CSS sa pred nahlásením
  overí **1 retry**; nahlási sa len ak aj druhý pokus dá definitívny non-200.
  (Rovnaká logika ako TLS `tls_invalid` — reachability problém ≠ fakt o obsahu.)
- Ak zlyhá načítanie samotnej HTML stránky (nie CSS), tá stránka sa preskočí
  (nemôžeme z nej vytiahnuť stylesheety) — nie je to „rozbité CSS". Ak zlyhajú
  VŠETKY stránky webu (web je dole), rieši to uptime/site_down, nie tento
  detektor → žiadny `css_broken`.
- **503 (údržba)** na stránke: preskočiť (konzistentne s aeo/seo maintenance
  skip) — web v údržbe nemá zmysel kontrolovať na CSS.

## Architektúra
- **`packages/core/src/assetCheck.ts`** (čistá logika, testované vitestom):
  - `extractStylesheets(html, baseUrl)` → absolútne URL všetkých
    `<link rel="stylesheet">`.
  - `extractMenuLinks(html, origin)` → interné odkazy z nav/header, ~4, s
    fallbackom na prvé interné odkazy. Cap a dedupe.
  - `classifyAsset({ status, bytes })` → `ok` | `broken` (404/non-200/0-bajt).
  - Prípadne `isCssBroken` helper. Všetko čisté, bez IO.
- **`tools/asset-check/index.mjs`** (IO, cez `runJob('asset-check', run)`):
  - Načíta aktívne weby zo Supabase.
  - Per web: fetch homepage → extractMenuLinks → fetch 5 stránok →
    extractStylesheets → dedupe CSS → skontroluj každý unikátny CSS (+1 retry) →
    classify → poskladá zoznam rozbitých s odkazujúcou stránkou.
    - Kontrola stavu: najprv `HEAD`; ak server HEAD nepodporuje (405/501),
      fallback na `GET` (rovnaký vzor ako seo-crawl broken-links). 0-bajt sa
      posudzuje z `Content-Length`/tela GET-u.
  - Ak sú rozbité → `raiseAlerts` s `css_broken` riadkom.
  - Vráti `{ ok, failed }` pre runJob (web, kde zlyhalo NAČÍTANIE všetkých
    stránok kvôli našej chybe, sa neráta ako CSS-rozbitý; ak je web dole,
    to je uptime).
- **`.github/workflows/asset-check.yml`** — cron `0 * * * *`, spúšťa collector.
- **`JOB_SCHEDULES['asset-check']`** = hourly (aby job_overdue/job_failed poznali
  jeho kadenciu; hodinový → overdue prah ~2 h).
- Bez migrácie: `alerts.type` je voľný text, `css_broken` netreba migrovať.
  Bez novej tabuľky — detektor je stavovo bezpamäťový (kontroluje aktuálny stav,
  nediffuje voči histórii).

## Čo zámerne NErobíme (YAGNI)
- Neukladáme históriu CSS stavov (žiadna tabuľka) — stačí aktuálny stav + alert.
- Neriešime režim „200 ale prázdne" (kým dáta neukážu, že treba).
- Neautomatizujeme premazanie cache — len detekcia + alert. (Auto-purge by
  vyžadoval per-web credentials k cache pluginu; mimo rozsah.)
- Necrawlujeme celý web — 5 stránok stačí.

## Testovanie
- `assetCheck.ts` unit testy: extrakcia stylesheetov (rôzne varianty `<link>`),
  extrakcia menu (nav/header/fallback, dedupe, cap, len interné), classify
  (200/404/5xx/0-bajt), absolútne vs relatívne URL.
- `node --check` na collectore.
- Overenie naostro po nasadení: manuálny beh proti prod, kontrola že soccercoaches/
  vzdelavanie dávajú 0 rozbitých (aktuálny stav), job_runs zapísaný.

## Ako sa overí, že to reálne funguje
Keď sa web „sem tam" rozbije, do ~hodiny príde e-mail „<web>: rozbité CSS —
<url> vracia 404 (na stránke <page>)". Ak sa web viditeľne rozbije a e-mail
nepríde → potvrdí to režim 2 (200-ale-prázdne) a riešime ho samostatne.
