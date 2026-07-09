/**
 * SEO technická analýza — čisté funkcie (regex, žiadny DOM, žiadne I/O).
 * analyzePage: rozbor jednej HTML stránky. buildSeoIssues: agregácia do issues.
 * Crawl orchestrácia (fetch, BFS) je v collectori (tools/seo-crawl).
 */

export interface PageAnalysis {
  url: string;
  hasTitle: boolean;
  title: string;
  titleLen: number;
  hasMetaDesc: boolean;
  h1Count: number;
  hasCanonical: boolean;
  imagesNoAlt: number;
  internalLinks: string[];
  mixedContent: number;
}

export interface SeoIssue {
  type: string;
  severity: 'critical' | 'warning' | 'info' | 'ok';
  sample: string;
  count: number;
  urls: string[];
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

export function analyzePage(html: string, pageUrl: string): PageAnalysis {
  const origin = new URL(pageUrl).origin;
  const secure = new URL(pageUrl).protocol === 'https:';

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? decodeEntities(titleM[1]!.replace(/<[^>]+>/g, '')) : '';
  const hasMetaDesc = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(html);
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
  const hasCanonical = /<link[^>]+rel=["']?canonical["']?[^>]+href=/i.test(html);

  // obrázky bez alt
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const imagesNoAlt = imgs.filter((tag) => !/\balt\s*=\s*["'][^"']+["']/i.test(tag)).length;

  // interné odkazy (same-origin), absolútne, bez hash/mailto/tel
  const links = new Set<string>();
  const linkRe = /<a\b[^>]*href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const href = m[1]!.trim();
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const u = new URL(href, pageUrl);
      if (u.origin === origin) {
        u.hash = '';
        links.add(u.toString());
      }
    } catch {
      /* nevalidný href */
    }
  }

  // mixed content (na https stránke http:// zdroje)
  let mixedContent = 0;
  if (secure) {
    mixedContent = (html.match(/(?:src|href)=["']http:\/\/[^"']+["']/gi) ?? []).length;
  }

  return {
    url: pageUrl,
    hasTitle: title.length > 0,
    title,
    titleLen: title.length,
    hasMetaDesc,
    h1Count,
    hasCanonical,
    imagesNoAlt,
    internalLinks: [...links],
    mixedContent,
  };
}

export function buildSeoIssues(pages: PageAnalysis[], brokenLinks: { url: string; status: number }[]): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const short = (arr: Array<string | { url: string }>) =>
    arr.slice(0, 12).map((u) => {
      const s = typeof u === 'string' ? u : u.url;
      try {
        return new URL(s).pathname || '/';
      } catch {
        return s;
      }
    });

  const broken = brokenLinks.filter((b) => b.status >= 400 || b.status === 0);
  if (broken.length) issues.push({ type: 'Nefunkčné odkazy (4xx/5xx)', severity: 'critical', sample: short(broken.map((b) => b.url)).slice(0, 2).join(', '), count: broken.length, urls: broken.map((b) => `${new URL(b.url).pathname} → ${b.status || 'chyba'}`).slice(0, 20) });

  const noTitle = pages.filter((p) => !p.hasTitle);
  const noDesc = pages.filter((p) => !p.hasMetaDesc);
  const titleMeta = [...new Set([...noTitle, ...noDesc].map((p) => p.url))];
  if (titleMeta.length) issues.push({ type: 'Chýbajúci title / meta description', severity: 'warning', sample: short(titleMeta).slice(0, 3).join(', '), count: titleMeta.length, urls: short(titleMeta) });

  const dupTitles = (() => {
    const byTitle = new Map<string, string[]>();
    pages.filter((p) => p.hasTitle).forEach((p) => byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p.url]));
    return [...byTitle.values()].filter((v) => v.length > 1).flat();
  })();
  if (dupTitles.length) issues.push({ type: 'Duplicitný title', severity: 'warning', sample: `${dupTitles.length} stránok`, count: dupTitles.length, urls: short(dupTitles) });

  const altTotal = pages.reduce((n, p) => n + p.imagesNoAlt, 0);
  if (altTotal) issues.push({ type: 'Obrázky bez alt atribútu', severity: 'warning', sample: `${altTotal} obrázkov`, count: altTotal, urls: short(pages.filter((p) => p.imagesNoAlt > 0).map((p) => p.url)) });

  const h1Bad = pages.filter((p) => p.h1Count !== 1);
  if (h1Bad.length) issues.push({ type: 'Chýbajúci alebo viacnásobný H1', severity: 'warning', sample: short(h1Bad).slice(0, 3).join(', '), count: h1Bad.length, urls: h1Bad.map((p) => `${new URL(p.url).pathname} (${p.h1Count}× H1)`).slice(0, 12) });

  const noCanon = pages.filter((p) => !p.hasCanonical);
  if (noCanon.length) issues.push({ type: 'Chýbajúci canonical', severity: 'info', sample: short(noCanon).slice(0, 3).join(', '), count: noCanon.length, urls: short(noCanon) });

  const mixed = pages.filter((p) => p.mixedContent > 0);
  if (mixed.length) issues.push({ type: 'Mixed content (HTTP na HTTPS)', severity: 'critical', sample: short(mixed).slice(0, 2).join(', '), count: mixed.reduce((n, p) => n + p.mixedContent, 0), urls: short(mixed) });

  return issues;
}
