# Reporty: „čo sa zmenilo za obdobie" — design

**Dátum:** 2026-07-16
**Stav:** schválený dizajn, čaká na implementačný plán

## Cieľ

Týždenné (admin) a mesačné (klient + admin) reporty majú ukazovať, **čo sa za obdobie
reálne udialo**: aké aktualizácie prebehli, čo sa opravilo, ktoré skóre sa zlepšilo,
aké výpadky sme zachytili. Klient má vidieť, že sa na webe pracuje. Admin vidí navyše
aj zhoršenia.

Verejná status page dostane históriu výpadkov + dôkaz dohľadu (bez technických detailov).

## Rozhodnutia (odsúhlasené)

| Otázka | Rozhodnutie |
|---|---|
| Zdroj obsahu | Automatika **+ priebežný pracovný denník** (voliteľný; report odíde aj bez neho) |
| Tichý mesiac | **Zhrnutie dohľadu** („8 640 kontrol, 100 % uptime…"), nie prázdno |
| Výpadky u klienta | **Vyriešené ukázať**, otvorené problémy a zhoršenia skryť |
| Zápis poznámok | **Priebežný denník** k webu (dátum + text) |
| Publikum | Bez zmeny: týždenný = admin, mesačný = klient + admin |
| Jazyk | Klient = ľudská reč; admin = stručne technicky |
| Hlas | **Hybrid**: denník = agentúrny („optimalizovali sme"), auto-udalosti = vecný („WooCommerce bol aktualizovaný") |
| Verejná page | **História výpadkov + dôkaz dohľadu.** Žiadne verzie softvéru, CVE, SEO issues ani skóre |

## Východiskový stav (čo dnes máme / nemáme)

**Máme:** `metric_history` (týždenné hodnoty), `change_log` (skóre zmeny + down/up),
`incidents` (`started_at`/`resolved_at`), `uptime_daily` (**`checks`, `up`,
`uptime_pct`, `downtime_seconds`**, retencia 13 mes.).

**Nemáme (a je to jadro zadania):**
- **História updatov.** `wp_snapshots` má PK `site_id` a pri každom ingeste sa
  prepíše → stará verzia sa zahodí. „WooCommerce 5.1 → 5.4" je dnes nezistiteľné.
- **Čo konkrétne sa opravilo.** Pri CVE aj SEO držíme len *aktuálny* zoznam
  a *počet* v histórii. Vieme „ubudli 3 issues", nie *ktoré*.

**Dôsledok:** história sa nedá doplniť spätne. Prvý report po nasadení bude chudobný;
plne sa funkcia prejaví po ~mesiaci zbierania.

## Prístup

**Diff v momente merania → zapíš udalosť.** Tam, kde dnes prepisujeme snapshot,
najprv porovnáme starý a nový stav a rozdiel zapíšeme do existujúceho `change_log`
(má už RLS, retenciu aj feed v UI). Zamietnuté alternatívy: ukladať celé historické
snapshoty (kanón na vrabca pri 8 weboch), a odvodzovať len z `metric_history`
(nesplní zadanie — updaty sú nezistiteľné).

## 1. Dátový model

### `change_log` + `payload jsonb`

Štruktúrované fakty; existujúci `message` ostáva ako admin riadok (už ho používa
feed aj digest). Jazyk sa skladá až pri renderovaní → znenie sa dá meniť bez
prelogovania dát.

| kind | payload | `severity` |
|---|---|---|
| `update` | `{target:'plugin'\|'core', name, slug, from, to}` | `info` |
| `cve` | `{direction:'fixed'\|'new', cve, target, severity}` | fixed → `info`, new → `critical` |
| `seo` | `{direction:'fixed'\|'new', type, was_count}` | fixed → `info`, new → `warning` |
| `score` | `{metric, from, to, direction:'up'\|'down'}` | up → `info`, down → `warning` |

`severity` je NOT NULL a používa ho existujúci feed v UI; klientsky filter sa však
riadi `payload.direction`, nie severity (explicitné a testovateľné).

### Nová tabuľka `work_log`

`id, org_id, site_id (NOT NULL), happened_at (date), text, created_at`. RLS ako inde
(org members read, staff write). **Bez retencie** — je to vykonaná práca.
Záznam patrí vždy ku konkrétnemu webu (reporty aj UI sú organizované po weboch);
klientske poznámky mimo webu v1 neriešime (YAGNI).

### Zdroje pre report

- Výpadky: priamo z `incidents` (nie z `change_log` — tam sú dva riadky, my chceme
  jednu vetu s trvaním)
- Dohľad: `SUM(checks)`, `AVG(uptime_pct)`, `SUM(downtime_seconds)` z `uptime_daily`

## 2. Zber udalostí

| Miesto | Diff | Udalosť |
|---|---|---|
| `wpIngest.ts` | jadro + pluginy podľa `slug` pred upsertom | `update` |
| `tools/wp-cve` | starý vs nový zoznam podľa `cve+slug` | `cve` fixed/new |
| `tools/seo-crawl` | issues podľa `type` | `seo` fixed/new |
| `tools/history-snapshot` | **len skóre** (CVE/SEO počítanie sa odstraňuje) | `score` |

**Poistky:**
- Prvý ingest (žiadny predchádzajúci snapshot) → **nula udalostí**
- v1 rieši len zmeny verzií; nové/odinštalované pluginy vynechané (YAGNI)

**Prahy:**
- AEO / Security: **±3** — deterministické kontroly z HTML a robots.txt, zmena = skutočná zmena
- Výkon (PSI): **ostáva ±10** — PageSpeed dá tomu istému webu bežne ±5 medzi behmi;
  nižší prah by generoval „zrýchlili sme o 4 body" tam, kde sa nezmenilo nič (= fabrikácia)
- SEO / CVE: presné udalosti, prah 1

## 3. Renderovanie (core, čisté funkcie)

- **`isClientVisible(event)`** — podľa `payload.direction`, nie severity:
  `update` → vždy · `cve/seo fixed` → áno, `new` → nie · `score up` → áno, `down` → nie
- **admin** = existujúci `message`
- **`renderClient(event)`** — veta z `payload`, vecný hlas

| udalosť | admin | klient |
|---|---|---|
| update | `WooCommerce 5.1 → 5.4` | „WooCommerce bol aktualizovaný na verziu 5.4." |
| cve fixed | `CVE-2024-1234 fixed (WooCommerce)` | „Odstránená bezpečnostná zraniteľnosť vysokej závažnosti v module WooCommerce." |
| seo fixed | `Chýbajúci canonical — fixed (12)` | „Opravené: chýbajúce označenie hlavnej verzie stránky — na 12 stránkach." |
| score up | `AEO 48 → 78` | „Pripravenosť webu pre AI vyhľadávače sa zlepšila zo 48 na 78 bodov." |

**Mapovania** (SEO typ → klientsky text; metrika → „Rýchlosť na mobile" atď.)
s fallbackom na pôvodný text pri neznámom kľúči.

**Denník** = agentúrny hlas (doslova text používateľa).
**Výpadok** = „Zachytili sme krátky výpadok 3. 7. o 14:12, trval 12 minút."
Že sme ho zachytili je pravda; že sme ho opravili **netvrdíme** (web sa mohol obnoviť sám).

## 4. Výstupy

### Klientsky mesačný report (len jeho weby)
1. **Zhrnutie dohľadu** — reálne čísla z `uptime_daily`
2. **Per web „Čo sa dialo"** — chronologicky zlúčené: denník + client-visible udalosti + vyriešené výpadky
3. **Tichý web** → „Stabilne bez problémov — 2 880 kontrol, 100 % dostupnosť, žiadne známe zraniteľnosti, všetky pluginy aktuálne."

### Admin mesačný agregát
Ako dnes + **všetko** vrátane zhoršení, per web.

### Admin týždenný digest
Existujúca sekcia „Za posledný týždeň" sa automaticky obohatí o nové presné udalosti.

### Verejná status page
Pridať: **história vyriešených výpadkov za 90 dní** (dátum + trvanie) + **dôkaz dohľadu**
(„25 920 kontrol za 90 dní, 99,98 %"). Rozšíri sa RPC `public_client_status`.
Prebiehajúci výpadok sa do zoznamu nedáva — ten je už vidno na aktuálnom stave webu.

**Zámerne NIE:** verzie softvéru, CVE, SEO issues, skóre, denník — slug je
uhádnuteľný a stránka world-readable; zverejnenie verzií a minulých zraniteľností
je návod pre útočníka.

### Denník v UI
Nový tab **„Denník"** v detaile webu: pole dátum + text, zoznam záznamov, mazanie.

## 5. Chyby a hranice

- Diff **nesmie zhodiť collector** — pri zlyhaní zápisu udalosti sa snapshot aj tak
  uloží (log-and-continue). Integrita dát > zoznam udalostí.
- Neznámy typ/metrika → fallback na pôvodný text.
- Nové súbory, každý s jednou úlohou:
  - `core/events.ts` — typy + `diffPlugins`, `diffVulns`, `diffSeoIssues` (čisté, bez I/O)
  - `core/reportText.ts` — renderery + mapovania (čisté)
  - collectory volajú diff a zapisujú; reporty čítajú a renderujú

## 6. Testy

- diff funkcie — vrátane prvého behu a „nič sa nezmenilo"
- každý typ udalosti → klientska aj admin veta
- fallback pri neznámom type
- **kľúčový test dôvery:** zhoršenie (`direction:'down'`, `cve new`) **nesmie**
  prejsť do klientského výstupu
- verejné RPC nevracia verzie/CVE/skóre
