# agency-dashboard

Uptime monitoring, incidenty, e-mailové alerty a expirácia domén/TLS certifikátov pre weby agentúry. **Fáza 1** je zadarmo: Cloudflare Workers + Pages, Supabase Free, Resend Free.

**Hodnota:** o výpadku sa dozvieš skôr než klient.

## Architektúra

```
apps/web        Next.js 16, output:'export' → Cloudflare Pages. Statické UI,
                anon key + RLS. Magic-link auth. Žiadny SSR/Server Actions/API routes.
apps/scheduler  Cloudflare Worker, cron */5. Uptime + incidenty + doména (round-robin)
                + odosielanie alertov. Používa service_role (RLS bypass).
packages/core   Čistý TS bez runtime: LocalPinger, decideIncidents, RDAP/whois parser,
                ResendNotifier, nočné dávkovanie. Neimportuje cloudflare:*/next/*/node:*.
packages/db     supabase/migrations + generované typy.
packages/shared zod schémy.
tools/tls-probe Node skript pre GitHub Action (týždenný TLS probe — Worker peer cert nevie).
```

**Toky dát:**
- Worker (každých 5 min): pingne weby → `decideIncidents` → zapíše `uptime_checks`
  + otvorí/zatvorí `incidents` + vloží `site_down`/`site_up` alerty (dedupe cez DB) →
  round-robin obnoví `domains` → odošle nevyslané alerty cez Resend.
- pg_cron: denne rollup `uptime_checks` → `uptime_daily` (+ retencia 30 dní),
  denne expiry alerty (doména 30/14/7 d, TLS 21/7 d).
- GitHub Action: týždenne TLS probe → `tls_certs` (zdroj pravdy pre `valid_to`).
- UI: číta cez anon key + RLS. Prehľad číta `uptime_daily` (nie raw checky).

## Požiadavky

- **Node 22** (`.nvmrc` → `nvm use`). Wrangler 4 vyžaduje ≥ 22.
- **pnpm 10**.
- **Docker** (pre lokálny Supabase).

## Lokálny beh

```bash
nvm use                              # Node 22
pnpm install
pnpm --filter @agency/db exec supabase start   # lokálny Supabase (prvý raz sťahuje images)
pnpm --filter @agency/db exec supabase db reset # migrácie + seed (3 demo weby)
pnpm test                            # vitest (unit) naprieč workspace
pnpm --filter @agency/db exec supabase test db  # pgTAP (RLS, rollup, expiry)
pnpm build                           # web → apps/web/out/, scheduler dry-run
```

**UI lokálne:**
```bash
cp apps/web/.env.example apps/web/.env.local   # doplň URL + anon key zo `supabase start`
pnpm --filter web dev                          # http://localhost:3000
```

**Integračné testy schedulera** (potrebujú bežiaci lokálny Supabase):
```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<service_role zo `supabase start`> \
pnpm --filter @agency/scheduler test:integration
```

## Testy

- **Unit** (`pnpm test`): `decideIncidents` 100 % coverage, LocalPinger, RDAP/whois
  parser, ResendNotifier, nočné dávkovanie.
- **pgTAP** (`supabase test db`): RLS org-izolácia, rollup + retencia, expiry alerty.
- **Integračné** (scheduler proti lokálnemu Supabase): uptime→incident (2 behy),
  dedupe alertov, doména round-robin, region_outage.

## Deploy

⚠️ Produkčný deploy meň len na explicitné „go".

**1. Supabase** (prod projekt):
```bash
pnpm --filter @agency/db exec supabase link --project-ref <ref>
pnpm --filter @agency/db exec supabase db push        # aplikuj migrácie
```

**2. Scheduler** (Cloudflare Worker):
```bash
cd apps/scheduler
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put RESEND_API_KEY
wrangler secret put ALERT_EMAIL_TO
wrangler secret put ALERT_EMAIL_FROM
wrangler secret put UPTIME_PROVIDER      # 'local'
wrangler deploy
wrangler tail                            # over CPU < 8 ms na invokáciu
```

**3. Web** (Cloudflare Pages):
```bash
pnpm --filter web build
wrangler pages deploy apps/web/out
# Env v Pages: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (NIČ iné).
```

**4. GitHub Action** (TLS probe): pridaj repo secrets `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`. Beží automaticky (pondelok 03:00 UTC) + `workflow_dispatch`.

## Ako pridať web

Cez seed (`packages/db/supabase/seed.sql`) alebo priamo do `sites` (owner/staff cez
UI vie insertnúť, alebo SQL):
```sql
insert into sites (org_id, client_id, name, url, domain, expected_string)
values ('<org>', '<client|null>', 'Názov', 'https://web.sk', 'web.sk', 'reťazec v HTML');
```
`domain` bez schémy a `www`. `expected_string` = text, ktorý musí byť v HTML (inak = down).
Uptime sa začne písať do 5 min; doména/TLS do ~1 dňa (round-robin / týždenný probe).

## Veľkosť bundlu (reálne)

- **Scheduler worker:** 764 KB raw / **147 KB gzip** (hlboko pod Free limitom 1 MB gzip).
  Váhu tvorí najmä `@supabase/supabase-js`.
- **Web `out/`:** 1.4 MB total, **~250 KB gzip** JS (17 chunkov). Statické, žiadny SSR.

## Odchýlky od pôvodného zadania (fáza 1)

- **Next 16** (nie 15), **Node 22** baseline (wrangler 4).
- Doména/TLS beží **round-robin** cez cron ticky (nie denný blast) — subrequest/CPU limit.
- TLS len cez **týždenný probe** (GitHub Action); crt.sh odložený (nie je spoľahlivý
  zdroj nasadeného certu).
- `UptimeRobotProvider` odložený — `UptimeProvider` interface + `LocalPinger`.
- Detail routy sú **query-param** (`/sites?id=`) kvôli statickému exportu.
- Plain Tailwind (bez shadcn CLI).
- region_outage má **min-N prah** (≥ 8 webov) — pod tým sa reálne výpadky nepotláčajú.

## Zostáva (deploy-gated / owner)

- **cloudflare:sockets na Workers Free** (whois:43 pre `.sk`) — over na NASADENOM
  workeri (`wrangler dev` klame). Fallback: whois cez Node GitHub Action (parser
  zdieľaný z `core`).
- **Reálny Resend send** — over s API kľúčom (dedupe/insert-before-send/noc sú
  otestované lokálne s mock notifierom).
- **Reálne weby** — doplniť do seedu / cez UI.
- Go-live: SMTP/Resend doména, cron registrácia, Lighthouse, HSTS.
