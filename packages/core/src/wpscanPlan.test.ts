import { describe, it, expect } from 'vitest';
import {
  buildTargets,
  planLookups,
  siteComplete,
  projectVulns,
  isAffected,
  targetKey,
  cacheRowKey,
  type SitePlan,
  type CacheMeta,
  type Target,
  type CachedVuln,
} from './wpscanPlan';
import { diffVulns } from './events';

const NOW = new Date('2026-07-17T00:00:00Z');
const TTL = 30;

// Pomocníci — skratky pre čitateľné fixtures.
const plugin = (slug: string, version: string | null = '1.0.0'): Target => ({
  kind: 'plugin', cacheSlug: slug, recordSlug: slug, label: slug, version,
});
const core = (version: string): Target => ({
  kind: 'core', cacheSlug: version, recordSlug: 'wordpress', label: 'WordPress', version,
});
const site = (siteId: string, slugs: string[]): SitePlan => ({ siteId, targets: slugs.map((s) => plugin(s)) });
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const cached = (slug: string, days: number, kind = 'plugin'): CacheMeta => ({ kind, slug, fetchedAt: daysAgo(days) });
const keys = (ts: { kind: string; cacheSlug: string }[]) => ts.map(targetKey);

describe('targetKey / cacheRowKey', () => {
  it('targetKey kľúčuje na cacheSlug, nie na recordSlug', () => {
    expect(targetKey(core('6.5.2'))).toBe('core:6.5.2');
    expect(targetKey(plugin('wordfence'))).toBe('plugin:wordfence');
  });

  it('cacheRowKey (riadok z DB) dá ten istý kľúč ako targetKey', () => {
    expect(cacheRowKey({ kind: 'core', slug: '6.5.2' })).toBe(targetKey(core('6.5.2')));
  });
});

describe('buildTargets', () => {
  it('jadro má cacheSlug=verzia, ale recordSlug=wordpress (dve identity)', () => {
    const r = buildTargets({ wp_version: '6.5.2', plugins: [{ slug: 'yoast', name: 'Yoast SEO', version: '20.1' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.targets[0]).toEqual({
      kind: 'core', cacheSlug: '6.5.2', recordSlug: 'wordpress', label: 'WordPress', version: '6.5.2',
    });
    expect(r.targets[1]).toEqual({
      kind: 'plugin', cacheSlug: 'yoast', recordSlug: 'yoast', label: 'Yoast SEO', version: '20.1',
    });
  });

  it('preskočí nášho vlastného agenta', () => {
    const r = buildTargets({ wp_version: '6.5.2', plugins: [{ slug: 'monitorix-agent' }, { slug: 'yoast' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(keys(r.targets)).toEqual(['core:6.5.2', 'plugin:yoast']);
  });

  it('plugin bez slugu → bad_plugin (fail-closed, nie čiastočný zoznam)', () => {
    const r = buildTargets({ wp_version: '6.5.2', plugins: [{ slug: 'yoast' }, { name: 'Rozbitý' }] });
    expect(r).toEqual({ ok: false, reason: 'bad_plugin', offending: 'Rozbitý' });
  });

  it.each([
    ['prázdny slug', { slug: '   ' }],
    ['slug nie je string', { slug: 42 }],
    ['null položka', null],
    ['slug undefined', { name: 'x' }],
  ])('nescanovateľný plugin (%s) → bad_plugin', (_label, entry) => {
    const r = buildTargets({ wp_version: '6.5.2', plugins: [entry] });
    expect(r.ok).toBe(false);
  });

  it('bad_plugin bez použiteľného mena → offending null', () => {
    const r = buildTargets({ wp_version: '6.5.2', plugins: [{}] });
    expect(r).toEqual({ ok: false, reason: 'bad_plugin', offending: null });
  });

  it('rozbitá verzia jadra → bad_core', () => {
    expect(buildTargets({ wp_version: 'neznáma', plugins: [{ slug: 'x' }] }))
      .toEqual({ ok: false, reason: 'bad_core', offending: 'neznáma' });
  });

  it('chýbajúca verzia jadra → bez core cieľa, pluginy sa scanujú ďalej', () => {
    const r = buildTargets({ wp_version: null, plugins: [{ slug: 'yoast' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(keys(r.targets)).toEqual(['plugin:yoast']);
  });

  it('plugin bez verzie → version null (isAffected to ustojí)', () => {
    const r = buildTargets({ wp_version: '6.5.2', plugins: [{ slug: 'x' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.targets).toMatchObject([{ kind: 'core' }, { kind: 'plugin', cacheSlug: 'x', version: null }]);
  });
});

describe('isAffected', () => {
  it('bez fixed_in → zraniteľné', () => {
    expect(isAffected('1.0.0', null)).toBe(true);
  });

  it('nižšia verzia než fixed_in → zraniteľné', () => {
    expect(isAffected('1.2.9', '1.2.10')).toBe(true);
    expect(isAffected('1.2.10', '1.2.9')).toBe(false);
    expect(isAffected('1.2.10', '1.2.10')).toBe(false);
  });

  it('neznáma inštalovaná verzia → nefabrikuj zraniteľnosť', () => {
    expect(isAffected(null, '1.0.0')).toBe(false);
  });
});

describe('planLookups — rozpočet', () => {
  it('budget 0 alebo záporný → nič', () => {
    const sites = [site('a', ['x', 'y'])];
    expect(planLookups(sites, [], { budget: 0, now: NOW, ttlDays: TTL })).toEqual([]);
    expect(planLookups(sites, [], { budget: -5, now: NOW, ttlDays: TTL })).toEqual([]);
  });

  it('všetko čerstvé → nič netreba sťahovať', () => {
    const sites = [site('a', ['x', 'y'])];
    const cache = [cached('x', 1), cached('y', 29)];
    expect(planLookups(sites, cache, { budget: 25, now: NOW, ttlDays: TTL })).toEqual([]);
  });

  it('oreže na rozpočet — a to na PRVÉ dva v poradí, nie na hocijaké dva', () => {
    const sites = [site('a', ['x', 'y', 'z', 'w'])];
    const out = planLookups(sites, [], { budget: 2, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:x', 'plugin:y']);
  });

  it('duplicita nemíňa rozpočet', () => {
    const sites = [site('a', ['x']), site('b', ['x', 'y'])];
    const out = planLookups(sites, [], { budget: 2, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:x', 'plugin:y']);
  });
});

describe('planLookups — chýbajúce ciele', () => {
  it('dedupuje slug potrebný viacerými webmi (wordfence na 6 weboch = 1 lookup)', () => {
    const sites = [site('a', ['wordfence']), site('b', ['wordfence']), site('c', ['wordfence', 'yoast'])];
    const out = planLookups(sites, [], { budget: 25, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:wordfence', 'plugin:yoast']);
  });

  it('site-completion-greedy: malý web ide pred veľkým', () => {
    const big = site('big', ['b1', 'b2', 'b3', 'b4']);
    const small = site('small', ['s1', 's2']);
    const out = planLookups([big, small], [], { budget: 25, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:s1', 'plugin:s2', 'plugin:b1', 'plugin:b2', 'plugin:b3', 'plugin:b4']);
  });

  it('greedy sa počíta z CHÝBAJÚCICH, nie z celkových cieľov', () => {
    // „big" má 4 ciele, ale 3 už v cache → chýba mu 1 → ide prvý.
    const big = site('big', ['b1', 'b2', 'b3', 'b4']);
    const small = site('small', ['s1', 's2']);
    const cache = [cached('b1', 1), cached('b2', 1), cached('b3', 1)];
    const out = planLookups([big, small], cache, { budget: 25, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:b4', 'plugin:s1', 'plugin:s2']);
  });

  it('pri zhode počtu chýbajúcich ostáva vstupné poradie (stabilný sort)', () => {
    const out = planLookups([site('a', ['a1', 'a2']), site('b', ['b1', 'b2'])], [], { budget: 25, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:a1', 'plugin:a2', 'plugin:b1', 'plugin:b2']);
  });

  it('spracuje kind:core popri pluginoch', () => {
    const sites: SitePlan[] = [{ siteId: 'a', targets: [core('6.5.2'), plugin('yoast')] }];
    const out = planLookups(sites, [], { budget: 25, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['core:6.5.2', 'plugin:yoast']);
  });

  it('core a plugin s rovnakým slugom sú rôzne ciele', () => {
    const sites: SitePlan[] = [{ siteId: 'a', targets: [core('6.5.2'), plugin('6.5.2')] }];
    const out = planLookups(sites, [cached('6.5.2', 1, 'core')], { budget: 25, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:6.5.2']);
  });
});

describe('planLookups — stale ciele', () => {
  it('stale sa sťahuje od najstaršieho', () => {
    const sites = [site('a', ['mid', 'oldest', 'newest'])];
    const cache = [cached('mid', 40), cached('oldest', 90), cached('newest', 31)];
    const out = planLookups(sites, cache, { budget: 25, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:oldest', 'plugin:mid', 'plugin:newest']);
  });

  it('chýbajúce prebijú stale aj keď je stale prastaré', () => {
    const sites = [site('a', ['ancient', 'fresh', 'gone'])];
    const cache = [cached('ancient', 900), cached('fresh', 1)];
    const out = planLookups(sites, cache, { budget: 25, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:gone', 'plugin:ancient']);
  });

  it('VŠETKY chýbajúce naprieč webmi idú pred akýmkoľvek stale', () => {
    const a = { siteId: 'a', targets: [plugin('a-stale'), plugin('a-missing')] };
    const b = { siteId: 'b', targets: [plugin('b-missing1'), plugin('b-missing2'), plugin('b-stale')] };
    const cache = [cached('a-stale', 900), cached('b-stale', 800)];
    const out = planLookups([a, b], cache, { budget: 25, now: NOW, ttlDays: TTL });
    // a chýba 1, b chýbajú 2 → najprv a-missing, potom b-*; stale až úplne nakoniec,
    // a v rámci stale od najstaršieho (a-stale 900 dní pred b-stale 800 dní).
    expect(keys(out)).toEqual(['plugin:a-missing', 'plugin:b-missing1', 'plugin:b-missing2', 'plugin:a-stale', 'plugin:b-stale']);
  });

  it('rozpočet minutý na chýbajúce → na stale nezvýši', () => {
    const sites = [site('a', ['m1', 'm2', 'old'])];
    const out = planLookups(sites, [cached('old', 500)], { budget: 2, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:m1', 'plugin:m2']);
  });

  it('TTL hranica: presne ttlDays staré je stale, o chlp mladšie nie', () => {
    const sites = [site('a', ['exact']), site('b', ['justUnder'])];
    const cache = [
      { kind: 'plugin', slug: 'exact', fetchedAt: daysAgo(30) },
      { kind: 'plugin', slug: 'justUnder', fetchedAt: new Date(NOW.getTime() - 30 * 86_400_000 + 1000).toISOString() },
    ];
    const out = planLookups(sites, cache, { budget: 25, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:exact']);
  });

  it('stale sa dedupuje naprieč webmi', () => {
    const sites = [site('a', ['shared']), site('b', ['shared'])];
    const out = planLookups(sites, [cached('shared', 60)], { budget: 25, now: NOW, ttlDays: TTL });
    expect(keys(out)).toEqual(['plugin:shared']);
  });
});

// Toto je test, ktorý by finding 2 (týždenný cron) nedovolil prehliadnuť: pri
// 25/beh a ~188 cieľoch musí fill skončiť v ~8 behoch. Keby bol rozpočet
// efektívne 25/týždeň, je to 8 týždňov a TTL 30 dní sa nikdy nedobehne.
describe('planLookups — konvergencia', () => {
  it('opakované plánovanie naplní cache úplne a potom sa zastaví', () => {
    const shared = Array.from({ length: 10 }, (_, i) => `shared-${i}`);
    let uniq = 0;
    const sites: SitePlan[] = [12, 15, 20, 25, 40, 113].map((n, si) => ({
      siteId: `site-${si}`,
      targets: [
        core(`6.${si % 3}.0`),
        ...[...shared, ...Array.from({ length: n - shared.length }, () => `p-${uniq++}`)].map((s) => plugin(s)),
      ],
    }));
    const allKeys = new Set(sites.flatMap((s) => s.targets.map(targetKey)));

    // Simuluje tabuľku wpscan_cache: kľúč → (cieľ, kedy stiahnutý).
    const cacheAt = new Map<string, { target: Target; at: number }>();
    const start = NOW.getTime();
    let day = 0;
    for (; day < 100; day++) {
      const now = new Date(start + day * 86_400_000);
      const meta: CacheMeta[] = [...cacheAt.values()].map(({ target, at }) => ({
        kind: target.kind, slug: target.cacheSlug, fetchedAt: new Date(at).toISOString(),
      }));
      const planned = planLookups(sites, meta, { budget: 25, now, ttlDays: TTL });
      if (planned.length === 0) break;
      expect(planned.length).toBeLessThanOrEqual(25);
      for (const t of planned) cacheAt.set(targetKey(t), { target: t, at: now.getTime() });
    }

    expect(day).toBeLessThanOrEqual(9); // ~8 dní pri 25/deň
    expect(new Set(cacheAt.keys())).toEqual(allKeys); // každý cieľ stiahnutý
    // Po naplnení je každý web vyhodnotiteľný.
    const present = new Set(cacheAt.keys());
    for (const s of sites) expect(siteComplete(s.targets, present)).toBe(true);
  });
});

describe('siteComplete', () => {
  it('všetky ciele v cache → true', () => {
    expect(siteComplete([plugin('x'), plugin('y')], new Set(['plugin:x', 'plugin:y']))).toBe(true);
  });

  it('stale-ale-prítomné ráta ako kompletné (prítomnosť, nie čerstvosť)', () => {
    // siteComplete nepozná fetchedAt — rozhoduje len prítomnosť kľúča. Stale
    // dáta sú reálne dáta a nemôžu vyrobiť falošné „opravené".
    expect(siteComplete([plugin('x')], new Set(['plugin:x']))).toBe(true);
  });

  it('jeden chýbajúci → false (skip celého webu, žiadny zápis ani diff)', () => {
    expect(siteComplete([plugin('x'), plugin('y')], new Set(['plugin:x']))).toBe(false);
  });

  it('prázdne ciele → true', () => {
    expect(siteComplete([], new Set())).toBe(true);
  });

  it('core sa hľadá pod cacheSlug (verziou), nie pod wordpress', () => {
    const targets = [core('6.5.2'), plugin('x')];
    expect(siteComplete(targets, new Set(['plugin:x', 'core:wordpress']))).toBe(false);
    expect(siteComplete(targets, new Set(['plugin:x', 'core:6.5.2']))).toBe(true);
  });
});

describe('projectVulns', () => {
  const vuln = (over: Partial<CachedVuln> = {}): CachedVuln => ({
    title: 'XSS', cve: 'CVE-2024-1111', fixed_in: '2.0.0', cvss: 7.5, severity: 'high', ...over,
  });

  it('zapíše recordSlug (wordpress), NIE cacheSlug (verziu) — kľúč pre diffVulns', () => {
    const out = projectVulns([core('6.5.2')], new Map([['core:6.5.2', [vuln({ fixed_in: '6.5.4' })]]]));
    expect(out).toEqual([{
      target: 'WordPress',
      slug: 'wordpress', // NIE '6.5.2'
      version: '6.5.2',
      title: 'XSS',
      cve: 'CVE-2024-1111',
      fixed_in: '6.5.4',
      cvss: 7.5,
      severity: 'high',
    }]);
  });

  it('odfiltruje už opravené (isAffected)', () => {
    const cache = new Map([['plugin:x', [vuln({ fixed_in: '1.0.0' })]]]);
    expect(projectVulns([plugin('x', '2.0.0')], cache)).toEqual([]);
  });

  it('nesie severity a cvss z cache', () => {
    const out = projectVulns([plugin('x', '1.0.0')], new Map([['plugin:x', [vuln()]]]));
    expect(out).toMatchObject([{ severity: 'high', cvss: 7.5, cve: 'CVE-2024-1111', fixed_in: '2.0.0' }]);
  });

  it('chýbajúca/nepoužiteľná severity → unknown (nefabrikujeme)', () => {
    const cache = new Map([['plugin:x', [vuln({ severity: undefined, cvss: undefined })]]]);
    const out = projectVulns([plugin('x', '1.0.0')], cache);
    expect(out).toMatchObject([{ severity: 'unknown', cvss: null }]);
  });

  it('cieľ bez záznamu v cache neprispeje ničím', () => {
    expect(projectVulns([plugin('x', '1.0.0')], new Map())).toEqual([]);
  });
});

// REGRESIA k finding 1: core vuln sa musí medzi behmi páriť na stabilnom slugu.
// Keby projectVulns zapísal cacheSlug (verziu), diffVulns by pri KAŽDOM update
// jadra ohlásil tú istú, stále neopravenú zraniteľnosť ako „vyriešenú" + „novú".
describe('regresia: round-trip buildTargets → projectVulns → diffVulns', () => {
  const coreVuln = { title: 'RCE', cve: 'CVE-2024-1111', fixed_in: '6.5.4', cvss: 9.1, severity: 'critical' };
  const build = (wp_version: string) => {
    const r = buildTargets({ wp_version, plugins: [{ slug: 'yoast', name: 'Yoast SEO', version: '20.1' }] });
    if (!r.ok) throw new Error('fixture sa nepodarilo zostaviť');
    return r.targets;
  };
  const cacheFor = (version: string) => new Map([
    [`core:${version}`, [coreVuln]],
    ['plugin:yoast', []],
  ]);

  it('nezmenený stav → žiadne udalosti', () => {
    const targets = build('6.5.2');
    const prev = projectVulns(targets, cacheFor('6.5.2'));
    const next = projectVulns(targets, cacheFor('6.5.2'));
    expect(diffVulns(prev, next)).toEqual([]);
  });

  it('update jadra 6.5.2 → 6.5.3 pri stále neopravenom CVE → ŽIADNE udalosti', () => {
    const prev = projectVulns(build('6.5.2'), cacheFor('6.5.2'));
    const next = projectVulns(build('6.5.3'), cacheFor('6.5.3'));
    // Zraniteľnosť je stále prítomná (fixed_in 6.5.4 > 6.5.3) — nesmie vzniknúť
    // ani „vyriešená", ani „nová".
    expect(next).toHaveLength(1);
    expect(diffVulns(prev, next)).toEqual([]);
  });

  it('skutočná oprava (6.5.2 → 6.5.4) → práve jedna „vyriešená"', () => {
    const prev = projectVulns(build('6.5.2'), cacheFor('6.5.2'));
    const next = projectVulns(build('6.5.4'), cacheFor('6.5.4'));
    expect(next).toEqual([]);
    expect(diffVulns(prev, next)).toMatchObject([
      { kind: 'cve', payload: { direction: 'fixed', cve: 'CVE-2024-1111' } },
    ]);
  });
});
