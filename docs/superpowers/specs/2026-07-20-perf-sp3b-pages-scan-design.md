# Performance overhaul — SP3b: pages tabuľka + on-demand sken (design)

**Dátum:** 2026-07-20
**Kontext:** Posledný sub-projekt. Do Performance tabu (SP3a) pridá **tabuľku stránok**
(homepage + ručne pridané), výber stránky (prepne graf/krúžky/issues na ňu), pridanie/
odstránenie stránky a **button „skenuj teraz"** (volá `/scan` z SP2). Tým sa Performance
dashboard zo screenshotu skompletizuje. Stavia na SP1 (`monitored_pages`, `perf_runs`),
SP2 (`/scan`, `scan_jobs`), SP3a (`TabPerformance`, `usePerfData(pageId,…)`).

## Rozhodnutia vlastníka (best practices — „decide for me")
- **Výber stránky** prepína celý dashboard (krúžky/grafy/issues) na tú stránku; default homepage.
- **Pridať** stránku: len **rovnaká doména** ako web, pod capom **10**, normalizácia na `https://`.
- **Odstrániť**: len ne-homepage, s **potvrdením** (zmaže aj históriu stránky — FK cascade).
- **Skenuj**: skenuje **aktuálnu stratégiu** (SP2 kontrakt), UI polluje `scan_jobs`.

## Grounding
- `TabPerformance` (SP3a): stav `strategy/source/range`, `useHomepageId(siteId)` → `pageId`
  → `usePerfData(pageId, strategy, sinceIso)`. `usePerfData` už berie ľubovoľné `pageId`.
- Worker volanie (vzor `settings/page.tsx:100-109`): `supabase.auth.getSession()` →
  `data.session?.access_token` → `fetch(WORKER_URL/…, { Authorization: 'Bearer '+token })`.
  `WORKER_URL` je dnes v `settings/page.tsx:68` — **presunúť do zdieľaného** `lib/worker.ts`
  (best practice — používa ho aj SP3b; settings ho odtiaľ importuje).
- `monitored_pages` RLS: staff-write → browser client s JWT vie insert/delete. `scan_jobs`
  org-members-read → UI polluje stav. FK `on delete cascade` (page → perf_runs + scan_jobs).
- Cap 10 = `MAX_PAGES_PER_SITE` v collectore; UI má vlastnú konštantu `MAX_PAGES = 10`
  (iný balík, nedá sa importovať) s komentárom, že musí zodpovedať collectoru.

## Štruktúra súborov
- `sites/perf/pageUrl.ts` — **čisté** helpery (testované): `normalizePageUrl(input, siteDomain)`
  → `{ ok: true; url } | { ok: false; reason }` (normalizuje na `https://<domain>/<path>`,
  odmietne inú doménu / neplatné URL); `isHomepageUrl`. Bez DOM/Reactu.
- `sites/perf/usePages.ts` — hook `usePages(siteId, strategy)` → `{ pages, loading, error,
  refresh() }`. `pages` = `monitored_pages` (aktívne) + latest `perf_runs` per stránka pre
  `strategy` (skóre + `measured_at`). Latest: query `perf_runs?page_id=in.(…)&strategy=eq&
  order=measured_at.desc` a per-page prvý.
- `sites/perf/PagesTable.tsx` — tabuľka + add form + akcie (skenuj/odstrániť), volá supabase
  insert/delete a Worker `/scan`. Prijíma `selectedPageId` + `onSelect` + `onChanged`.
- `sites/TabPerformance.tsx` (uprav): `selectedPageId` stav (default = homepage z
  `useHomepageId`); `usePerfData(selectedPageId, …)`; pod grafmi `<PagesTable … />`.
- `lib/worker.ts` — `export const WORKER_URL = '…'` (presun zo settings; settings importuje).

## Interakcie
### Výber stránky
Klik na riadok → `onSelect(pageId)` → `TabPerformance.setSelectedPageId` → dashboard sa
prepne (krúžky/grafy/issues cez `usePerfData`). Vybraný riadok zvýraznený. Homepage default.

### Pridať stránku
Input (URL) + tlačidlo. `normalizePageUrl(input, site.domain)`:
- neplatné / iná doména → inline chyba (napr. „Zadaj URL na doméne <domain>").
- OK → `supabase.from('monitored_pages').insert({ site_id: site.id, org_id: site.orgId, url,
  is_homepage: false })` → `refresh()`. Duplicitná URL (unique site_id+url) → hláška „už je
  pridaná". Pri `pages.length >= MAX_PAGES` → input+tlačidlo disabled + „Max 10 stránok."

### Odstrániť stránku
Tlačidlo len na `!is_homepage` riadkoch → `confirm()` s upozornením, že sa zmaže aj história
tejto stránky → `supabase.from('monitored_pages').delete().eq('id', pageId)` → `refresh()`.
Ak bola vybraná → prepni výber späť na homepage. Homepage riadok tlačidlo odstránenia nemá.

### Skenuj teraz
Tlačidlo na riadku → stav „skenuje sa…" (disabled). `getSession()` → token. Bez tokenu →
„Prihlásenie vypršalo". `POST WORKER_URL/scan { page_id, strategy }` s Bearer:
- **202** → polluj `supabase.from('scan_jobs').select('status,error').eq('id', job_id)` každé
  ~2,5 s, max ~3 min. `status==='done'` → `refresh()` (nový perf_runs + last_scan). `status===
  'error'` → inline „sken zlyhal: <error>".
- **429** → „Sken práve beží alebo dobehol pred chvíľou."
- **503** → „On-demand sken nie je nakonfigurovaný (chýba PSI kľúč na Workeri)."
- iná/sieť → „Nepodarilo sa spustiť sken."
Zero-fabrication: UI nič nedomýšľa — zobrazuje len reálny stav zo `scan_jobs` / HTTP kódu.

### Stavy
`usePages` loading → skeleton riadok; error → hláška; prázdne (len homepage bez behov) →
homepage riadok bez skóre + „—". Akcie majú disabled/spinner stavy.

## A11y
Tabuľka `<table>` so `<th scope="col">`; akčné tlačidlá majú `aria-label` (napr. „Skenovať
<url>"). Výber riadku klávesnicovo dosiahnuteľný (button/role). Potvrdenie mazania natívne.

## Rozsah — čo SP3b NErobí
- Žiadny nový backend (endpoint `/scan` + `scan_jobs` sú z SP2; číta/píše cez existujúce RLS).
- Žiadna migrácia, Worker zmena ani secret (PSI_API_KEY secret je z SP2).
- Custom time-range (od–do) ostáva mimo (ako v SP3a, YAGNI).

## Testovanie
- `pageUrl.test.ts` (vitest): `normalizePageUrl` — same-domain OK, iná doména odmietnutá,
  bez schémy → doplní https, path zachovaný, trailing slash, neplatné URL, `isHomepageUrl`.
- Komponenty/hooky (usePages/PagesTable) client-side → vizuálne overenie na dev serveri
  (add/select/scan/delete flow) + po deployi.
- `pnpm -r test` + `pnpm --filter web typecheck` + `lint` zelené; web build OK v CI.

## Nasadenie
- Len frontend → `git push` + `v*` tag (deploy.yml). Žiadna migrácia/secret.
- Vizuálne overenie (add stránku, vyber, skenuj, odstráň) — owner na živom webe (login),
  alebo dev server. Reálny happy-path `/scan` (202 → perf_runs) sa tu prvýkrát overí end-to-end.
