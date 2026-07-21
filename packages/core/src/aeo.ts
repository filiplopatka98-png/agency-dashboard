/**
 * Deterministické AEO skóre (0–100) — pripravenosť webu pre AI vyhľadávače.
 * Čistá funkcia: vstup = HTML + robots.txt + či existuje llms.txt. Bez I/O.
 * Regex-based extrakcia (žiadny DOM) → runtime-agnostické (Node aj Worker).
 */

export type BotDecision = 'allow' | 'block' | 'unset';

export interface AeoCheck {
  id: string;
  label: string;
  weight: number;
  earned: number;
  pass: boolean;
}
export interface AeoResult {
  score: number;
  checks: AeoCheck[];
  schemaTypes: string[];
  hasLlmsTxt: boolean;
  aiBots: Record<string, BotDecision>;
}

export const AI_BOTS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'] as const;

function extractJsonLd(html: string): { objects: unknown[]; types: string[] } {
  const objects: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1]!.trim());
      if (Array.isArray(parsed)) objects.push(...parsed);
      else objects.push(parsed);
    } catch {
      /* ignoruj nevalidný blok */
    }
  }
  const types = new Set<string>();
  const collect = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    const t = rec['@type'];
    if (typeof t === 'string') types.add(t);
    if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
    if (Array.isArray(rec['@graph'])) (rec['@graph'] as unknown[]).forEach(collect);
  };
  objects.forEach(collect);
  return { objects, types: [...types] };
}

function hasAuthorPerson(objects: unknown[]): boolean {
  const walk = (o: unknown): boolean => {
    if (!o || typeof o !== 'object') return false;
    const rec = o as Record<string, unknown>;
    const a = rec['author'];
    if (a && typeof a === 'object') {
      const at = (a as Record<string, unknown>)['@type'];
      if (at === 'Person' || (Array.isArray(at) && at.includes('Person'))) return true;
      if ((a as Record<string, unknown>)['name']) return true;
    }
    if (Array.isArray(rec['@graph'])) return (rec['@graph'] as unknown[]).some(walk);
    return false;
  };
  return objects.some(walk);
}

function freshDateModified(objects: unknown[], html: string): boolean {
  const yearMs = 365 * 86400000;
  let iso: string | null = null;
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    if (typeof rec['dateModified'] === 'string') iso = rec['dateModified'] as string;
    if (Array.isArray(rec['@graph'])) (rec['@graph'] as unknown[]).forEach(walk);
  };
  objects.forEach(walk);
  if (!iso) {
    const meta = html.match(/<meta[^>]+(?:article:modified_time|og:updated_time)["'][^>]*content=["']([^"']+)/i);
    if (meta) iso = meta[1]!;
  }
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && Date.now() - t <= yearMs;
}

function parseBots(robotsTxt: string): { bots: Record<string, BotDecision>; namedCount: number } {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim());

  // robots.txt zoskupuje po sebe idúce `User-agent:` riadky pod JEDEN blok
  // pravidiel. Preto najprv rozdelíme súbor na skupiny {agenti[], pravidlá},
  // nech zdieľaný `Disallow: /` platí pre všetkých agentov skupiny — starý kód
  // čítal len po najbližší ďalší `User-agent:` a zoskupeného bota hlásil „allow".
  type Group = { agents: string[]; blocked: boolean };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let collectingAgents = false;
  for (const line of lines) {
    const ua = line.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      if (!cur || !collectingAgents) {
        cur = { agents: [], blocked: false };
        groups.push(cur);
        collectingAgents = true;
      }
      cur.agents.push(ua[1]!.trim().toLowerCase());
      continue;
    }
    if (!cur) continue;
    collectingAgents = false; // ďalšie riadky sú pravidlá tejto skupiny
    const dis = line.match(/^disallow:\s*(.*)$/i);
    if (dis && dis[1]!.trim() === '/') cur.blocked = true;
  }

  const bots: Record<string, BotDecision> = {};
  let named = 0;
  for (const bot of AI_BOTS) {
    const g = groups.find((grp) => grp.agents.includes(bot.toLowerCase()));
    if (!g) {
      bots[bot] = 'unset';
    } else {
      named++;
      bots[bot] = g.blocked ? 'block' : 'allow';
    }
  }
  return { bots, namedCount: named };
}

function directAnswerOk(html: string): boolean {
  // priama odpoveď: prvý <p> po prvom <h2>, text ≤ 320 znakov
  const h2idx = html.search(/<h2[\s>]/i);
  if (h2idx < 0) return false;
  const p = html.slice(h2idx).match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!p) return false;
  const text = p[1]!.replace(/<[^>]+>/g, '').trim();
  return text.length > 0 && text.length <= 320;
}

/**
 * AEO skóre. `html` môže byť jedna stránka (string) alebo viac stránok (string[]).
 * Agregácia naprieč stránkami: „existuje niekde“ checky (JSON-LD, typy, author,
 * freshness, FAQ, priama odpoveď) prejdú, ak ich spĺňa ktorákoľvek stránka; per-page
 * checky (1× H1, canonical) prejdú len ak ich spĺňa KAŽDÁ; site-level (llms.txt, AI
 * boti) sa hodnotia raz. Jedna stránka → identické správanie ako predtým.
 */
export function scoreAeo(input: { html: string | string[]; robotsTxt: string; hasLlmsTxt: boolean }): AeoResult {
  const { robotsTxt, hasLlmsTxt } = input;
  const htmls = (Array.isArray(input.html) ? input.html : [input.html]).filter((h) => typeof h === 'string');
  const pages = (htmls.length ? htmls : ['']).map((html) => {
    const { objects, types } = extractJsonLd(html);
    return {
      html,
      objects,
      types,
      h1: (html.match(/<h1[\s>]/gi) ?? []).length,
      h2: (html.match(/<h2[\s>]/gi) ?? []).length,
      hasCanonical: /<link[^>]+rel=["']?canonical/i.test(html),
      directAnswer: directAnswerOk(html),
    };
  });
  const { bots, namedCount } = parseBots(robotsTxt);

  const objectsAll = pages.flatMap((p) => p.objects);
  const typesAll = [...new Set(pages.flatMap((p) => p.types))];
  const hasOrg = typesAll.includes('Organization');
  const hasWebSite = typesAll.includes('WebSite');

  const mk = (id: string, label: string, weight: number, pass: boolean, partial?: number): AeoCheck => ({
    id,
    label,
    weight,
    pass,
    earned: pass ? weight : (partial ?? 0),
  });

  const typesEarned = hasOrg && hasWebSite ? 15 : hasOrg || hasWebSite ? 8 : 0;

  // Per-page checky (headings, canonical) sa skórujú PROPORCIONÁLNE k podielu
  // stránok, ktoré ich spĺňajú — jedna zlá stránka (napr. WP archív s 2× H1)
  // nezhodí celý web na 0. `pass` = spĺňajú VŠETKY (zelený stav v UI).
  const total = pages.length;
  const frac = (n: number) => (total ? n / total : 0);
  const h1OkCount = pages.filter((p) => p.h1 === 1).length;
  const someH2 = pages.some((p) => p.h2 >= 1);
  const headingsEarned = someH2 ? Math.round(10 * frac(h1OkCount)) : 0;
  const canonCount = pages.filter((p) => p.hasCanonical).length;
  const canonEarned = Math.round(5 * frac(canonCount));

  const checks: AeoCheck[] = [
    mk('jsonld', 'JSON-LD štruktúrované dáta', 20, objectsAll.length > 0),
    { id: 'types', label: 'Relevantné typy (Organization + WebSite)', weight: 15, earned: typesEarned, pass: typesEarned === 15 },
    mk('author', 'Author / E-E-A-T signály', 10, hasAuthorPerson(objectsAll)),
    mk('freshness', 'Freshness (dateModified ≤ 12 mes.)', 10, pages.some((p) => freshDateModified(p.objects, p.html))),
    { id: 'headings', label: 'Nadpisová štruktúra (1× H1, H2)', weight: 10, earned: headingsEarned, pass: h1OkCount === total && someH2 },
    mk('direct', 'Priama odpoveď (≤ 320 znakov)', 5, pages.some((p) => p.directAnswer)),
    mk('faq', 'FAQ bloky (FAQPage schema)', 10, typesAll.includes('FAQPage')),
    mk('llms', 'llms.txt', 5, hasLlmsTxt),
    mk('aibots', 'AI boti explicitne v robots.txt', 10, namedCount > 0),
    { id: 'canonical', label: 'Canonical', weight: 5, earned: canonEarned, pass: canonCount === total },
  ];

  const score = Math.min(100, checks.reduce((n, c) => n + c.earned, 0));
  return { score, checks, schemaTypes: typesAll, hasLlmsTxt, aiBots: bots };
}
