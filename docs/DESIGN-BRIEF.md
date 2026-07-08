# Design brief — Agency Dashboard

> **Pre:** Claude Design (návrh vizuálu + UI). **Od:** Filip. **Verzia:** 1.0 · 8. 7. 2026
> **Rozsah:** celý produkt naprieč fázami 1–5 (nie len MVP). Fáza 1 je postavená a beží;
> tento brief má dať produktu finálny vizuálny jazyk a pokryť všetky budúce obrazovky, aby
> návrh nemuseli prerábať s každou fázou.
> **Jazyk UI:** slovenčina. **Dátumy:** `D. M. RRRR`, časové pásmo Europe/Bratislava.
> **Sumy:** `1 401,32 €`.

---

## 1. Čo to je a pre koho

Interný dashboard freelance web-agentúry (Filip). Na jednom mieste ukazuje **stav všetkých
spravovaných webov** — dostupnosť, výkon, SEO, AEO, infraštruktúru, expirácie — a **sám upozorní**,
keď sa niečo pokazí.

Dva ciele, oba dôležité pre dizajn:

1. **Prevádzkový nástroj** pre Filipa: ráno na telefóne uvidí, či niečo nehorí; pred mesačnou
   údržbou z jednej obrazovky zistí, čo treba updatovať (namiesto prihlasovania do 20 adminov).
2. **Predajný artefakt** maintenance tierov (29 / 39 / 59 / 69 €/mes). Klient dostane odkaz na
   svoju status stránku a mesačný report. **Dashboard, ktorý vidno klientovi, musí vyzerať
   dôveryhodne a upratane — je to argument, prečo nevypovedať zmluvu.** Toto priamo ovplyvňuje
   vizuálnu latku: nie interný admin-panel „hlavne nech funguje", ale nástroj, ktorý sa nehanbíš
   ukázať platiacemu klientovi.

**Veľkosť:** 25–60 webov, **1 admin**, neskôr ~15 read-only klientov. Nie je to SaaS pre trh —
optimalizuj na prehľadnosť a pokoj, nie na feature-preteky.

---

## 2. Používatelia a roly

| Rola | Kto | Čo vidí | Primárny device |
|---|---|---|---|
| **owner** | Filip | všetko naprieč orgom | mobil (ranná kontrola) + desktop (práca) |
| **staff** | budúci spolupracovník | to isté, bez fakturačných čísel/nastavení | desktop |
| **client** (fáza 4) | platiaci klient | **len svoje weby**, read-only, zjednodušené | mobil + desktop |

**Kľúčové scenáre (jobs-to-be-done):**
- *„Horí niečo?"* — 3-sekundový pohľad na telefóne. Musí byť zjavné bez čítania.
- *„Čo treba tento mesiac updatnúť?"* — jedna obrazovka namiesto 20 loginov.
- *„Expiruje niekomu doména/certifikát?"* — nesmie sa dať prehliadnuť.
- *„Ukáž klientovi, že sa staráme."* — status page + mesačný report.
- *„Ktorý web je stratový?"* — biznis overlay (hodiny/€ vs paušál), fáza 4+.

---

## 3. Dizajnové princípy (záväzné)

1. **Mobile-first pre Prehľad.** Filip ho otvorí ráno na telefóne. Karta webu = **farebná bodka +
   názov + uptime + „pred 3 h"**. Nič viac. Detaily až v detaile.
2. **Calm monitoring.** Farba je **len významová**, nie dekorácia. Zelená/žltá/červená/sivá nesú
   stav; zvyšok UI je pokojný, neutrálny. Zdravý web nemá kričať — pozornosť patrí problémom.
3. **„Nezistené" ≠ „0".** Najčastejšia chyba v tomto type nástroja. Web bez Search Console
   neukáže `0 klikov` — ukáže **„Search Console nepripojená · pripojiť"**. Chýbajúci údaj a nulová
   hodnota sú vizuálne odlíšené. Toto platí všade: TLS/doména/PSI/GSC/CrUX/infra.
4. **Prázdne, načítavacie a chybové stavy sú prvotriedne**, nie dodatok. Každý dátový blok má
   navrhnutý stav: *loading · empty (dva typy: „ešte žiadne dáta" vs „integrácia nepripojená") ·
   error · populated · blocked*.
5. **Dôveryhodnosť.** Klient to uvidí. Presné čísla, jasné dátumy, žiadne „fake it" grafy.
6. **Rýchlosť.** Prehľad < 1 s aj pri 60 weboch. Vizuál nesmie vyžadovať ťažké assety.
7. **Prístupnosť WCAG AA.** Kontrast, focus-visible, jeden `<h1>` na stránku, skip-link,
   stav nikdy len farbou (bodka + text/ikona).
8. **Svetlý aj tmavý režim** ako rovnocenné, nie tmavý ako afterthought.

---

## 4. Vizuálny smer (na návrh dizajnéra)

Konkrétny vizuálny jazyk (farby, typografia, tvar) **nechávam na teba** — tu sú mantinely a nálada:

- **Nálada:** pokojný, dátovo-hutný, profesionálny, dôveryhodný. Nie hravý, nie korporátne studený.
  Bližšie k nástroju pre inžiniera než k marketingovému dashboardu.
- **Referencie (smer, nie kópia):** Linear (pokoj, typografia, hustota), Vercel dashboard
  (čistota, prázdne stavy), Datadog / Better Stack (status/uptime vizualizácie, incident UI),
  Cloudflare dashboard (dátové tabuľky).
- **Semantická paleta (povinná logika, odtiene navrhni):**
  🟢 *ok / zdravé* · 🟡 *warning / pozor* · 🔴 *critical / down* · ⚪ *nezistené / nepripojené / neaktívne*.
  Musí fungovať v light aj dark a byť rozlíšiteľná pri farbosleposti (nie len hue — aj poloha/ikona/text).
- **Typografia:** čísla sú hrdinovia (uptime %, skóre, response time) — čitateľné, `tabular-nums`,
  jasná hierarchia metrika → kontext.
- **Hustota:** desktop môže byť hutný (Filip pozerá veľa webov naraz); mobil vzdušný a glanceable.
- **Stack, do ktorého sa návrh mapuje:** Tailwind + **shadcn/ui** + **Recharts**. Navrhuj v duchu
  týchto primitív (karty, tabuľky, tabs, badges, dialogy, sheet/drawer na mobile), nech je návrh
  1:1 postaviteľný. Design tokens (farby, spacing, radius, tiene) dodaj ako súčasť.

---

## 5. Informačná architektúra

```
/login                    magic link (public)
/                         PREHĽAD — mriežka/mriežko-tabuľka všetkých webov
/sites                    Zoznam webov — tabuľka + filtre
/sites/[id]               Detail webu — taby:
                            Prehľad · Uptime · Performance · SEO · AEO · Infra · Klient
/clients                  Klienti — zoznam
/clients/[id]             Klient — detail + jeho weby
/alerts                   Feed alertov — filter podľa severity, „vyriešené"
/settings                 Org · API kľúče · Notifikácie · Retencia · Tím
/status/[slug]            (fáza 4) VEREJNÁ status page — read-only, bez loginu
(report)                  (fáza 4) Mesačný report — HTML e-mail + PDF (nie route, generovaný artefakt)
(client portal)           (fáza 4) rovnaké routy, rola=client → len svoje weby, zjednodušené
```

**Globálna navigácia (za loginom):** ľavý sidebar (desktop) / bottom-tab alebo hamburger (mobil):
Prehľad · Weby · Klienti · Alerty · Nastavenia. V hlavičke: prepínač témy, počet otvorených
alertov (badge), odhlásenie. **Region-outage banner** (keď je aktívny) sedí navrchu naprieč appkou.

---

## 6. Obrazovky — detailne

Pri každej obrazovke uveď návrh pre **mobil aj desktop** a **všetky stavy**.

### 6.1 Login `/login`
Magic link (e-mail → odkaz). Minimalistický. Jeden `<h1>`. Stavy: idle · odosielam · odoslané
(„skontroluj schránku") · chyba. (Heslo je len dev-pomôcka, do finálneho vizuálu ho neriešime.)

### 6.2 Prehľad `/` — **hero obrazovka č. 1**
Najdôležitejšia. Mriežka kariet všetkých aktívnych webov. **Karta = bodka stavu · názov · doména ·
uptime (30 d) · „pred X" (posledná kontrola).** Klik → detail.

- **Bodka stavu** kombinuje: aktuálny stav (up/down/degraded), otvorený incident, „nezistené" ak
  ešte nebol check. Nikdy len farba — aj tvar/ikona pre a11y.
- **Radenie/zoskupenie:** problémové weby hore (down → warning → ok → nezistené). Zvážiť sekciu
  „Vyžaduje pozornosť" navrchu (down, expirujúce domény/TLS ≤ 7 d, kritické alerty).
- **Filtre/prepínače** (ľahké): klient, tag, is_free, stav. Na mobile skryté za tlačidlom.
- **Desktop:** hutná mriežka (2–4 stĺpce) alebo kompaktná tabuľka; možnosť prepnúť „karty ↔ hustá tabuľka".
- **Mobil:** jeden stĺpec, veľká klikacia plocha, palcom dosiahnuteľné.
- **Stavy:** loading (skeleton kariet) · empty („zatiaľ žiadne weby · pridať") · error · populated ·
  **region-outage** (banner „Možný výpadok monitoringu — X/Y webov nedostupných").
- **Dátové pravidlo:** uptime číta denné rollupy, nie raw. Web bez rollupu → „nezistené", nie 0 %.

### 6.3 Zoznam webov `/sites`
Hutná tabuľka: názov · klient · doména · CMS · stav · uptime 30 d · perf skóre · # otvorených issues ·
doména/TLS expiry · tagy · is_free. Filtre: klient, tag, CMS, stav, is_free, „nemonitorované".
Radenie po stĺpcoch. Riadok klik → detail. Akcia „Pridať web". Na mobile: karty namiesto tabuľky.

### 6.4 Detail webu `/sites/[id]` — **hero obrazovka č. 2**
Hlavička: názov, doména (klik = otvoriť web), klient (odkaz), stavová bodka, rýchle badge
(uptime 30 d, perf, doména/TLS expiry, # issues). Pod ňou **taby**. Nie všetky taby existujú vo
všetkých fázach — navrhni tak, aby sa dali pridávať bez prestavby, a **nepripojené/nedostupné taby
komunikuj stavom, nie prázdnom**.

**Tab Prehľad** — sumár všetkého: aktuálny stav + posledný incident, uptime 24 h/7 d/30 d/90 d,
perf skóre + trend, # SEO issues, AEO skóre, doména + TLS expiry (dni, farebne podľa 30/14/7),
infra (WP/PHP verzia, # updatov, posledná záloha), rýchle odkazy (otvoriť web, WP admin cez
bitwarden_item_url, Notion).

**Tab Uptime** (fáza 1) — veľký uptime % (24 h/7 d/30 d/90 d), **uptime bar / kalendár** (30–90 dní,
zelené/žlté/červené segmenty), **p95 response time sparkline (30 d)**, **zoznam incidentov**
(začiatok, trvanie, príčina, posledný status kód). Prázdny stav: „zatiaľ žiadne incidenty" (pozitívne).

**Tab Performance** (fáza 2) — dva zdroje: **Lab (PSI/Lighthouse)** a **Field (CrUX)**. Metriky:
performance score (gauge 0–100), **LCP · INP · CLS · TBT · TTFB**, page weight, # requestov.
Prahy s farbou: **LCP ≤ 2,5 s · INP ≤ 200 ms · CLS ≤ 0,1** = zelená. Trend 90 dní, **delta oproti
minulému týždňu**. Mobile/desktop prepínač. **Empty:** „nedostatok field dát" (CrUX 404 pri malých
weboch) — nie chyba, samostatný pokojný stav. Bez PSI kľúča → „nepripojené".

**Tab SEO** (fáza 3) — dve časti:
- *Technická* (vždy): pages crawled, broken links, redirect chains, chýbajúce/duplicitné title,
  meta description, H1 (chýba/viac), obrázky bez alt, canonical, noindex, sitemap/robots stav,
  mixed content. **Zoznam issues** (URL · typ · severity · detail · first/last seen · resolved).
- *Výkonnostná* (potrebuje **GSC**): clicks, impressions, CTR, priem. pozícia, top 10 dopytov,
  top 10 stránok, coverage errors, indexované stránky, história 16 mes. **Bez GSC:** sekcia skrytá +
  „Search Console nepripojená · pripojiť". **Nikdy nefabrikuj SEO čísla.**

**Tab AEO** (fáza 3) — **skóre 0–100** (gauge) + trend + **actionable checklist** (čo opraviť, na
ktorej URL, s váhou). Kontroly: JSON-LD, relevantné typy (Organization/WebSite + bonusy), author/E-E-A-T,
freshness (dateModified), nadpisová štruktúra, priama odpoveď (≤ 320 zn.), FAQ bloky, llms.txt,
AI boti, canonical. **Špecialita: matica „AI bot × allow/block/nespomenutý"** (GPTBot, ClaudeBot,
PerplexityBot, Google-Extended, CCBot) — skóruje sa **vedomosť rozhodnutia**, nie „allow = dobré".
Navrhni túto maticu tak, aby Filip vedel rozhodnúť za klienta (toggle allow/block, vysvetlenie
kompromisu citácia vs tréning). Checklist je to, čo sa posiela klientovi ako podklad na prácu navyše.

**Tab Infra** (fáza 2) — s WP agentom: WP verzia + **core update dostupný**, PHP/MySQL verzia,
**tabuľka pluginov** (názov · verzia · nová verzia · aktívny · update?), témy, počet updatov (badge),
veľkosť DB/uploads, voľné miesto, **posledná záloha** (kedy, kde, provider), WP_DEBUG, stav WP-Cron,
# admin účtov. **Bez WP prístupu** (statické/cudzí hosting) → panel sa degraduje na zvonku zistiteľné:
doména (registrátor, expiry, nameservery, DNSSEC), TLS (issuer, valid_to), security headers, DNS diff.
Zvýrazni **zmenu nameserverov** (bezpečnostná udalosť). Prázdny/neprístupný stav jasne označený.

**Tab Klient** (fáza 1) — karta priradeného klienta (firma, kontakt, sadzba, typ zmluvy, paušál,
poznámky, is_free), odkazy na Notion a Bitwarden. **Žiadne heslá, žiadne kľúče — len odkazy.**

### 6.5 Klienti `/clients` a `/clients/[id]`
Zoznam: firma · kontakt · # webov · tier/paušál · stav (active/paused/archived) · is_free.
Detail: fakturačné a kontaktné údaje (IČO/DIČ/adresa/e-mail/telefón), sadzba, typ zmluvy, mesačný
paušál, poznámky, odkaz Notion, odkaz Bitwarden, **zoznam jeho webov** (s mini-stavom). Fáza 4+:
**biznis overlay** — hodiny/€ za web za kvartál (z Notionu) → ktorý klient je stratový. `staff`
rola fakturačné čísla nevidí.

### 6.6 Alerty `/alerts`
Feed najnovších alertov. Riadok: **severity bodka/ikona** · typ · titulok · web · čas („pred X") ·
stav (odoslané/čaká) · akcia **„Vyriešené"**. Filter podľa severity (všetky/critical/warning/info)
a podľa webu. Vyriešené stlmené. Typy: site_down/up, tls_expiring, domain_expiring, perf_regression,
core_update, vuln_found, region_outage. Navrhni **vizuálne odlíšenie critical vs warning vs info**
(nie len farba — ikona + váha). Prázdny stav: „žiadne alerty" (pokojné, pozitívne).

### 6.7 Nastavenia `/settings`
Sekcie: **Organizácia** (názov, prihlásený používateľ, # webov) · **Integrácie / API kľúče**
(PSI, GSC OAuth, Resend — každá so stavom *pripojené/nepripojené* a akciou) · **Notifikácie**
(príjemcovia, denný digest 07:00, prahy) · **Retencia** (30 d raw / 13 mes snapshoty — informačné) ·
**Tím** (fáza 4: pozvať člena, roly owner/staff/client). Notifikačné kanály: e-mail (MVP); Slack/
Telegram sú budúce — navrhni sekciu tak, aby sa dali pridať kanály.

### 6.8 Verejná status page `/status/[slug]` (fáza 4) — **predajný artefakt**
Read-only, bez loginu, **brandovateľná pre klienta**. Ukazuje: aktuálny stav webu/ov, uptime
(30/90 d) ako farebný bar, história incidentov (dátum, trvanie, popis). Žiadne interné čísla, žiadne
infra detaily. Musí vyzerať dôveryhodne a čisto — toto vidí klient. Navrhni light/dark + mobilný.

### 6.9 Mesačný report (fáza 4) — **predajný artefakt, HTML e-mail + PDF**
To, čo klient za 29 € reálne dostane do ruky. Layout na **A4 PDF aj responzívny e-mail**. Obsah:
hlavička (klient, mesiac, logo agentúry), **uptime % za mesiac**, **urobené updaty** (jadro/pluginy,
zoznam), **perf trend** (graf mesiac/predchádzajúci), **otvorené/vyriešené issues**, expirácie na
obzore, zhrnutie „čo sme spravili". Tón: zrozumiteľný pre neinžiniera, dôveryhodný. Navrhni tlačovú
aj e-mailovú verziu.

### 6.10 Klientský portál (fáza 4)
Rovnaké routy, rola `client` → vidí **len svoje weby**, read-only, zjednodušené (žiadne infra
interné, žiadne fakturačné). V podstate „prihlásená verzia status page + report história". Navrhni
ako filtrovaný/oklieštený režim existujúcich obrazoviek, nie samostatný produkt.

### 6.11 Security panel (fáza 4)
Časť tabu Infra alebo vlastný tab: **security headers** (HSTS, CSP, X-Frame-Options,
X-Content-Type-Options) so skóre, Safe Browsing stav, **vuln matica** — plugin verzia × známa CVE
(silný upsell: „tvoj web má plugin s aktívne zneužívanou zraniteľnosťou"). Navrhni tak, aby
kritické zraniteľnosti boli neprehliadnuteľné a dali sa poslať klientovi ako argument.

---

## 7. Kľúčové komponenty (component library)

Navrhni ako znovupoužiteľné, s variantmi a stavmi:

- **Status pill / bodka** — up/warning/down/unknown; s ikonou (a11y), s textom.
- **Uptime bar / kalendár** — 30–90 dní segmentov (zelená/žltá/červená/sivá-nezistené), hover =
  deň + %.
- **Sparkline** — response time / metrika v čase (Recharts).
- **Score gauge / radiál** — perf 0–100, AEO 0–100, security 0–100; farba podľa prahu.
- **Metric card s deltou** — veľké číslo + jednotka + delta oproti minulému týždňu (↑/↓ farebne),
  + stav „nezistené/nepripojené".
- **Incident timeline / riadok** — začiatok, trvanie, príčina, status.
- **Alert row** — severity, typ, web, čas, akcia.
- **AI-bot matica** — bot × allow/block/nespomenutý, prepínateľná.
- **Update/plugin tabuľka** — verzia → nová verzia, badge „N updatov".
- **Expiry indikátor** — dni do expirácie domény/TLS, farba podľa prahu (30/14/7 · 21/7).
- **Empty-state** dvoch typov: *„ešte žiadne dáta"* (neutrálne) vs *„integrácia nepripojená ·
  pripojiť"* (akčné). **Vizuálne odlíšené.**
- **Blocked-state** — WAF 403 („blokované, nie výpadok") ako samostatný pokojný stav.
- **Filtre / segment control**, **tabuľka** (radenie, hustá/vzdušná), **tabs**, **drawer/sheet**
  (mobil), **theme toggle**, **region-outage banner**.

---

## 8. Metriky a prahy (farebná logika)

| Oblasť | Metrika | 🟢 ok | 🟡 warning | 🔴 critical |
|---|---|---|---|---|
| Uptime | uptime % (30 d) | ≥ 99,5 | 95–99,5 | < 95 |
| Uptime | aktuálny stav | up | 1 fail (degraded) | ≥ 2 faily (down) |
| Perf | performance score | ≥ 90 | 50–89 | < 50 |
| Perf | LCP | ≤ 2,5 s | 2,5–4 s | > 4 s |
| Perf | INP | ≤ 200 ms | 200–500 ms | > 500 ms |
| Perf | CLS | ≤ 0,1 | 0,1–0,25 | > 0,25 |
| AEO / SEO / Security | skóre 0–100 | ≥ 80 | 50–79 | < 50 |
| Doména | dni do expirácie | > 30 | 30 / 14 | 7 / expirované |
| TLS | dni do expirácie | > 21 | 21 | 7 / expirované |
| Infra | # dostupných updatov | 0 | 1–5 | > 5 alebo core |

Chýbajúci údaj v ktorejkoľvek → **⚪ „nezistené / nepripojené"**, nikdy zelená/červená/0.

---

## 9. Technické mantinely pre dizajn

- **Statický export (SPA, žiadny SSR).** Všetko sa renderuje na klientovi z dát cez Supabase +
  RLS. Návrh nesmie predpokladať server-render vzory (žiadne per-request SSR triky). Detail routy
  môžu byť query-param.
- **Supabase realtime je možné** — zváž jemné live-updaty (bodka stavu, nový alert) bez reloadu.
- **Ľahký bundle** (fáza 1 na free tieri). Žiadne ťažké vizuálne knižnice; drž sa Tailwind +
  shadcn + Recharts. Ikony jednotná sada (napr. lucide).
- **Slovenčina**, `D. M. RRRR`, `1 401,32 €`, Europe/Bratislava.
- **Dodaj design tokens** (farby light/dark, spacing, radius, tiene, typo škála) — nech sa dá
  namapovať na Tailwind theme.

---

## 10. Priorita pre dizajn (čo navrhnúť najskôr)

1. **Design system / tokens** + light/dark + semantická paleta + typografia.
2. **Prehľad `/`** (mobil + desktop) — hero, najviac používaná.
3. **Detail webu** — hlavička + tab Uptime + tab Prehľad.
4. **Alerty**, **Zoznam webov**, **Klient detail**.
5. Taby **Performance · SEO · AEO · Infra** (fáza 2–3) — vrátane všetkých empty/nepripojené stavov.
6. **Status page** + **Mesačný report** (predajné artefakty, fáza 4).
7. **Nastavenia**, **klientský portál**, **security**.

Pre každú kľúčovú obrazovku chcem: **mobil + desktop**, **light + dark**, a **stavy**
(loading · empty · nepripojené · error · populated · blocked kde dáva zmysel).

---

## 11. Explicitné ne-ciele (nenavrhovať)

Analytika návštevnosti (má GA4), content kalendár, ticketing (má Notion), UI na spúšťanie
auto-updatov (updaty ostávajú manuálne, zámerne). Žiadne ukladanie hesiel/kľúčov — všade len
odkazy (Bitwarden/Notion).

---

## 12. Podklady, ktoré dodám

- Logo / brand agentúry (ak má byť použité) alebo súhlas navrhnúť neutrálny brand.
- Reálne názvy webov/klientov pre realistické mockupy (alebo použiť demo: „Zdravý web", „Padnutý
  web", …).
- Preferencie farieb, ak nejaké sú (inak plná voľnosť podľa princípov v §3–4).
