// Plánovanie WPScan lookupov pod denným rozpočtom (free tier = 25/deň) +
// zostavenie a vyhodnotenie cieľov jedného webu.
//
// Čistá logika bez I/O — collector (`tools/wp-cve/index.mjs`) dodá stav (riadky
// wp_snapshots + obsah cache) a dostane rozhodnutia. Repo pattern: rozhodovanie
// v core (testovateľné), I/O v toole. Zámerne je tu aj `buildTargets` a
// `projectVulns`: presne v nich žije zero-fabrication invariant, takže NESMÚ
// bývať v netestovanom .mjs.
//
// Kontext: 6 webov = ~188 unikátnych cieľov, rozpočet 25/deň (workflow beží
// DENNE — `.github/workflows/wp-cve.yml`; pri týždennom behu by rozpočet bol
// 25/týždeň a nič z tejto aritmetiky by neplatilo). Cache (tabuľka
// `wpscan_cache`, migrácia 0034) je perzistentná, takže rozpočet platíme len za
// to, čo ešte nemáme → pokrytie sa doplní za ~8 dní, potom už len TTL refresh
// (~188/30 ≈ 6/deň v priemere).

// DVE IDENTITY jedného cieľa — nezlučovať, je to zdroj opakovaného bugu:
//   `cacheSlug`  = identita WPScan LOOKUPU. Pre plugin je to slug, pre jadro
//                  VERZIA ('6.5.2'), lebo WPScan má endpoint /wordpresses/652.
//   `recordSlug` = STABILNÁ identita uloženého vuln záznamu. Pre plugin je to
//                  ten istý slug, pre jadro ale konštanta 'wordpress'.
// Prečo to musí byť oddelené: `diffVulns` (events.ts) kľúčuje zraniteľnosť na
// `${cve}|${slug}` uloženého záznamu. Keby sme do záznamu zapísali verziu, tak
// KAŽDÝ update jadra (6.5.2 → 6.5.3) prekľúčuje všetky core CVE → diff by tie
// isté, stále neopravené zraniteľnosti videl ako zmiznuté a ohlásil klientovi
// „zraniteľnosť vyriešená" (+ hneď „nová"). Fabrikovaná dobrá správa.
export interface Target {
  kind: 'plugin' | 'core';
  cacheSlug: string;
  recordSlug: string;
  label: string;
  version: string | null;
}

export interface SitePlan {
  siteId: string;
  targets: Target[];
}

export interface CacheMeta {
  kind: string;
  slug: string; // stĺpec wpscan_cache.slug = cacheSlug
  fetchedAt: string; // ISO timestamp z wpscan_cache.fetched_at
}

export interface PlanOpts {
  budget: number;
  now: Date;
  ttlDays: number;
}

// Kľúč cieľa v cache — vždy `cacheSlug` (identita lookupu), NIKDY `recordSlug`.
export function targetKey(t: { kind: string; cacheSlug: string }): string {
  return `${t.kind}:${t.cacheSlug}`;
}

// Ten istý kľúč pre riadok načítaný z tabuľky (stĺpec sa volá `slug`).
export function cacheRowKey(row: { kind: string; slug: string }): string {
  return `${row.kind}:${row.slug}`;
}

// ── Zostavenie cieľov ───────────────────────────────────────────────────────

export interface BuildOk {
  ok: true;
  targets: Target[];
}
export interface BuildBad {
  ok: false;
  reason: 'bad_plugin' | 'bad_core';
  offending: string | null; // meno chybnej položky, ak ho vieme (inak null)
}
export type BuildResult = BuildOk | BuildBad;

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
// Verzia jadra musí byť tvaru 1 / 1.2 / 1.2.3 — z toho sa skladá WPScan cesta
// /wordpresses/{verzia bez bodiek}. Čokoľvek iné je pokazený zber.
const isVersionShaped = (v: unknown): v is string => typeof v === 'string' && /^\d+(\.\d+)*$/.test(v);

// Zostaví ciele webu z wp_snapshots riadku. Vstup je nedôveryhodný: `plugins` je
// v DB neoverený jsonb (wpIngest.ts ukladá `body.plugins ?? []` tak, ako prišlo
// od WP agenta), takže položka bez `slug` je reálne dosiahnuteľná.
//
// Fail-closed: pri nescanovateľnej položke NEVRACIA čiastočný zoznam, ale chybu →
// collector preskočí CELÝ web (bez zápisu, bez diffu). Dôvod je ten istý
// zero-fabrication invariant: keby sme chybný plugin len preskočili, zoznam vulns
// by bol neúplný a diff by chýbajúce zraniteľnosti ohlásil ako „vyriešené".
// Zároveň sa taký cieľ NIKDY nesmie dostať do plánu ani do cache — `plugin:undefined`
// by šiel na /plugins/undefined → 404 → upsert bez `slug` → porušenie `not null`
// → 400 → kľúč sa nikdy nenacachuje → web navždy nekompletný a 1 lookup denne
// vyhodený z rozpočtu, potichu a naveky.
export function buildTargets(wp: { wp_version?: unknown; plugins?: unknown }): BuildResult {
  const targets: Target[] = [];
  const ver = wp.wp_version;
  if (isNonEmptyString(ver)) {
    if (!isVersionShaped(ver)) return { ok: false, reason: 'bad_core', offending: ver };
    targets.push({ kind: 'core', cacheSlug: ver, recordSlug: 'wordpress', label: 'WordPress', version: ver });
  }
  const plugins = Array.isArray(wp.plugins) ? wp.plugins : [];
  for (const p of plugins) {
    const rec = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    if (!isNonEmptyString(rec.slug)) {
      return { ok: false, reason: 'bad_plugin', offending: isNonEmptyString(rec.name) ? rec.name : null };
    }
    if (rec.slug === 'monitorix-agent') continue; // náš vlastný agent, WPScan ho nepozná
    targets.push({
      kind: 'plugin',
      cacheSlug: rec.slug,
      recordSlug: rec.slug,
      label: isNonEmptyString(rec.name) ? rec.name : rec.slug,
      version: typeof rec.version === 'string' ? rec.version : null,
    });
  }
  return { ok: true, targets };
}

// ── Porovnanie verzií ───────────────────────────────────────────────────────

// „1.2.10" > „1.2.9" — číselné porovnanie po segmentoch.
function cmpVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Zraniteľná, ak nie je opravená (fixed_in null) alebo je inštalovaná verzia
// nižšia než fixed_in. TOTO je dôvod, prečo je cache kľúčovaná slugom a nie
// verziou: WPScan vracia všetky známe vulns cieľa aj s `fixed_in`, porovnanie
// s nainštalovanou verziou prebieha až tu, lokálne → cachovaná odpoveď ostáva
// platná aj po update pluginu.
export function isAffected(installed: unknown, fixedIn: unknown): boolean {
  if (!isNonEmptyString(fixedIn)) return true;
  if (!isNonEmptyString(installed)) return false;
  return cmpVersions(installed, fixedIn) < 0;
}

// ── Plánovanie ──────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

// Vráti ciele na dnešný fetch, orezané na `budget`.
//
// Poradie:
//   1. CHÝBAJÚCE ciele (vôbec nie sú v cache) — v poradí „site-completion-greedy":
//      weby zoradené VZOSTUPNE podľa počtu chýbajúcich cieľov, potom sa prechádzajú
//      v tomto poradí a emitujú sa ich chýbajúce ciele.
//      Dôvod: stiahnutý slug je progres v ľubovoľnom poradí, ALE toto poradie
//      rozsvieti celé weby najskôr — 12-pluginové weby sú kompletné na 1.–2. deň
//      namiesto toho, aby všetci čakali 8 dní za 113-pluginovým webom (web sa
//      vyhodnotí až keď má VŠETKY ciele v cache, viď siteComplete). Veľké weby to
//      nevyhladuje: prídu na rad hneď ako sú malé nacachované.
//   2. Potom STALE ciele (v cache, ale `fetchedAt <= now - ttlDays`) — najstaršie prvé.
//      Chýbajúce vždy prebijú stale, aj keby bolo stale prastaré: stale je REÁLNE
//      dáta (nanajvýš bez čerstvého CVE), chýbajúce blokuje celý web.
//   3. Dedup naprieč webmi — cieľ sa emituje najviac raz (napr. `wordfence` je na
//      6 weboch = 1 lookup) a duplicita NEMÍŇA rozpočet.
export function planLookups(
  sites: SitePlan[],
  cache: CacheMeta[],
  opts: PlanOpts,
): Target[] {
  if (opts.budget <= 0) return [];

  const fetchedAt = new Map<string, number>();
  for (const c of cache) {
    const ms = Date.parse(c.fetchedAt);
    if (!Number.isNaN(ms)) fetchedAt.set(cacheRowKey(c), ms);
  }
  const staleBefore = opts.now.getTime() - opts.ttlDays * DAY_MS;

  const missingBySite = sites.map((s) => ({
    site: s,
    missing: s.targets.filter((t) => !fetchedAt.has(targetKey(t))),
  }));
  // Weby s najmenším počtom chýbajúcich cieľov idú prvé. Array.prototype.sort je
  // v ES2019+ stabilný → pri zhode počtu ostáva vstupné poradie.
  missingBySite.sort((a, b) => a.missing.length - b.missing.length);

  const seen = new Set<string>();
  const out: Target[] = [];
  // Vráti false, keď je rozpočet vyčerpaný (volajúci má skončiť). Duplicita sa
  // zahodí bez zápočtu do rozpočtu.
  const push = (t: Target): boolean => {
    const k = targetKey(t);
    if (seen.has(k)) return true;
    seen.add(k);
    out.push(t);
    return out.length < opts.budget;
  };

  for (const { missing } of missingBySite) {
    for (const t of missing) {
      if (!push(t)) return out;
    }
  }

  // Stale: zbieraj naprieč webmi, dedupni a zoraď od najstaršieho.
  const stale: { target: Target; at: number }[] = [];
  const staleSeen = new Set<string>();
  for (const s of sites) {
    for (const t of s.targets) {
      const k = targetKey(t);
      if (staleSeen.has(k)) continue;
      const at = fetchedAt.get(k);
      if (at === undefined || at > staleBefore) continue; // chýbajúce (už vyššie) alebo čerstvé
      staleSeen.add(k);
      stale.push({ target: t, at });
    }
  }
  stale.sort((a, b) => a.at - b.at);
  for (const { target } of stale) {
    if (!push(target)) return out;
  }

  return out;
}

// Web je vyhodnotiteľný, len ak je KAŽDÝ jeho cieľ v cache — čerstvý ALEBO stale.
//
// Prečo stale ráta ako „prítomné": 31 dní starý zoznam zraniteľností sú reálne
// dáta (nanajvýš mu chýba brand-new CVE) a preskočiť kvôli nemu celý web by
// zahodilo všetko za nič. Stale navyše NEMÔŽE vyrobiť falošnú udalosť
// „zraniteľnosť opravená": je byte-identické s tým, čo minulý beh už uložil →
// diff nevygeneruje nič. Naopak CHÝBAJÚCI cieľ znamená neúplný zoznam — ten by
// diffVulns prečítal ako „vulns zmizli" a ohlásil klientovi fabrikovanú dobrú
// správu (+ zmazal reálne CVE z DB). Preto chýbajúce = skip celého webu.
//
// `presentKeys` MUSÍ obsahovať len kľúče riadkov s poľom vo `vulns` — riadok s
// nepoužiteľným tvarom (napr. JSON `null`) je „chýbajúci", nie „prázdny".
export function siteComplete(targets: Target[], presentKeys: ReadonlySet<string>): boolean {
  return targets.every((t) => presentKeys.has(targetKey(t)));
}

// ── Projekcia vulns ─────────────────────────────────────────────────────────

export interface CachedVuln {
  title?: unknown;
  cve?: unknown;
  fixed_in?: unknown;
  cvss?: unknown;
  severity?: unknown;
}

export interface VulnRecord {
  target: string;
  slug: string;
  version: string | null;
  title: unknown;
  cve: unknown;
  fixed_in: unknown;
  cvss: number | null;
  severity: string;
}

// Zloží zoznam zraniteľností webu z cache: pre každý cieľ vezmi jeho cachované
// vulns a nechaj len tie, čo sedia na nainštalovanú verziu.
//
// `slug` v zázname je zámerne `recordSlug` (pre jadro 'wordpress', NIE verzia) —
// je to identita, na ktorej diffVulns páruje záznamy medzi behmi. Viď komentár
// pri `Target`.
//
// `severity` je z cache (obohatené pri fetchi). Akceptovaná cena presunu
// obohatenia na fetch-time: keď v tej chvíli zlyhal NVD lookup, ostane severity
// 'unknown' až do vypršania TTL. 'unknown' je čestné („skóre nepoznáme"), nie
// fabrikované — preto je to prijateľné.
export function projectVulns(
  targets: Target[],
  cache: ReadonlyMap<string, readonly CachedVuln[]>,
): VulnRecord[] {
  const out: VulnRecord[] = [];
  for (const t of targets) {
    for (const v of cache.get(targetKey(t)) ?? []) {
      if (!isAffected(t.version, v.fixed_in)) continue;
      out.push({
        target: t.label,
        slug: t.recordSlug,
        version: t.version,
        title: v.title ?? null,
        cve: v.cve ?? null,
        fixed_in: v.fixed_in ?? null,
        cvss: typeof v.cvss === 'number' ? v.cvss : null,
        severity: typeof v.severity === 'string' ? v.severity : 'unknown',
      });
    }
  }
  return out;
}
