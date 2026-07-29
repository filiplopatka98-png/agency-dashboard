# Performance overhaul — SP2: on-demand PSI sken (design)

**Dátum:** 2026-07-20
**Kontext:** Druhý sub-projekt Performance prestavby. Button „skenuj teraz" pre jednu
stránku → okamžité PSI meranie mimo denného cronu, výsledok v `perf_runs`. SP2 dodáva
**backend** (Worker endpoint + tabuľka + secret + logika); samotný button/spinner/
zobrazenie je SP3 (UI). Stavia na SP1 (`monitored_pages`, `perf_runs`, `parsePsi`).

## Rozhodnutia vlastníka (záväzné, 2026-07-20)
- **Rozsah skenu:** len práve zobrazená stratégia (mobile ALEBO desktop), nie obe.
- **Mechanizmus:** A — Worker spustí PSI priamo (nie dispatch GitHub workflow; runner
  spin-up ~1–2 min by zabil „real-time").
- **On-demand píše LEN `perf_runs`** — nedotýka sa `perf_snapshots` ani nespúšťa
  `metric_drop` alert. Manuálny sken = extra dátový bod v histórii + čo vidno v UI;
  „oficiálny" latest (perf_snapshots) + alerty ostávajú na dennom zbere. Žiadny
  e-mailový šum, keď si owner sám kliká.
- **Rate-limit:** 60 s — blokni, ak pre tú stránku+stratégiu už beží sken (in-flight)
  alebo dobehol pred menej než 60 s.

## Grounding (súčasný stav)
- Worker (`apps/scheduler/src/index.ts`) má jednoduchý pathname router (`/trigger`,
  `/wp-ingest`) + CORS. `trigger.ts` má `verifyJwt` (ES256 cez Supabase JWKS) +
  `isOwnerOrStaff(env, userId)` — znovupoužiteľné pre `/scan` auth.
- `PSI_API_KEY` **NIE je** Worker secret (Worker dnes PSI nepúšťa) — pridá sa cez
  `wrangler secret put PSI_API_KEY` (a do `Env` v `env.ts`).
- Worker bundluje `@agency/core` → vie importovať `fetchPsi` + `parsePsi`.
- `perf_runs` (SP1) je cieľová tabuľka; UI číta cez PostgREST + JWT (RLS org-members-read).

## Schéma (migrácia 0037 — auto-aplikuje sa cez migrate.yml)

### `scan_jobs`
```
id uuid pk default gen_random_uuid()
page_id uuid not null references monitored_pages on delete cascade
org_id uuid not null references organizations on delete cascade
strategy text not null                 -- 'mobile' | 'desktop'
status text not null default 'pending' -- 'pending' | 'done' | 'error'
error text
requested_at timestamptz not null default now()
finished_at timestamptz
```
- Index `(page_id, strategy, requested_at desc)` — rate-limit lookup + UI poll.
- RLS: org members read (UI poll cez JWT), staff write; grant service_role all
  (Worker píše service_role). Vzor ako `perf_runs` (SP1).
- Retencia: pg_cron `scan_jobs_retention` (v štýle 0013) — `delete … where requested_at
  < now() - interval '7 days'` (raz denne). Sú to len operačné stavy, netreba históriu.

## Worker: `/scan` endpoint (`apps/scheduler/src`)
- **Route:** `POST /scan` v `index.ts` fetch handleri (+ `OPTIONS /scan` → CORS 204,
  ako `/trigger`). Nový modul `apps/scheduler/src/runScan.ts`.
- **Auth:** Bearer JWT → `verifyJwt` (ES256) → `isOwnerOrStaff`. Fail → 401/403
  (fail closed, presne ako `/trigger`).
- **Vstup:** `{ page_id: string, strategy: 'mobile'|'desktop' }`. Validuj (strategy
  whitelist; page_id je uuid). Neplatné → 400.
- **Načítaj stránku** cez service_role: `monitored_pages?id=eq.<page_id>&select=id,org_id,url,active`.
  Neexistuje/neaktívna → 404.
- **Rate-limit (jedno pravidlo):** vezmi NAJNOVŠÍ `scan_jobs` pre `(page_id, strategy)`;
  blokni **429**, ak je `status='pending'` (in-flight) ALEBO jeho `requested_at` je v
  posledných **60 s** (cooldown, bez ohľadu na status). Inak povoľ.
- **Spusti:** insert `scan_jobs` (status pending) → dostaneš `job_id`. `ctx.waitUntil`
  spustí `runScan(env, page, strategy, jobId)` na pozadí. Vráť **202** `{ job_id }`.
- **`runScan` (na pozadí):**
  - `fetchPsi(page.url, env.PSI_API_KEY, strategy)` (import z core).
  - Úspech → poskladaj `perf_runs` riadok cez **zdieľaný builder** (viď nižšie),
    insert do `perf_runs`, update `scan_jobs` → `status='done', finished_at=now`.
  - Zlyhanie PSI → update `scan_jobs` → `status='error', error=<dôvod>, finished_at=now`.
    **Nepíš** perf_runs error riadok (manuálny sken nezanáša históriu chybami; UI ukáže
    „sken zlyhal: <dôvod>"). Zero-fabrication: pri chybe žiadne vymyslené dáta.
- **CORS:** rovnaké `CORS` hlavičky ako `/trigger`.

## Core: zdieľaný builder perf_runs riadku
- Aby on-demand sken a denný collector produkovali **identický** `perf_runs` riadok
  (a nedivergovali), extrahuj do `packages/core/src/perfRow.ts` čistú funkciu:
  `perfRunRow(snap: PerfSnap, page: {id,org_id}, strategy): PerfRunRow` — vráti objekt
  presne s poľami, čo dnes `tools/psi-probe/index.mjs` skladá inline (bez `measured_at`,
  ktorý doplní volajúci, nech je konzistentný v rámci behu). Testované vitestom.
- `tools/psi-probe/index.mjs` prepni na tento builder (nahradí inline objekt) — DRY,
  nič sa funkčne nemení (over: rovnaké polia). Worker `runScan` použije ten istý builder.

## UI (SP3 — tu len rozhranie, ktoré SP2 sľubuje)
- Web klik → `POST WORKER_URL/scan` s `Authorization: Bearer <supabase access_token>`
  (rovnako ako `/trigger` volanie v settings/page.tsx) + `{page_id, strategy}`.
- Po 202 UI polluje `scan_jobs?id=eq.<job_id>&select=status,error` cez PostgREST + JWT,
  kým `status='pending'`; potom re-fetch `perf_runs` (nový riadok) a zobrazí.
- Toto sa implementuje v SP3; SP2 garantuje endpoint + `scan_jobs` stav + `perf_runs` zápis.

## Rozsah — čo SP2 NErobí
- Žiadny UI button/spinner/zobrazenie — **SP3**.
- Žiadny dopad na `perf_snapshots`, žiadne alerty z on-demand skenu.
- Žiadne obe stratégie naraz (owner: len zobrazená).

## Testovanie
- Core: `perfRow.test.ts` — builder produkuje správne polia z `PerfSnap` (vrátane fcp,
  opportunities, CrUX, null-safe).
- Worker: `runScan` / `/scan` — auth fail → 401/403; zlá strategy → 400; neznáma page →
  404; in-flight/cooldown → 429; happy path → 202 + (mock) perf_runs insert + scan_job
  done; PSI fail → scan_job error, žiadny perf_runs. Vitest s fake Supabase/fetch (vzor
  `runJobHealth.test.ts` + `fakeSupabase.ts`).
- Migrácia idempotentná (auto cez migrate.yml).

## Nasadenie
- Migrácia 0037 → push (migrate.yml aplikuje sama).
- `PSI_API_KEY` ako Worker secret — **owner pridá raz**, bez posielania cez chat.
  Najjednoduchšie cez **Cloudflare dashboard** → Workers → `agency-dashboard-scheduler`
  → Settings → Variables and Secrets → Add → `PSI_API_KEY` (Secret/encrypt). Hodnotu má
  owner (tá istá ako GitHub secret `PSI_API_KEY`, z Google Cloud console → Credentials).
  Bez tohto secretu `/scan` vráti **503** (rovnaký fail-closed vzor ako `/trigger` bez
  `GH_DISPATCH_TOKEN`).
- Worker deploy cez `v*` tag (deploy.yml) — bundluje nový `/scan`.
- Core builder cez push (psi-probe.yml + Worker deploy ho zoberú z dist).
