# Kľúče a prístupy — čo treba a ako získať

Zoradené podľa priority. Pri každom je uvedená **citlivosť** a **kam to dať**.

> ⚠️ **Bezpečnosť:** vysoko citlivé (service_role, HMAC, OAuth secret) **NEPOSIELAJ do chatu** —
> ulož ich sám do GitHub *repo secrets* / Supabase *Vault* / lokálneho `.env` (gitignored) a ja
> len napíšem kód, ktorý ich načíta cez premennú. Málo citlivé (PSI, Safe Browsing API key —
> read-only, kvótované) môžeš poslať pre rýchly lokálny test, ale aj tie nakoniec patria do secrets.

---

## A) Feature kľúče (spúšťajú jednotlivé taby naživo)

### 1. Google PageSpeed Insights — **Performance / Výkon tab** ⭐ (najjednoduchšie)
- **Načo:** reálne Lighthouse skóre + Core Web Vitals (LCP/INP/CLS) pre každý web.
- **Ako získať (2 min):**
  1. https://console.cloud.google.com/ → vytvor (alebo vyber) projekt.
  2. *APIs & Services → Library* → vyhľadaj **„PageSpeed Insights API"** → **Enable**.
  3. *APIs & Services → Credentials* → **Create credentials → API key**. Skopíruj kľúč.
  4. (Voliteľné) *Restrict key* → API restrictions → len PageSpeed Insights API.
- **Citlivosť:** nízka (read-only, kvóta 25 000/deň).
- **Kam:** `PSI_API_KEY` — GitHub secret (pre collector) alebo lokálny `.env`.

### 2. Google Search Console — **SEO tab (výkonnostná časť: kliknutia/impresie/pozície)**
- **Načo:** reálne dáta z GSC (technický SEO crawl už beží bez tohto).
- **Ako získať (odporúčam service account — netreba interaktívny OAuth):**
  1. Rovnaký Google Cloud projekt → *Library* → povoľ **„Google Search Console API"**.
  2. *Credentials → Create credentials → Service account* → vytvor. Otvor ho → *Keys →
     Add key → JSON* → stiahne sa `*.json` (obsahuje `client_email` a `private_key`).
  3. V **Search Console** (search.google.com/search-console) pre **každú** property
     (web) → *Nastavenia → Používatelia a povolenia → Pridať používateľa* → vlož
     `client_email` zo service accountu, rola *Full/Restricted*.
  4. Over, že property existuje ako `sc-domain:lopatka.sk` (Domain property) — ak nie,
     pridaj ju.
- **Citlivosť:** vysoká (JSON key = prístup). **Nedávaj do chatu** → daj do GitHub secret
  `GSC_SA_JSON` (celý obsah súboru) / Supabase Vault.
- **Pozn.:** alternatíva je OAuth (client_id + secret + refresh token), ale service account
  je pre server-side jednoduchší.

### 3. WordPress agent — **Infra tab (WP verzie, pluginy, updaty, zálohy, CVE)**
- **Načo:** čítať stav WordPressu zvnútra (read-only mu-plugin).
- **Čo treba od teba:**
  1. **WP admin prístup** na weby, kde chceš Infra (kukodetskysvet.sk, krivosik.sk,
     profihouse.sk — ktoré sú WP). lopatka.sk je statický, ten Infra nepotrebuje.
  2. Súhlas nasadiť **mu-plugin** (`wp-content/mu-plugins/agency-agent.php` — dodám ti
     hotový súbor, ty ho nahráš, alebo mi dáš prístup).
  3. Pre každý web **HMAC secret** (náhodný reťazec) — vygenerujem/vygeneruješ, uloží sa do
     Supabase Vault a do plugin konfigurácie. **Nedávaj do chatu.**
- **Citlivosť:** vysoká. Žiadne heslá sa neukladajú — len HMAC secret + `wp_agent_url`.

### 4. Google Safe Browsing — **Security panel (časť Infra tabu)**
- **Načo:** kontrola, či weby nie sú na blacklistoch (malware/phishing).
- **Ako získať:** rovnaký Cloud projekt → *Library* → povoľ **„Safe Browsing API"** →
  použi ten istý typ **API key** ako PSI (môže byť aj ten istý kľúč s viac API).
- **Citlivosť:** nízka. **Kam:** `SAFE_BROWSING_API_KEY`.
- **Vuln/CVE matica** (plugin verzia × známa CVE) navyše potrebuje **WPScan API token**
  (wpscan.com — free 25 req/deň) alebo Patchstack. To je samostatné, môžeme neskôr.

---

## B) Deploy / infra kľúče (aby to bežalo v produkcii, nielen lokálne)

Toto nie je pre nové taby, ale bez nich beží dashboard len lokálne u mňa.

### 5. Supabase (prod projekt)
- **Ako:** supabase.com → New project (Free). Z *Project Settings → API* skopíruj:
  `Project URL`, `anon public` key, `service_role` key.
- **Citlivosť:** `service_role` = **vysoká** (obchádza RLS) → len do secrets/Vault, nikdy do
  `apps/web` ani do chatu. `anon` je verejný (ide do UI).
- **Kam:** UI = `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Cloudflare Pages
  env). Collectory/worker = `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (GitHub/CF secrets).

### 6. Resend — e-mailové alerty
- **Ako:** resend.com → API Keys → Create. Plus over doménu **lopatka.sk** (DNS TXT/DKIM,
  návod dá Resend v *Domains*).
- **Citlivosť:** stredná. **Kam:** `RESEND_API_KEY` (Cloudflare Worker secret) +
  `ALERT_EMAIL_FROM` (napr. `alerty@lopatka.sk`) + `ALERT_EMAIL_TO`.

### 7. Cloudflare účet
- **Načo:** nasadenie Workera (scheduler) + Pages (UI). Fáza 2+ chce **Workers Paid (5 €/mes)**.
- **Čo treba:** prihlásenie / API token s právami Workers + Pages, a potvrdenie, že účet
  **nemá už 5 cron triggerov** (limit je na účet).
- **Kam:** `wrangler login` (interaktívne) alebo `CLOUDFLARE_API_TOKEN`.

### 8. GitHub repo secrets (pre týždenné collectory)
Aby `tls-probe`, `aeo-probe`, `seo-crawl` bežali automaticky, pridaj v GitHub repo
*Settings → Secrets and variables → Actions*:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (prod).

---

## Čo poslať ako prvé (odporúčané poradie)
1. **PSI API key** → rozbehnem Performance tab (najrýchlejšie, nízke riziko).
2. **Safe Browsing key** (ten istý Cloud projekt) → časť Security.
3. **GSC service account JSON** (cez secret, nie chat) → GSC dáta v SEO.
4. **WP admin + súhlas na mu-plugin** → Infra.
5. **Supabase prod + Resend + Cloudflare** → ostrý deploy (uptime/alerty bežia priebežne).
