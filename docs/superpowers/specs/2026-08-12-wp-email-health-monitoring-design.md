# WP e-mail deliverability monitoring — design

**Dátum:** 2026-08-12
**Stav:** schválený návrh (Fáza 2), pripravený na plán (Fáza 3)

## Problém a motivácia

Na klientskom webe **soccercoacheshub.com** tichoutekali odchádzajúce e-maily 6+
mesiacov a nikto si to nevšimol. Audit 12. 8. 2026:

- FluentSMTP: 962 zlyhaní z 1 742 mailov / 14 dní = **55 % failure rate**
- Chyba vždy identická: `SMTP Error: Could not authenticate.` (provider sender.net)
- Medzi zlyhanými: Password Reset, Activate account, platobné notifikácie
- Dopad: používatelia sa nevedeli prihlásiť (reset hesla nikdy neprišiel), maily
  „Vaša platba zlyhala" nedoručené

**Cieľ:** Monitorix má odosielanie e-mailov na **každom** monitorovanom WordPress
webe sledovať a alertovať tak, aby sa akútne zlyhanie zistilo **do pár minút**, nie
za mesiace. Ticho sa má *overovať*, nie predpokladať.

## Kľúčové rozhodnutia (schválené s ownerom)

1. **Detekčná latencia:** akútny prípad (maily aktívne zlyhávajú) **~1–5 min** cez
   event-driven push; slow-burn prípady (zaseknutá fronta / úplné ticho) ~1 h / denne
   (fyzikálny strop pollingu — na „nič sa nedeje" nepríde event).
2. **Detekcia zaseknutej fronty:** evidence-based + ľahký 14-dňový backstop
   (Prístup 2). NIE per-hodina-dňa percentilový baseline (over-engineering pre Free plan).
3. **Kanál:** alert ide do existujúcej `alerts` tabuľky → zobrazí sa v dashboarde
   **a** existujúci `runAlerts` → Resend ho pošle mailom. **Bez Telegramu.** Resend je
   nezávislý od SMTP monitorovaného webu → alert dorazí aj keď je web úplne rozbitý.
4. **Cloudflare Free plan (3 MiB bundle):** žiadne ťažké závislosti vo Workeri; všetka
   agregácia beží v PHP agente cez `$wpdb`. Worker len ingest + vyhodnotenie.
5. **Provider auto-detekcia** z toho, čo agent už vie (plugin inventár + `SHOW TABLES`),
   žiadne hardkódovanie zoznamu webov.

## Architektúra a dátový tok

Dve cesty, obe končia v existujúcej `alerts` → dashboard + Resend:

```
WP web (agent 2.2.0)
 ├─ EVENT: wp_mail_failed (WP jadro) ──debounce ~10 min──► POST /wp-ingest {email_health}
 │                                                          └─ ingest VYHODNOTÍ Pravidlo 1 hneď → alert row
 └─ HEARTBEAT: hodinový wp-cron ────────────────────────► POST /wp-ingest {email_health}
                                                            └─ len uloží reading

Worker 5-min tick (runTick):
 └─ step('email_health') → latest reading per web → VYHODNOTÍ Pravidlá 2 & 3 → alert row
 └─ step('alerts')       → Resend pošle nevyslané (≤ 5 min)   [MUSÍ ostať posledný]
```

Akútna latencia = event push (sekundy) + ingest-time eval (okamžite) + email na
najbližšom 5-min ticku = **~1–5 min**. Worker bez ťažkých závislostí (Free plan).

`wp_mail_failed` je **jadrový** WP hook (nie FluentSMTP-špecifický) → funguje bez
ohľadu na SMTP plugin. Debounce (max 1 event-push za ~10 min, transient guard) zabráni
tomu, aby 962 zlyhaní zaspamovalo ingest; agregáty za okno sa aj tak počítajú z log
tabuľky, nie z jednotlivých eventov.

## Čo agent zbiera (WP strana, agent 2.2.0)

**Provider auto-detekcia (over za behu, nehádaj):**
1. `SHOW TABLES LIKE '%fsmpt%'` → FluentSMTP log tabuľka (očakávané
   `{prefix}fsmpt_email_logs`, stĺpce `status`, `created_at` — **over reálne názvy**).
2. Ak nie je → skús WP Mail Logging tabuľku.
3. Ak ani jeden → `provider: null`, metriky `null` (**nie nula** — rozlíšenie
   „nemeriame" od „0 mailov").

**Metriky** (agregáty počítané z log tabuľky v agente):

| Pole | Typ | Pozn. |
|---|---|---|
| `provider` | string \| null | názov transportu / log zdroja |
| `sent_1h`, `failed_1h` | int \| null | okno 1 h |
| `failed_pct_1h` | number \| null | odvodené |
| `sent_24h`, `failed_24h` | int \| null | okno 24 h |
| `last_successful_send_at` | ISO ts \| null | |
| `last_failure_at` | ISO ts \| null | |
| `last_failure_message` | string \| null | skrátené ~200 zn., **bez adries a obsahu** |
| `queue_depth` | int \| null | best-effort; `null` ak sa nedá zistiť |

**GDPR:** do DB dashboardu idú **len agregáty + skrátená chybová správa**. Žiadne
e-mailové adresy, mená príjemcov ani obsah mailov. Agent chybovú správu pred odoslaním
sanitizuje (odstráni e-mailové adresy regexom).

## DB schéma — nová tabuľka `wp_email_health`

Append-only história (vzor `0036_perf_pages_history.sql` → `perf_runs`), nie
single-row upsert — históriu potrebujeme pre 14-dňový backstop (Pravidlo 3), trend
v UI a týždenný digest.

```sql
create table if not exists wp_email_health (
  id                    uuid primary key default gen_random_uuid(),
  site_id               uuid not null references sites on delete cascade,
  org_id                uuid not null references organizations on delete cascade,
  provider              text,
  sent_1h               int,
  failed_1h             int,
  failed_pct_1h         numeric,
  sent_24h              int,
  failed_24h            int,
  last_success_at       timestamptz,
  last_failure_at       timestamptz,
  last_failure_message  text,
  queue_depth           int,
  source                text not null,          -- 'event' | 'heartbeat'
  measured_at           timestamptz not null default now()
);
create index wp_email_health_site_measured_idx on wp_email_health (site_id, measured_at desc);
```

- **RLS:** enable; `"org members read"` (`org_id in (select private.user_orgs())`) +
  `"staff write"` (0028 vzor s `site_id` kontrolou). Granty: `authenticated` CRUD,
  `service_role all`.
- **Retencia:** pg_cron `wp_email_health_retention`, `delete … where measured_at <
  now() - interval '90 days'`.
- **Latest per web:** `order by measured_at desc limit 1`.

## Vyhodnotenie a alerty — čisté funkcie v `packages/core/src/emailHealth.ts`

Signatúra (čistá, plne unit-testovaná — NFR):

```ts
evaluateEmailHealth(reading: EmailHealthReading, history14d: EmailHealthReading[])
  : { alerts: EmailHealthAlert[] }
```

**Pravidlá:**

1. **Vysoký fail rate** — `failed_pct_1h >= 10 %` pri `sent_1h + failed_1h >= 5`
   (min-objem guard, aby 1 z 2 nespôsobilo alert) → **severity `critical`** (padajú
   resety hesiel a platobné notifikácie). Eval pri **ingeste** (event) → najrýchlejšie.
2. **Zaseknuté s dôkazom** — `last_success_at` starší než **6 h** **A ZÁROVEŇ**
   (`queue_depth > 0` **alebo** `failed_1h > 0`) → **severity `warning`**. Tichý malý web
   v noci (0 pokusov, 0 vo fronte) nemá „dôkaz aktivity" → nespustí. Eval na 5-min ticku.
3. **Úplné ticho (backstop)** — 14-dňový priemer `>= X` úspešných sendov/deň (default
   `X = 3`), ale **0 úspešných za 24 h** → **severity `warning`**. 14-d priemer zaručí,
   že sa týka len webov, čo reálne posielajú → žiadny false-positive pre trvalo tiché
   weby. Eval na ticku.

**Alert routing:** insert do `alerts` s `dedupe_key = email_health:<rule>:<site_id>:<deň>`
(max 1× za web/pravidlo/deň, vzor `css_broken`). Producenti používajú
`upsert(..., { onConflict: 'dedupe_key', ignoreDuplicates: true })`. Alert sa objaví
v obrazovke **Alerty** a `runAlerts` → Resend ho pošle e-mailom.

Prahy (`10 %`, `min 5`, `6 h`, `14 d`, `X=3`) sú konštanty v `emailHealth.ts`
s komentárom — laditeľné na jednom mieste.

## Zod na hranici (NFR)

Nový `email_health` sub-objekt v `/wp-ingest` payloade sa **striktne validuje Zodom**
(nedôveryhodný WP vstup). Pri zlyhaní validácie: reading sa nezapíše, zaloguje sa
`wp_ingest.email_health_invalid` so `site_id`, ingest **nezhodí Worker** a existujúce
wp_snapshot polia ostávajú nedotknuté (`Result`-štýl, collector-safe). Existujúci
zvyšok wp payloadu ostáva mimo scope tejto úlohy (známa medzera, nerieši sa tu).

## Kam v `scheduled()`

Nový `step('email_health', () => runEmailHealth(env))` v `runTick`
(`apps/scheduler/src/index.ts`, blok krokov, **pred** finálnym `alerts`). Collector
`apps/scheduler/src/runEmailHealth.ts` číta latest reading per web (weby s `provider`)
a vyhodnocuje Pravidlá 2 & 3. **Žiadny nový cron trigger** — Free plan, jediný trigger
`*/5 * * * *` ostáva. Pravidlo 1 beží pri **ingeste** (`wpIngest.ts`), nie na ticku.

## UI — panel „Doručovanie e-mailov" v tabe **Infra**

Taby dnes: Infra (hosting/server/PHP/MySQL/backup) / Performance / SEO / AEO. E-mail
sending je **WP-operačné zdravie** — rovnaká rodina ako PHP/MySQL/záloha, ktoré Infra
už ukazuje → patrí do **Infra**, nie do samostatného tabu (neroztrieštiť).

Panel zobrazuje: provider · 1h a 24h odoslané/zlyhané (farebne) · posledný úspešný
send a posledné zlyhanie (čas `Europe/Bratislava`, formát `D. M. RRRR`) ·
`last_failure_message` (skrátené) · sparkline trendu `failed_pct` · status badge.
Ak `provider = null`: „Monitoring e-mailov: agent na tomto webe nenašiel FluentSMTP
ani WP Mail Logging."

Dáta sa čítajú klientsky cez Supabase (RLS), rovnako ako ostatné Infra panely.

## Týždenný digest

Napojenie na existujúci `tools/weekly-digest` (žiadna paralelná infra): pole do
`DigestSite` (`packages/core/src/digest.ts`), naplniť v mapovacom loope
`weekly-digest/index.mjs` (nová tabuľka do `Promise.all`), vyrenderovať riadok
„E-maily: odoslaných X / zlyhaných Y za týždeň" v HTML aj text vetve. Renderer ostáva
čistá funkcia s testom.

## Nefunkčné požiadavky (compliance)

- TypeScript `strict`, žiadne `any`, žiadne `@ts-ignore`
- Zod na hranici agenta (`email_health` payload)
- Collector nezhodí job runner — `Result`/try-catch, chyba → log + pokračuj
- Bundle: žiadne nové worker závislosti (čistý TS/PHP)
- Cron cap 5: žiadny nový trigger — vetva vnútri `runTick`
- Idempotencia: `dedupe_key` unique + `on conflict do nothing`
- RLS na `wp_email_health`, multi-tenant `org_id`/`site_id`
- Migrácia = nový súbor (`0039_wp_email_health.sql`), needituj existujúce
- Štruktúrované JSON logy so `site_id`
- DB v UTC, UI v `Europe/Bratislava`, dátumy `D. M. RRRR`
- UI po slovensky, kód a commity po anglicky
- **Žiadne e-mailové adresy ani obsah mailov v DB** — len agregáty + skrátená chyba
- Scoring/eval ako čisté funkcie s unit testami (`emailHealth.test.ts`)

## Deploy realita a otvorené body (do Fázy 3)

- Agent sa bumpne na **2.2.0** a musí sa **znova nahrať na každý monitorovaný WP web**
  (manuálne/owner — `wp_mail_failed` hook funguje len keď je plugin aktívny).
- ⚠️ **`soccercoacheshub.com` NIE JE `sites` riadok v dashboarde** (nie je v repe). Ak sa
  má monitorovať, treba ho najprv pridať ako web + nainštalovať agenta. Rieši sa pri deployi.
- `queue_depth`: over reálnu zistiteľnosť z FluentSMTP; ak nie, ostáva `null` a Pravidlo 2
  sa oprie o `failed_1h > 0`.
- Over reálny názov FluentSMTP log tabuľky a stĺpcov na živom webe (agent to robí za behu).
- `wrangler dev` klame — každú runtime závislosť over na **nasadenom** Workeri.

## Testovanie

- `emailHealth.test.ts` — čistá eval funkcia: všetky tri pravidlá, hraničné hodnoty
  (min-objem 5, 10 %, 6 h, 14 d, X=3), `null` provider (žiadny alert), nočný tichý web
  (žiadny false-positive), evidence gate (queue_depth vs failed_1h).
- `wpIngest` — Zod validácia `email_health` (valid/invalid → collector-safe), ingest-time
  Pravidlo 1.
- `runEmailHealth` — Pravidlá 2 & 3 proti fake Supabase (vzor existujúcich `run*.test.ts`).
- Manuálne (na nasadenom Workeri): reálny push z agenta → reading v DB → alert row →
  Resend e-mail; UI panel; digest riadok.

## Rozsah implementácie (Fáza 3, po commitoch)

1. Migrácia `0039_wp_email_health.sql` (tabuľka + RLS + retencia)
2. `packages/core/src/emailHealth.ts` + testy (čistá eval + Zod schéma + typy)
3. `apps/scheduler/src/wpIngest.ts` — Zod `email_health`, uloženie reading, ingest-time Pravidlo 1
4. `apps/scheduler/src/runEmailHealth.ts` + zapojenie do `runTick` (Pravidlá 2 & 3)
5. Agent 2.2.0 — provider detekcia, agregácie, `wp_mail_failed` hook + debounce, heartbeat push
6. UI panel „Doručovanie e-mailov" v Infra tabe
7. Týždenný digest — pole + render
8. DB typy (`packages/db/src/types.generated.ts`)
