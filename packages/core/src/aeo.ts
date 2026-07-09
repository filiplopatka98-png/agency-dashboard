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
  const bots: Record<string, BotDecision> = {};
  let named = 0;
  for (const bot of AI_BOTS) {
    let decision: BotDecision = 'unset';
    for (let i = 0; i < lines.length; i++) {
      const ua = lines[i]!.match(/^user-agent:\s*(.+)$/i);
      if (ua && ua[1]!.trim().toLowerCase() === bot.toLowerCase()) {
        named++;
        decision = 'allow';
        for (let j = i + 1; j < lines.length && !/^user-agent:/i.test(lines[j]!); j++) {
          const dis = lines[j]!.match(/^disallow:\s*(.*)$/i);
          if (dis && dis[1]!.trim() === '/') decision = 'block';
        }
        break;
      }
    }
    bots[bot] = decision;
  }
  return { bots, namedCount: named };
}

export function scoreAeo(input: { html: string; robotsTxt: string; hasLlmsTxt: boolean }): AeoResult {
  const { html, robotsTxt, hasLlmsTxt } = input;
  const { objects, types } = extractJsonLd(html);
  const { bots, namedCount } = parseBots(robotsTxt);

  const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
  const h2 = (html.match(/<h2[\s>]/gi) ?? []).length;
  const hasCanonical = /<link[^>]+rel=["']?canonical/i.test(html);
  const hasFaq = types.includes('FAQPage');
  const hasOrg = types.includes('Organization');
  const hasWebSite = types.includes('WebSite');

  // priama odpoveď: prvý <p> po prvom <h2>, text ≤ 320 znakov
  let directAnswer = false;
  const h2idx = html.search(/<h2[\s>]/i);
  if (h2idx >= 0) {
    const after = html.slice(h2idx);
    const p = after.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (p) {
      const text = p[1]!.replace(/<[^>]+>/g, '').trim();
      directAnswer = text.length > 0 && text.length <= 320;
    }
  }

  const mk = (id: string, label: string, weight: number, pass: boolean, partial?: number): AeoCheck => ({
    id,
    label,
    weight,
    pass,
    earned: pass ? weight : (partial ?? 0),
  });

  const typesEarned = hasOrg && hasWebSite ? 15 : hasOrg || hasWebSite ? 8 : 0;

  const checks: AeoCheck[] = [
    mk('jsonld', 'JSON-LD štruktúrované dáta', 20, objects.length > 0),
    { id: 'types', label: 'Relevantné typy (Organization + WebSite)', weight: 15, earned: typesEarned, pass: typesEarned === 15 },
    mk('author', 'Author / E-E-A-T signály', 10, hasAuthorPerson(objects)),
    mk('freshness', 'Freshness (dateModified ≤ 12 mes.)', 10, freshDateModified(objects, html)),
    mk('headings', 'Nadpisová štruktúra (1× H1, H2)', 10, h1 === 1 && h2 >= 1),
    mk('direct', 'Priama odpoveď (≤ 320 znakov)', 5, directAnswer),
    mk('faq', 'FAQ bloky (FAQPage schema)', 10, hasFaq),
    mk('llms', 'llms.txt', 5, hasLlmsTxt),
    mk('aibots', 'AI boti explicitne v robots.txt', 10, namedCount > 0),
    mk('canonical', 'Canonical', 5, hasCanonical),
  ];

  const score = Math.min(100, checks.reduce((n, c) => n + c.earned, 0));
  return { score, checks, schemaTypes: types, hasLlmsTxt, aiBots: bots };
}
