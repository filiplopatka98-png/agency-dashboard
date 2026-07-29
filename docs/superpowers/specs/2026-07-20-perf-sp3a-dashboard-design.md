# Performance overhaul — SP3a: read-only dashboard (design)

**Dátum:** 2026-07-20
**Kontext:** Tretí sub-projekt (UI). SP3a prestavia existujúci **Performance tab**
(`TabPerformance` v `apps/web/app/sites/page.tsx`) na plný dashboard zo screenshotu:
veľké krúžky, prepínače lab/CrUX + mobile/desktop, časové filtre, grafy Score History
+ Web Vitals, Issues sekcia. Read-only — číta `perf_runs` (SP1). Interaktívna časť
(pages tabuľka + on-demand scan button) je **SP3b**. Stavia na SP1 (dáta) + SP2 (sken,
využije SP3b).

## Rozhodnutia vlastníka
- Rozklad SP3a (read-only) → SP3b (pages + scan) potvrdený.
- Grafy: **vlastný SVG** (nie recharts) — dep-light, matchuje hand-rolled dizajn systém.
- Charting detaily, defaulty a lab/CrUX správanie: „decide for me" → best practices (nižšie).

## Súčasný stav (grounding)
- `TabPerformance` (inline v `sites/page.tsx`) dnes: device toggle (desktop/mobile), 4
  `Gauge` krúžky (Performance/A11y/BP/SEO) cez `gaugeOffset`+`scoreColor` (`lib/design.ts`),
  „Lab · Lighthouse" karta + field/CrUX sekcia (`hasField`), `FreshLabel`. Dáta z
  `site.perf[device]` (`PerfSnapVM`) — z `perf_snapshots` (latest), načítané v batch
  `data.ts getDashboard()` cez supabase browser client.
- **`perf_runs` história sa dnes v UI vôbec nečíta** — grafy sú nové dáta.
- `lib/design.ts` má `scoreColor(s)`, `gaugeOffset(score, circ)`, `sparklineFromValues`,
  `cwvMeta` — testované v `design.test.ts` (vzor pre naše testy).
- RLS: `perf_runs` + `monitored_pages` sú org-members-read → client-side supabase query
  s JWT prejde. Retencia histórie 1 rok (SP1).

## Štruktúra súborov (best practice — `page.tsx` je už veľký, nerozširovať)
- `sites/TabPerformance.tsx` — kontajner (extrahovaný z page.tsx + prestavaný). Zdieľané
  UI atómy, čo potrebuje (`Gauge`, `card` štýl), sa presunú do malého modulu
  `sites/perf/ui.tsx` (alebo ostanú re-definované) — vyrieši plán.
- `sites/perf/usePerfData.ts` — client-side hook: `usePerfData(pageId, strategy, sinceIso)`
  → `{ history: PerfRun[]; latest: PerfRun | null; loading; error }`. Query: `perf_runs`
  pre `(page_id, strategy)` kde `measured_at >= sinceIso`, `order measured_at asc`. Latest
  = posledný prvok. `pageId` je homepage webu (SP3a ho resolvne cez `monitored_pages
  ?site_id=eq&is_homepage=eq.true`); SP3b odovzdá vybranú stránku.
- `sites/perf/perfChart.ts` — **čisté** (testovateľné) helpery: škálovanie dát → SVG
  súradnice, shaping `perf_runs` → série, výber časového okna. Bez Reactu/DOM.
- `sites/perf/LineChart.tsx` — SVG multi-series čiarový graf (konzumuje výstup
  `perfChart.ts`): osi, čiary, legenda (toggle série), hover tooltip, `role="img"` +
  `aria-label` zhrnutie. Theme-aware (CSS premenné, dark-mode).
- `sites/page.tsx` — `{tab === 'performance' && <TabPerformance site={site} />}` (už tam
  je; komponent sa presunie do vlastného súboru).

## Layout & správanie
### Krúžky (rings)
4 veľké `Gauge` (Performance/A11y/BP/SEO) z **latest `perf_runs`** pre (homepage, stratégia),
farba `scoreColor`. (Zdroj sa mení z `perf_snapshots` na `perf_runs` — rovnaké hodnoty,
homepage píše oboje; `perf_runs` má navyše históriu.) Null skóre → „—".

### Prepínače
- **mobile/desktop** — mení `strategy` (rings + grafy + vitals). Zachovaj existujúci štýl.
- **lab/CrUX** — *(best practice)* mení **Web Vitals** zdroj: lab = Lighthouse
  (`lcp_ms/fcp_ms/tbt_ms/ttfb_ms`), CrUX = field (`field_lcp_ms/field_inp_ms/field_cls`).
  Krúžky (kategórie skóre) ostávajú **vždy Lighthouse** — CrUX kategórie skóre nemá.
  Web bez CrUX dát (väčšina malých webov) v CrUX režime → čestné „Žiadne dáta z reálnych
  návštevníkov (CrUX) — málo návštevnosti."

### Časové filtre
7D / 14D / 30D / all / range. *(best practice)* default **30D**. Filter určuje `sinceIso`
pre hook (a teda okno grafov). „all" = 365 dní (retencia). „range" = dva date inputy
(od–do) → `sinceIso`/until. Filtre menia LEN grafy (rings/issues sú vždy latest).

### Grafy (vlastný SVG cez `LineChart`)
- **Score History** — 4 série (Perf/A11y/BP/SEO) v čase z `history`. Legenda toggluje
  série. Hover → tooltip (dátum + hodnoty viditeľných sérií). Y os 0–100.
- **Web Vitals** — lab: LCP/FCP/TBT/TTFB (ms); CrUX: LCP/INP (ms) + CLS (×1000 pre
  čitateľnú os, label pravdivý). Y os auto-scale. Rôzne jednotky → tooltip s jednotkou.
- Málo bodov (nový web, 1–2 merania) → vykresli body/krátku čiaru, žiadne fabrikované
  interpolácie. Prázdna história → „Zatiaľ málo meraní na graf (zbiera sa denne)."

### Issues sekcia
`opportunities` (jsonb) z **latest `perf_runs`** (vybraná stratégia): zoznam `title` +
odhad úspory (`savingsMs` „~0,9 s", príp. `savingsBytes`), zoradené podľa `savingsMs` desc.
Technické (admin tab). Prázdne → „Žiadne zásadné príležitosti na zlepšenie."

### Stavy (best practice)
Skeleton počas `loading`; nová stránka bez behov → „Zatiaľ žiadne merania (PSI beží denne)";
`error` → nevtieravá hláška + možnosť skúsiť znova (re-fetch). A11y: grafy `role="img"` +
`aria-label` zhrnutím; jeden `<h1>` pravidlo stránky sa nemení (toto je tab, nie stránka).

## Rozsah — čo SP3a NErobí
- Žiadna pages tabuľka, add/remove stránok, ani scan button/polling — **SP3b**.
- Žiadny výber stránky (len homepage) — SP3b (hook už berie `pageId`, aby to sadlo).
- Žiadne zmeny backendu/dát (číta existujúce `perf_runs`); žiadny report/klient dopad.

## Testovanie
- `perfChart.test.ts` (vitest, ako `design.test.ts`): škálovanie (dáta+rozmery → body,
  správne min/max, prázdny vstup, jeden bod), shaping `perf_runs` → série (vybrané polia,
  null-safe, poradie podľa času), časové okno (range → sinceIso). Čisté funkcie.
- Komponenty (TabPerformance/LineChart/usePerfData) sa neunit-testujú (client-side; appka
  testuje len čisté helpery) — overia sa vizuálne na dev serveri (Claude Preview) + po deployi.
- `pnpm -r test` + `pnpm -r lint` zelené; build web OK.

## Nasadenie
- Len frontend → `git push` + web deploy cez `v*` tag (deploy.yml, brána typecheck/test/lint).
- Žiadna migrácia, žiadny Worker, žiadny secret. Vizuálne overenie na dev serveri pred tagom.
