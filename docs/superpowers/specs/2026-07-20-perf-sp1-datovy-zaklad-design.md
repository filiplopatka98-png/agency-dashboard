# Performance overhaul — SP1: dátový základ + collector (design)

**Dátum:** 2026-07-20
**Kontext:** Prestavba Performance záložky (inšpirácia: PageSpeed monitoring nástroj —
per-page skóre, lab/CrUX toggle, mobile/desktop, časové filtre, grafy Score History
+ Web Vitals, pridávanie/odstraňovanie stránok, on-demand sken, Issues tab). Celé je
rozložené na 3 sub-projekty; **toto je SP1** — dátový základ, na ktorom stoja SP2
(on-demand sken) aj SP3 (UI). SP1 nezahŕňa žiadne UI ani sken na požiadanie.

## Rozhodnutia vlastníka (záväzné, 2026-07-20)
- **Výber stránok:** homepage sa monitoruje automaticky; ďalšie URL pridáva owner ručne
  (add/remove UI je SP3). SP1 nasadí homepage a pripraví model pre ďalšie stránky.
- **História:** denný záznam na stránku×stratégiu, **retencia 1 rok**.
- **Prístup k modelu:** A — entita `monitored_pages` + append-only `perf_runs`.
- **Spätná kompatibilita:** homepage-beh ostáva „výkonom webu" pre existujúce konzumenty
  (report/digest/alerty/history) cez zachovaný `perf_snapshots`; per-page je vrstva navrch.

## Súčasný stav (grounding)
- `perf_snapshots` PK `(site_id, strategy)`, **latest-only** (psi-probe upsert
  `on_conflict=site_id,strategy` merge). Žiadna história, viazané na web.
- `sites` má jednu `url` + `domain`. Žiadny koncept viacerých stránok.
- `parsePsi` (packages/core/src/psi.ts) zbiera perf/a11y/bp/seo, lcp/inp/cls/tbt/ttfb,
  pageWeight, requests, CrUX field (lcp/inp/cls). **NEzbiera FCP ani opportunities.**
- Konzumenti `perf_snapshots`: `apps/web` data-vrstva, weekly-digest, monthly-report,
  history-snapshot (→ metric_history), psi-probe denná detekcia prepadu (baseline z
  metric_history), strážca čerstvosti. **SP1 ich nesmie rozbiť.**

## Schéma (nová migrácia, ďalšie číslo v poradí)

### `monitored_pages`
```
id uuid pk default gen_random_uuid()
site_id uuid not null references sites on delete cascade
org_id uuid not null references organizations on delete cascade
url text not null                 -- plná URL vrátane schémy (https://…)
is_homepage boolean not null default false
active boolean not null default true
added_at timestamptz not null default now()
unique (site_id, url)
```
- RLS ako `perf_snapshots` (org members read, staff write).
- **Seed v migrácii (idempotentný):** pre každý `sites` (aj neaktívny, nech sa
  zachová 1:1) vlož homepage riadok `is_homepage=true, url=sites.url` ak ešte
  neexistuje (`on conflict (site_id,url) do nothing`).

### `perf_runs` (append-only)
```
id uuid pk default gen_random_uuid()
page_id uuid not null references monitored_pages on delete cascade
org_id uuid not null references organizations on delete cascade
strategy text not null            -- 'mobile' | 'desktop'
performance_score int, accessibility int, best_practices int, seo int
lcp_ms int, fcp_ms int, inp_ms int, cls numeric, tbt_ms int, ttfb_ms int
page_weight_kb int, requests int
field_lcp_ms int, field_inp_ms int, field_cls numeric   -- CrUX, nullable
opportunities jsonb not null default '[]'   -- top ~8 Lighthouse opportunities
measured_at timestamptz not null default now()
error text
```
- Index `(page_id, strategy, measured_at desc)` — latest aj časový rozsah.
- `check (jsonb_typeof(opportunities) = 'array')`.
- RLS ako vyššie.

### Retencia
- pg_cron job `perf_runs_retention` (v štýle 0013): `delete from perf_runs where
  measured_at < now() - interval '365 days'` (raz denne). Pomenovaný → re-run
  migrácie aktualizuje.

## Core: `parsePsi` (packages/core/src/psi.ts)
- Pridať do `PerfSnap`: `fcpMs: number | null` (audit `first-contentful-paint`).
- Pridať `opportunities: PsiOpportunity[]` kde
  `PsiOpportunity = { id: string; title: string; savingsMs: number | null; savingsBytes: number | null; score: number | null }`.
  - Extrakcia: z `lighthouseResult.audits` ber **len** audity kde
    `details.type === 'opportunity'` (to je presne sekcia „Opportunities", ktorú
    Lighthouse zobrazuje). `savingsMs = details.overallSavingsMs ?? null`,
    `savingsBytes = details.overallSavingsBytes ?? null`, `score = audit.score ?? null`.
    Filtruj tie, čo reálne majú čo zlepšiť (`score < 1`). Zoradiť podľa `savingsMs`
    desc (null-y na koniec), vziať **top 8**. Bez fabrikácie: chýbajúca úspora = null.
    Diagnostiku (`details.type !== 'opportunity'`) zámerne NEberieme — je fuzzy.
  - Presné mapovanie audit polí doriešiť v pláne (title = `audit.title`, id = kľúč auditu).
- Pure, testovateľné (sample json). `fetchPsi` sa nemení (len parser vracia navyše).

## Collector: `tools/psi-probe/index.mjs`
- **Vstup:** aktívne weby → pre každý načítať `monitored_pages?select=…&site_id=eq.<id>&active=eq.true`.
  Homepage tam vždy je (seed). Cap: max **10** aktívnych stránok/web (konštanta
  `MAX_PAGES_PER_SITE`; ak by ich bolo viac, vezmi homepage + najstaršie pridané po cap,
  zvyšok preskoč s logom — nefabrikujeme, len obmedzíme záťaž).
- **Beh:** pre každú stránku × `['mobile','desktop']` → `fetchPsi(page.url, …)` (existujúci
  retry ostáva). Súbežnosť obmedzená na **~4** naraz (jednoduchý worker-pool; PSI to znesie).
- **Zápis:**
  - Vždy: append `perf_runs` riadok (skóre + vitals + fcp + CrUX + opportunities +
    measured_at + error). Chyba behu → riadok s `error` a nulovými skóre (rovnaká
    zero-fabrication logika ako dnes).
  - Ak `page.is_homepage`: navyše upsert `perf_snapshots` **presne ako dnes**
    (`on_conflict=site_id,strategy`) — spätná kompatibilita, existujúci konzumenti bez zmeny.
- **ok/failed:** počítať per stránka×stratégia (16+ jednotiek). Zapadá do
  `job_failed` pravidla (menšinová flakinesss nepošle alert; systémový výpad áno).
- **Denná detekcia prepadu (existujúca):** ostáva viazaná na homepage/`metric_history`
  bez zmeny (číta baseline z metric_history, ktorý plní history-snapshot z perf_snapshots).
  Per-page detekcia prepadu je mimo SP1 (prípadne neskôr).

## Spätná kompatibilita — explicitne
- `perf_snapshots` sa NEmaže ani nemení; psi-probe ho pre homepage naďalej upsertuje.
- Žiadny existujúci konzument (`apps/web` data-vrstva, digest, report, history-snapshot,
  freshness, psi drop-detekcia) sa v SP1 nedotýka. Overí sa to behom naostro.

## Rozsah — čo SP1 NErobí (YAGNI / iné SP)
- Žiadne UI (rings, toggly, filtre, grafy, pages tabuľka, Issues tab) — **SP3**.
- Žiadny on-demand sken jednej stránky — **SP2**.
- Žiadne zobrazenie opportunities klientovi ani v reporte — **SP3** (SP1 ich len ukladá).
- Add/remove stránok cez UI — **SP3** (SP1 nasadí len homepage; ďalšie sa dovtedy dajú
  vložiť ručne SQL-om, nie je to blocker).
- Per-page detekcia prepadu / alerty — mimo (zváži sa neskôr).

## Testovanie
- Unit (`psi.test.ts`): parsePsi extrahuje `fcpMs`; opportunities — zoradenie podľa
  savingsMs, cap 8, null-savings keď audit nemá úsporu, prázdne pole keď žiadne.
- `node --check` collectora.
- Overenie naostro po nasadení (mimo commitu): manuálny psi beh → `perf_runs` má riadky
  per stránka×stratégia s opportunities; `perf_snapshots` homepage stále aktuálny;
  žiadny existujúci report/alert sa nezmenil.

## Nasadenie
- Migrácia cez pg pooler (ako 0034/0035). Kód collectora + core cez `git push`
  (psi-probe.yml už builduje core). Bez zmeny Workera (SP1 sa Workera netýka).
