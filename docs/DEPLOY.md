# Go-live runbook — Agency Dashboard (Monitorix)

Lineárny postup nasadenia do produkcie. Rob kroky **v poradí**. Väčšinu spustím ja;
pri každom kroku je označené **[TY]** (potrebuje tvoj účet/akciu) alebo **[JA]**.

> ⚠️ Produkčný deploy až na explicitné „go". Secrety NIKDY do gitu ani chatu.

---

## 0. Účty, ktoré si najprv založ **[TY]**

| Služba | Načo | Tier |
|---|---|---|
| **GitHub** | repo + Actions (collectory bežia ako cron) | Free |
| **Supabase** | Postgres + Auth + RLS (prod DB) | Free |
| **Cloudflare** | Worker (uptime scheduler) + Pages (web) | Free |
| **Resend** | odosielanie alertov / reportov e-mailom | Free (3 000/mes) |

Kľúče, ktoré už máš pripravené: **Google API key** (PSI + Safe Browsing) a **GSC service-account JSON**.

---

## 1. GitHub repo  **[TY zakladá, JA pushnem]**
1. **[TY]** Vytvor **privátny** repo (napr. `agency-dashboard`) a pridaj ma ako collaboratora (alebo mi daj URL a pushnem cez tvoj token).
2. **[JA]** `git push` celého monorepa na `main`.

## 2. Supabase prod  **[TY účet, JA nasadím]**
1. **[TY]** Vytvor projekt (región **Frankfurt/EU**). Odlož si:
   - *Project URL* (`https://<ref>.supabase.co`)
   - *anon key* a *service_role key* (Settings → API)
   - *DB connection string* (Settings → Database)
2. **[JA]** Aplikujem migrácie a seed:
   ```bash
   supabase link --project-ref <ref>
   supabase db push                                    # všetkých 12 migrácií
   psql "$SUPABASE_DB_URL" -f packages/db/supabase/seed-prod.sql   # 4 reálne weby
   ```
3. **[JA]** Overím `pg_cron` (rollup + retencia z migrácií 0003/0009) — na hostenom Supabase je `pg_cron` dostupný; ak nie, zapneme cez *Database → Extensions*.
4. **[TY]** **Auth:** *Authentication → URL Configuration* → *Site URL* = prod doména webu, *Redirect URLs* = `https://<web-doména>/**`. Vytvor si prihlasovací účet (*Authentication → Users → Add user*, e-mail + heslo) — RLS ťa spáruje cez membership.

## 3. GitHub Actions secrets (collectory)  **[TY vložíš]**
*Repo → Settings → Secrets and variables → Actions → New repository secret:*

| Secret | Hodnota | Kto ho používa |
|---|---|---|
| `SUPABASE_URL` | prod Project URL | všetky collectory |
| `SUPABASE_SERVICE_ROLE_KEY` | prod service_role | všetky collectory |
| `PSI_API_KEY` | Google API key | psi-probe |
| `SB_API_KEY` | ten istý Google API key | security-probe |
| `GSC_SA_JSON` | celý obsah GSC service-account JSON | gsc-probe |

Collectory potom bežia samy (denne/týždenne) + dajú sa spustiť ručne cez *Actions → <workflow> → Run workflow*:
`tls-probe`, `aeo-probe`, `seo-crawl`, `psi-probe`, `security-probe`, `gsc-probe`.

## 4. Scheduler — Cloudflare Worker (uptime, cron */5)  **[JA nasadím, TY účet+Resend]**
```bash
cd apps/scheduler
wrangler login                     # [TY] autorizácia Cloudflare účtu (raz)
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put RESEND_API_KEY        # [TY] z Resend
wrangler secret put ALERT_EMAIL_TO        # kam chodia alerty (tvoj e-mail)
wrangler secret put ALERT_EMAIL_FROM       # napr. alerts@tvoja-domena.sk (overená v Resend)
wrangler secret put UPTIME_PROVIDER        # hodnota: local
wrangler deploy
wrangler tail                              # over: CPU < 8 ms/invokáciu, žiadne chyby
```
Cron `*/5 * * * *` je vo `wrangler.jsonc` — po `deploy` sa registruje automaticky.

## 5. Web — Cloudflare Pages  **[JA nasadím]**
```bash
NEXT_PUBLIC_SUPABASE_URL=<prod URL> NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon> pnpm --filter web build
wrangler pages deploy apps/web/out --project-name agency-dashboard
```
V *Pages → Settings → Environment variables* nastav (build aj runtime):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — **nič iné** (service_role sem NIKDY).

## 6. Resend — doména  **[TY]**
1. *Domains → Add domain* → pridaj `tvoja-domena.sk`.
2. Do DNS vlož **SPF + DKIM** záznamy, ktoré Resend ukáže → počkaj na *Verified*.
3. API key (*API Keys → Create*) → to je `RESEND_API_KEY` z kroku 4.

## 7. End-to-end overenie  **[JA]**
- [ ] Web sa načíta na prod doméne, prihlásenie funguje.
- [ ] Prehľad ukazuje 4 weby, uptime sa začne písať do ~5 min.
- [ ] Ručne spustím každý collector (workflow_dispatch) → Weby ukazujú reálne PSI/SEO/AEO/Security/GSC.
- [ ] Doména/TLS expiry sa doplní (round-robin do ~1 dňa, alebo ručný `tls-probe`).
- [ ] Testovací výpadok (dočasne zlý `expected_string`) → príde e-mail alert cez Resend → po obnove „up“.
- [ ] `robots`/indexácia podľa želania (dashboard je privátny — netreba indexovať).

---

## Prehľad secretov (kam čo patrí)

| Secret | GitHub Actions | CF Worker | CF Pages |
|---|:--:|:--:|:--:|
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ✅ (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ❌ nikdy |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ❌ | ❌ | ✅ |
| `PSI_API_KEY`, `SB_API_KEY` | ✅ | ❌ | ❌ |
| `GSC_SA_JSON` | ✅ | ❌ | ❌ |
| `RESEND_API_KEY`, `ALERT_EMAIL_*`, `UPTIME_PROVIDER` | ❌ | ✅ | ❌ |

## Čo ešte nie je hotové (nezávisí od deployu)
- **WordPress agent** (Infra tab) — mu-plugin + HMAC na 3 WP weby (krivosik, profihouse, kukodetskysvet).
- **Vuln/CVE** — WPScan token.
- Detaily kľúčov: [ACCESS-KEYS.md](ACCESS-KEYS.md).
