# agency-dashboard

Uptime monitoring, incidenty, e-mailové alerty, expirácia domén a TLS certifikátov pre webové projekty agentúry. **Fáza 1** (zadarmo): Cloudflare Workers + Pages, Supabase, Resend.

> Stav: **rozpracované** — krok 1/10 (scaffold) hotový. Detailný plán a acceptance criteria: `Fáza 1 build guide`.

## Štruktúra

```
apps/web        Next.js 16, output:'export' → Cloudflare Pages (statické UI, anon key + RLS)
apps/scheduler  Cloudflare Worker, cron */5 (uptime, doména, TLS, alerty)
packages/core   čistý TS: ping, incidenty, rdap/whois, notify (žiadny cloudflare:*/next/*/node:*)
packages/db     supabase/migrations + generované typy
packages/shared zod schémy
tools/tls-probe Node skript pre GitHub Action (týždenný TLS probe)
```

## Požiadavky

- **Node 22** (`.nvmrc` → `nvm use`). Wrangler 4 vyžaduje ≥22.
- pnpm 10.

## Lokálny beh

```bash
nvm use                 # Node 22
pnpm install
pnpm test               # vitest naprieč workspace
pnpm build              # web → apps/web/out/, scheduler dry-run
pnpm -r typecheck
```

## Odchýlky od pôvodného zadania (fáza 1)

- **Next 16** (nie 15) — `create-next-app` dáva aktuálnu stabilnú; pre `output:'export'` identické.
- **Node 22** baseline (wrangler 4 to vyžaduje).
- Doména/TLS beží **round-robin** cez cron ticky (nie jeden denný blast) — kvôli subrequest/CPU limitu Free.
- TLS len cez **týždenný probe** (GitHub Action); crt.sh je odložený (nie je spoľahlivý zdroj nasadeného certu).
- `UptimeRobotProvider` odložený — zatiaľ len `UptimeProvider` interface + `LocalPinger`.
- Detail routy sú **query-param** (`/sites?id=`) kvôli statickému exportu.

## Deploy

Doplní sa v ďalších krokoch (Supabase migrácie, Cloudflare Worker secrets, Pages deploy, GitHub Action).
