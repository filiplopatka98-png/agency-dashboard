# Audit: latencia alertov + tiché výpadky (2026-07-20)

Owner pravidlo: **„keď niečo dôležité klesne, riešiť HNEĎ, nie o týždeň."**
Dva nezávislé read-only audity (detekcia/latencia + tiché zlyhania).

Dve email cesty: **`alerts`** tabuľka → `runAlerts` (posiela do 5 min) vs
**`change_log`** → BEZ e-mailu, len digest + UI. Rozdiel je celý príbeh.

## Trieda 1 — dôležité zhoršenie, neskorá/žiadna reakcia

| # | Signál | Dnes | Cieľ |
|---|--------|------|------|
| 1 | Nový critical CVE | change_log, **žiadny e-mail** (`tools/wp-cve/index.mjs:275`; severity hard-coded 'critical' v `events.ts`) | e-mail do 24 h, **len CVSS ≥ 9** |
| 2 | PSI prepad 90→70 | zbiera denne, deteguje **týždenne** (`history-snapshot`) → ~7 dní | e-mail v ten deň |
| 3 | TLS odrazu neplatný | **nič** — `tls-probe` píše len `error`, expiry pg_cron číta len `valid_to` | alert z `tls_certs.error` |
| 4 | GSC kliky → 0 (deindex) | **nič** — gsc_* je TREND_ONLY | alert **len prepad k nule** (s podlahou) |
| 5 | WP/PHP EOL | **nič** — nikde sa neporovnáva | **len admin** alert |
| 6 | SEO issue pribudne | change_log (nižšia priorita) | — |

## Trieda 2 — tichý výpadok monitoringu

| # | Problém | Dôsledok |
|---|---------|----------|
| A | `job_runs.status=error/partial` **nikdy nealertuje** (`runJobHealth` kľúčuje len na čas) | vypršaný token → nemeria sa, ticho |
| B | wp-cve s mŕtvym tokenom vráti `ok=0,failed=0` → status **„ok"** | CVE sken mŕtvy, zelené |
| C | **Poison-pill**: jeden zlý Resend send (`runAlerts.ts:71`, bez try/catch) zhodí celý drain → ani `site_down` neodíde | výpadok umlčí alarm |
| D | Mesačný report sa **nikdy** neoznačí za mŕtvy (retencia 30 d < prah 62 d) | report umrie ticho |
| E | cve cron denný, `JOB_SCHEDULES.cve` weekly → mŕtvy sa zistí až o 14 dní | |
| C2 | gsc 403 revoked → null zapísaný ako `measured_at: now` (fresh) | web bez GSC prístupu hlási null navždy |

## Rozhodnutia (owner, 2026-07-20)
1. CVE e-mail **len critical (CVSS ≥ 9)**.
2. GSC alert **len prepad k nule** (podlaha na triviálne weby).
3. EOL **len admin** (nie klientský report).
4. Výpadok zberača → **áno e-mail**.
Jednoznačné opravy (C, 2, 3, D, E) bez pýtania.

## Riešenie (unifikačný princíp)
- Nové alert typy: `alerts.type` je voľný text → netreba migráciu. Vlož riadok + `dedupe_key`.
- „Zelené ale nič nemeria": wp-cve/gsc počítajú collection-failure do `failed` → status partial/error → **jeden** `job_failed` alert to chytí (rieši A, B, C2 naraz).
- NIGHT_DEFERRED nechať {site_up, region_outage}; nové urgentné typy neodkladať.

## Čo je solídne (netreba riešiť)
- `job_runs` sa píše na každý beh vrátane skorého zlyhania.
- `site_down` critical, posiela sa vždy aj v noci.
- Dedupe kľúče kolízno-bezpečné, `sent_at` až po úspechu.
- Expiry (doména/TLS `valid_to`) robustné, `ON CONFLICT DO NOTHING`.
- Null-on-error bráni zamrznutým hodnotám tváriť sa čerstvo.
- Worker self-death bez push detekcie = známy, owner-om akceptovaný gap (declined external heartbeat).
