# Detekcia rozbitého CSS (Elementor stale-cache) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hodinový collector, ktorý na 5 stránkach každého webu skontroluje, či referencované CSS súbory reálne existujú (200), a pri 404/chybe pošle e-mail `css_broken`.

**Architecture:** Čistá logika (extrakcia stylesheetov/menu, klasifikácia) v `packages/core/src/assetCheck.ts` (testovaná vitestom). IO collector `tools/asset-check/index.mjs` cez `runJob`, alert cez zdieľaný `tools/_shared/raiseAlert.mjs`. Bez migrácie, bez novej tabuľky. Detekcia + e-maily fungujú hneď po `git push` (existujúci Worker dréni všetky alert typy). Napojenie na dead-man's-switch (Task 5) je latentné do redeployu Workera/webu.

**Tech Stack:** Node ESM collector (GitHub Actions cron), TypeScript `@agency/core` (tsc → dist), vitest.

Spec: `docs/superpowers/specs/2026-07-20-detekcia-rozbiteho-css-design.md`

---

### Task 1: core — extractStylesheets

**Files:**
- Create: `packages/core/src/assetCheck.ts`
- Test: `packages/core/src/assetCheck.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { extractStylesheets } from './assetCheck';

describe('extractStylesheets', () => {
  const base = 'https://x.sk/';
  it('vytiahne href zo <link rel=stylesheet> a spraví absolútne URL', () => {
    const html = `<link rel="stylesheet" href="/a.css"><link rel='stylesheet' href='https://cdn.sk/b.css'>`;
    expect(extractStylesheets(html, base)).toEqual(['https://x.sk/a.css', 'https://cdn.sk/b.css']);
  });
  it('href pred rel aj nezaškvalené rel', () => {
    const html = `<link href="/c.css" rel=stylesheet>`;
    expect(extractStylesheets(html, base)).toEqual(['https://x.sk/c.css']);
  });
  it('ignoruje ne-stylesheet <link> (icon, preconnect, canonical)', () => {
    const html = `<link rel="icon" href="/f.ico"><link rel="canonical" href="/"><link rel="preload" href="/p.css">`;
    expect(extractStylesheets(html, base)).toEqual([]);
  });
  it('deduplikuje rovnaké URL', () => {
    const html = `<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/a.css">`;
    expect(extractStylesheets(html, base)).toEqual(['https://x.sk/a.css']);
  });
  it('zachová query (?ver=) — Elementor cache-bust', () => {
    const html = `<link rel="stylesheet" href="/wp-content/uploads/elementor/css/post-12.css?ver=170">`;
    expect(extractStylesheets(html, base)).toEqual(['https://x.sk/wp-content/uploads/elementor/css/post-12.css?ver=170']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agency/core exec vitest run src/assetCheck.test.ts`
Expected: FAIL — `extractStylesheets` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// Detekcia rozbitého CSS: čistá logika (bez IO), testovateľná. Collector
// tools/asset-check/index.mjs robí fetch a volá tieto funkcie.

// Absolútne URL všetkých <link rel="stylesheet">. `rel` môže byť pred aj za
// `href`, hodnota zaškvalená aj nie; berieme len tie, kde rel obsahuje
// „stylesheet" (nie icon/preload/canonical). Neplatné URL sa ticho vynechajú.
export function extractStylesheets(html: string, baseUrl: string): string[] {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  const out: string[] = [];
  for (const tag of tags) {
    if (!/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(tag)) continue;
    const m = tag.match(/\bhref\s*=\s*"([^"]+)"/i) ?? tag.match(/\bhref\s*=\s*'([^']+)'/i) ?? tag.match(/\bhref\s*=\s*([^\s>]+)/i);
    if (!m) continue;
    try {
      out.push(new URL(m[1], baseUrl).href);
    } catch {
      /* neplatné URL — vynechaj */
    }
  }
  return [...new Set(out)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agency/core exec vitest run src/assetCheck.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assetCheck.ts packages/core/src/assetCheck.test.ts
git commit -m "feat(core): extractStylesheets for broken-CSS detector"
```

---

### Task 2: core — extractMenuLinks

**Files:**
- Modify: `packages/core/src/assetCheck.ts`
- Test: `packages/core/src/assetCheck.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing test file)

```ts
import { extractMenuLinks } from './assetCheck';

describe('extractMenuLinks', () => {
  const origin = 'https://x.sk';
  it('vezme interné odkazy z <nav>, max N, dedup, bez homepage/#/mailto', () => {
    const html = `
      <header><a href="/">Domov</a><nav>
        <a href="/sluzby">Služby</a><a href="/o-nas/">O nás</a>
        <a href="/sluzby">Služby dup</a><a href="mailto:a@x.sk">Mail</a>
        <a href="https://iny.sk/extern">Extern</a><a href="#top">Hore</a>
      </nav></header>`;
    expect(extractMenuLinks(html, origin, 4)).toEqual(['https://x.sk/sluzby', 'https://x.sk/o-nas']);
  });
  it('fallback: bez nav/header doplní prvými internými odkazmi z celej stránky', () => {
    const html = `<a href="/a">A</a><a href="/b">B</a><a href="https://cdn.sk/x">Ext</a>`;
    expect(extractMenuLinks(html, origin, 4)).toEqual(['https://x.sk/a', 'https://x.sk/b']);
  });
  it('reže na max', () => {
    const html = `<nav><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></nav>`;
    expect(extractMenuLinks(html, origin, 2)).toEqual(['https://x.sk/a', 'https://x.sk/b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agency/core exec vitest run src/assetCheck.test.ts`
Expected: FAIL — `extractMenuLinks` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `assetCheck.ts`)

```ts
function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

// Interné odkazy z hlavného menu. Najprv skús <nav>, potom <header>; ak sa
// nenaplní `max`, doplň prvými internými <a> z celej stránky (fallback pre
// weby bez rozpoznateľného nav). Vynecháva homepage samotnú, #, mailto:, tel:,
// javascript:, externé domény. Normalizuje (bez trailing / a bez #fragmentu),
// deduplikuje, reže na `max`.
export function extractMenuLinks(html: string, origin: string, max = 4): string[] {
  const root = origin.replace(/\/$/, '');
  const pick = (fragment: string): string[] => {
    const hrefs = [...fragment.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    const out: string[] = [];
    for (const h of hrefs) {
      if (/^(#|mailto:|tel:|javascript:)/i.test(h)) continue;
      let abs: string;
      try {
        abs = new URL(h, origin).href;
      } catch {
        continue;
      }
      if (!sameOrigin(abs, origin)) continue;
      const norm = abs.split('#')[0].replace(/\/$/, '');
      if (norm === root) continue; // homepage samotnú nepridávaj
      if (!out.includes(norm)) out.push(norm);
    }
    return out;
  };
  const region = html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] ?? html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? '';
  const links = pick(region);
  if (links.length < max) {
    for (const l of pick(html)) {
      if (links.length >= max) break;
      if (!links.includes(l)) links.push(l);
    }
  }
  return links.slice(0, max);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agency/core exec vitest run src/assetCheck.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assetCheck.ts packages/core/src/assetCheck.test.ts
git commit -m "feat(core): extractMenuLinks for broken-CSS detector"
```

---

### Task 3: core — classifyAsset

**Files:**
- Modify: `packages/core/src/assetCheck.ts`
- Test: `packages/core/src/assetCheck.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { classifyAsset } from './assetCheck';

describe('classifyAsset', () => {
  it('404/410/5xx → broken', () => {
    expect(classifyAsset({ status: 404, bytes: 0 })).toBe('broken');
    expect(classifyAsset({ status: 410, bytes: 123 })).toBe('broken');
    expect(classifyAsset({ status: 500, bytes: 0 })).toBe('broken');
  });
  it('200 s obsahom → ok', () => {
    expect(classifyAsset({ status: 200, bytes: 4200 })).toBe('ok');
    expect(classifyAsset({ status: 200, bytes: null })).toBe('ok'); // dĺžku nevieme → dôveruj 2xx
  });
  it('200 ale 0 bajtov → broken (prázdny CSS)', () => {
    expect(classifyAsset({ status: 200, bytes: 0 })).toBe('broken');
  });
  it('null status (naša sieťová chyba/timeout) → unknown, NIE broken', () => {
    expect(classifyAsset({ status: null, bytes: null })).toBe('unknown');
  });
  it('3xx (redirect nenasledovaný) → unknown', () => {
    expect(classifyAsset({ status: 302, bytes: 0 })).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @agency/core exec vitest run src/assetCheck.test.ts`
Expected: FAIL — `classifyAsset` not exported.

- [ ] **Step 3: Write minimal implementation** (append)

```ts
export type AssetVerdict = 'ok' | 'broken' | 'unknown';

// `bytes: null` = dĺžku nevieme (napr. HEAD bez Content-Length) — pri 2xx to
// NEráta ako prázdne. `status: null` = NAŠA sieťová chyba/timeout, nie fakt o
// webe → `unknown` (nikdy nehlásime ako broken; collector to skúsi znova a ak
// stále unknown, preskočí — zero-fabrication).
export function classifyAsset({ status, bytes }: { status: number | null; bytes: number | null }): AssetVerdict {
  if (status === null) return 'unknown';
  if (status >= 400) return 'broken';
  if (status >= 200 && status < 300) return bytes === 0 ? 'broken' : 'ok';
  return 'unknown'; // 1xx/3xx — neistý stav, nehlásime
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @agency/core exec vitest run src/assetCheck.test.ts`
Expected: PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/assetCheck.ts packages/core/src/assetCheck.test.ts
git commit -m "feat(core): classifyAsset for broken-CSS detector"
```

---

### Task 4: core — barrel export + build

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the export**

Otvor `packages/core/src/index.ts` a pridaj na koniec (barrel používa named exporty bez `.js`, viď `./eol`/`./proactive` riadky):

```ts
export { extractStylesheets, extractMenuLinks, classifyAsset, type AssetVerdict } from './assetCheck';
```

- [ ] **Step 2: Build + full core test**

Run: `pnpm --filter @agency/core build && pnpm --filter @agency/core test`
Expected: build OK (`dist/assetCheck.js` existuje), všetky testy zelené.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export assetCheck"
```

---

### Task 5: dead-man's-switch + UI napojenie (latentné do redeployu Workera/webu)

**Files:**
- Modify: `packages/core/src/jobSchedule.ts`
- Modify: `packages/core/src/jobSchedule.test.ts`
- Modify: `apps/web/app/settings/page.tsx`
- Modify: `apps/scheduler/src/trigger.ts`

- [ ] **Step 1: Pridaj `hourly` do typu + interval + entry (jobSchedule.ts)**

V `packages/core/src/jobSchedule.ts`:

Do union `JobSchedule` pridaj člen:
```ts
  | { kind: 'hourly' }
```
Do `JOB_SCHEDULES` pridaj (za `report`):
```ts
  'asset-check': { kind: 'hourly' },
```
Do `expectedIntervalMs` switch pridaj vetvu:
```ts
    case 'hourly':
      return 3_600_000;
```

- [ ] **Step 2: jobSchedule test (append do jobSchedule.test.ts)**

```ts
it('asset-check je hourly a expectedIntervalMs = 1 h', () => {
  expect(JOB_SCHEDULES['asset-check']!.kind).toBe('hourly');
  expect(expectedIntervalMs({ kind: 'hourly' })).toBe(3_600_000);
});
```
(Ak test súbor ešte neimportuje `expectedIntervalMs`, doplň ho do importu z `./jobSchedule`.)

Run: `pnpm --filter @agency/core exec vitest run src/jobSchedule.test.ts`
Expected: PASS.

- [ ] **Step 3: UI — JOBS entry + nextRun hourly case (settings/page.tsx)**

Do poľa `JOBS` (pred `].map(...)`, za `report` riadok) pridaj:
```ts
  { key: 'asset-check', label: 'Kontrola CSS (rozbité assety)', desc: 'každú hodinu' },
```

V `nextRun`, hneď za blok `if (sched.kind === 'every5') { ... }` (pred `n.setUTCHours(...)`) pridaj:
```ts
  if (sched.kind === 'hourly') {
    n.setUTCMinutes(0, 0, 0);
    n.setUTCHours(from.getUTCHours() + 1);
    return n;
  }
```
(Musí byť PRED `n.setUTCHours(sched.hh, ...)`, lebo `hourly` nemá `hh`/`mm`.)

Do `DISPATCHABLE` set pridaj `'asset-check'`:
```ts
const DISPATCHABLE = new Set(['psi', 'tls', 'security', 'aeo', 'gsc', 'seo', 'infra', 'cve', 'history', 'digest', 'report', 'asset-check']);
```

- [ ] **Step 4: Worker trigger mapping (trigger.ts)**

Do `WORKFLOWS` v `apps/scheduler/src/trigger.ts` pridaj:
```ts
  'asset-check': 'asset-check.yml',
```

- [ ] **Step 5: Build overenie**

Run: `pnpm --filter @agency/core build && pnpm --filter @agency/core test && pnpm --filter @agency/scheduler typecheck`
Expected: všetko zelené.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/jobSchedule.ts packages/core/src/jobSchedule.test.ts apps/web/app/settings/page.tsx apps/scheduler/src/trigger.ts
git commit -m "feat(health): register asset-check job (hourly) + UI + dispatch"
```

---

### Task 6: collector tools/asset-check

**Files:**
- Create: `tools/asset-check/index.mjs`
- Create: `tools/asset-check/package.json`

- [ ] **Step 1: package.json**

```json
{
  "name": "@agency/asset-check",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Node collector: kontrola rozbitých CSS (404 referencovaných stylesheetov) na 5 stránkach každého webu → alert css_broken. GitHub Action, zadarmo.",
  "scripts": {
    "probe": "node index.mjs"
  }
}
```

- [ ] **Step 2: collector index.mjs**

```js
#!/usr/bin/env node
// Detekcia rozbitého CSS: na homepage + ~4 hlavných menu stránkach každého webu
// vytiahne <link rel="stylesheet"> a overí, či CSS súbory reálne existujú (200).
// 404/chyba na referencovanom CSS = rozbité (typicky Elementor prečísluje/zmaže
// vygenerovaný CSS a zacachovaná HTML naň stále odkazuje). Alert css_broken.
//
// Zero-fabrication: rozbité = LEN definitívny non-200 (404/5xx) alebo 0-bajtový
// 200; NAŠA sieťová chyba/timeout sa NEhlási (1 retry, potom preskoč). Web dole
// rieši uptime, nie tento job. 503 (údržba) sa preskočí.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { runJob } from '../_shared/runJob.mjs';
import { raiseAlerts } from '../_shared/raiseAlert.mjs';
import { extractStylesheets, extractMenuLinks, classifyAsset } from '../../packages/core/dist/assetCheck.js';

const UA = 'Mozilla/5.0 (Monitorix asset-check; +https://dash.lopatka.sk)';
const PAGE_TIMEOUT = 20_000;
const ASSET_TIMEOUT = 15_000;
const MAX_MENU = 4; // homepage + 4 = 5 stránok
const MAX_BROKEN_IN_BODY = 8; // koľko rozbitých vypísať do e-mailu

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// Vráti { status, bytes, text } | { status: null } pri sieťovej chybe/timeoute.
async function fetchText(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(PAGE_TIMEOUT), headers: { 'User-Agent': UA } });
    const text = await res.text();
    return { status: res.status, bytes: text.length, text };
  } catch {
    return { status: null, bytes: null, text: '' };
  }
}

// Stav CSS súboru: HEAD; ak HEAD nepodporený (405/501) → GET. `bytes` z
// Content-Length (HEAD) alebo z tela (GET); null ak sa nedá zistiť.
async function checkAsset(url) {
  const doReq = async (method) => {
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(ASSET_TIMEOUT), headers: { 'User-Agent': UA } });
      let bytes = null;
      const cl = res.headers.get('content-length');
      if (cl !== null && !Number.isNaN(Number(cl))) bytes = Number(cl);
      if (method === 'GET') bytes = (await res.text()).length;
      return { status: res.status, bytes };
    } catch {
      return { status: null, bytes: null };
    }
  };
  let r = await doReq('HEAD');
  if (r.status === 405 || r.status === 501) r = await doReq('GET');
  return r;
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,domain&is_active=eq.true`, { headers: restHeaders(key) });
  if (!sitesRes.ok) throw new Error(`load sites ${sitesRes.status}`);
  const sites = await sitesRes.json();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const alertRows = [];
  let ok = 0;
  let failed = 0;

  for (const s of sites) {
    try {
      const origin = `https://${s.domain}`;
      const home = await fetchText(origin + '/');
      // 503 = úmyselná údržba → preskoč (konzistentne s aeo/seo). Web dole
      // (status null / iný non-2xx na HOMEPAGE) rieši uptime, nie tento job.
      if (home.status === 503) {
        console.log(JSON.stringify({ ev: 'asset.skip_maintenance', domain: s.domain }));
        continue;
      }
      if (home.status === null || home.status >= 400) {
        console.log(JSON.stringify({ ev: 'asset.skip_home_unreachable', domain: s.domain, status: home.status }));
        continue;
      }

      // 5 stránok: homepage + menu. Zbieraj CSS → množina stránok, čo naň odkazujú.
      const menu = extractMenuLinks(home.text, origin, MAX_MENU);
      const pages = [origin + '/', ...menu];
      const cssToPages = new Map(); // css url -> Set(page)
      const addCss = (pageUrl, html) => {
        for (const css of extractStylesheets(html, pageUrl)) {
          if (!cssToPages.has(css)) cssToPages.set(css, new Set());
          cssToPages.get(css).add(pageUrl);
        }
      };
      addCss(origin + '/', home.text);
      for (const p of menu) {
        const pr = await fetchText(p);
        if (pr.status !== null && pr.status < 400) addCss(p, pr.text);
        await sleep(200);
      }

      // Over každý unikátny CSS (+1 retry na `unknown` — naša chyba, nie fakt).
      const broken = [];
      for (const [css, pageSet] of cssToPages) {
        let res = await checkAsset(css);
        let verdict = classifyAsset(res);
        if (verdict === 'unknown') {
          // `unknown` = naša sieťová chyba/timeout, nie fakt o webe → 1 retry.
          await sleep(1_000);
          res = await checkAsset(css);
          verdict = classifyAsset(res);
        }
        if (verdict === 'broken') broken.push({ css, status: res.status, page: [...pageSet][0] });
      }

      ok++;
      console.log(JSON.stringify({ ev: 'asset.ok', domain: s.domain, pages: pages.length, css: cssToPages.size, broken: broken.length }));

      if (broken.length) {
        const lines = broken.slice(0, MAX_BROKEN_IN_BODY).map((b) => `• ${b.css} → ${b.status ?? 'chyba'} (na ${b.page})`);
        const more = broken.length > MAX_BROKEN_IN_BODY ? `\n…a ďalších ${broken.length - MAX_BROKEN_IN_BODY}.` : '';
        alertRows.push({
          org_id: s.org_id,
          site_id: s.id,
          type: 'css_broken',
          severity: 'warning',
          title: `${s.domain}: rozbité CSS`,
          body: `${broken.length} CSS súborov nevrátilo platnú odpoveď (typicky zacachovaná stránka odkazuje na zmazaný CSS — pomôže premazanie cache):\n${lines.join('\n')}${more}`,
          dedupe_key: `css_broken:${s.id}:${day}`,
        });
      }
    } catch (e) {
      failed++;
      console.log(JSON.stringify({ ev: 'asset.fail', domain: s.domain, error: String(e?.message ?? e) }));
    }
  }

  await raiseAlerts(url, key, alertRows, 'asset.raise_fail');
  console.log(JSON.stringify({ ev: 'asset.done', ok, failed, alerts: alertRows.length }));
  return { ok, failed };
}

async function main() {
  await runJob('asset-check', run);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: node --check**

Run: `node --check tools/asset-check/index.mjs`
Expected: bez výstupu (OK).

- [ ] **Step 4: Commit**

```bash
git add tools/asset-check/
git commit -m "feat(asset-check): hourly broken-CSS collector"
```

---

### Task 7: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/asset-check.yml`

- [ ] **Step 1: Napíš workflow**

```yaml
name: asset-check

# Hodinová kontrola rozbitých CSS: na 5 stránkach každého webu overí, či
# referencované stylesheety reálne existujú (200). 404 = rozbité → alert
# css_broken. Ľahké HEAD kontroly, zadarmo.
on:
  schedule:
    - cron: '0 * * * *' # každú hodinu
  workflow_dispatch: {}
  push:
    tags:
      - 'collect-*'

jobs:
  asset-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @agency/core build
      - name: Run asset-check
        run: node tools/asset-check/index.mjs
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/asset-check.yml
git commit -m "ci(asset-check): hourly workflow"
```

---

### Task 8: Finálne overenie

- [ ] **Step 1: Celá suita + lint + node --check**

Run:
```bash
pnpm -r test && pnpm -r lint && node --check tools/asset-check/index.mjs && pnpm --filter @agency/scheduler typecheck
```
Expected: testy zelené (vrátane nových assetCheck + jobSchedule), lint bez errorov (pre-existing `apps/web` font warning OK), typecheck OK.

- [ ] **Step 2: Manuálne overenie logiky proti reálnym dátam (mimo commitu)**

Napíš dočasný skript v scratchpade, ktorý pre `soccercoacheshub.com` a `vzdelavanie.digital` spustí `extractMenuLinks` + `extractStylesheets` + `checkAsset` a vypíše počet stránok/CSS/rozbitých. Očakávaný výsledok: 5 stránok, desiatky CSS, **0 rozbitých** (aktuálny stav). Potvrdí to, že extrakcia aj kontrola fungujú na reálnom Elementor webe. Skript nekomituj.

- [ ] **Step 3: Deployment (až na „go")**

- **Detekcia + e-maily fungujú hneď po `git push`** — collector beží z repa v Actions (hodinový cron), `css_broken` alerty dréni existujúci Worker bez zmeny. Prvý beh: over v Actions logu `asset.done` a že soccercoaches/vzdelavanie majú `broken: 0`.
- **Task 5 (dead-man's-switch + UI riadok + ručné spustenie)** sa aktivuje až po **redeploy Workera** (`wrangler deploy`, potrebný CF token) **a redeploy webu** (push → Pages). Do vtedy je latentné — nič sa nerozbije, len asset-check nemá health-badge a nedá sa ručne dispatchnúť z UI. Owner rozhodne, či redeploy Workera spraviť teraz alebo pri najbližšej inej príležitosti.

---

## Poznámky k nasadeniu
- Žiadna migrácia, žiadna nová tabuľka, žiadny nový secret (collector používa tie isté `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` ako ostatné).
- `css_broken` nie je v `NIGHT_DEFERRED_TYPES` → posiela sa hneď (aj v noci). Dedupe 1×/deň/web.
