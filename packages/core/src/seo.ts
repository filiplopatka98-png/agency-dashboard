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
  /** Stránka je vylúčená z indexovania (meta robots noindex alebo X-Robots-Tag). */
  noindex: boolean;
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

/**
 * @param xRobotsTag  hodnota HTTP hlavičky `X-Robots-Tag` (crawler ju dodá z
 *   odpovede) — noindex sa dá nastaviť aj hlavičkou, nielen meta tagom.
 */
export function analyzePage(html: string, pageUrl: string, xRobotsTag?: string): PageAnalysis {
  const origin = new URL(pageUrl).origin;
  const secure = new URL(pageUrl).protocol === 'https:';

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? decodeEntities(titleM[1]!.replace(/<[^>]+>/g, '')) : '';

  // Atribúty v HTML môžu byť v ľubovoľnom poradí (napr. `content` pred `name`),
  // preto meta/link/img vyhodnocujeme tag-po-tagu, nie jedným regexom s pevným
  // poradím — inak by validný CMS výstup padal ako „chýbajúci".
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  const hasAttr = (tag: string, name: string, value?: RegExp) => {
    const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
    const m = tag.match(re);
    if (!m) return false;
    return value ? value.test(m[1]!) : m[1]!.length > 0;
  };

  const hasMetaDesc = metaTags.some(
    (t) => /\bname\s*=\s*["']description["']/i.test(t) && hasAttr(t, 'content'),
  );
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
  const hasCanonical = linkTags.some(
    (t) => /\brel\s*=\s*["']?canonical["']?/i.test(t) && hasAttr(t, 'href'),
  );

  // noindex: meta robots (aj googlebot) obsahujúce `noindex`/`none`, alebo
  // X-Robots-Tag hlavička s tou istou hodnotou.
  const metaRobotsNoindex = metaTags.some(
    (t) => /\bname\s*=\s*["'](?:robots|googlebot)["']/i.test(t) && hasAttr(t, 'content', /\b(noindex|none)\b/i),
  );
  const headerNoindex = /\b(noindex|none)\b/i.test(xRobotsTag ?? '');
  const noindex = metaRobotsNoindex || headerNoindex;

  // obrázky bez alt — `alt=""` (dekoratívny obrázok, odporúčaný a11y zápis) je
  // VALIDNÝ, ráta sa len úplne chýbajúci `alt` atribút.
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const imagesNoAlt = imgs.filter((tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length;

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

  // mixed content = LEN subresource na http:// (img/script/iframe/audio/video/
  // source `src`, alebo `<link href>` = stylesheet/icon/preload). Obyčajný
  // `<a href="http://…">` (externý odkaz) NIE je mixed content — starý regex ho
  // falošne rátal a hlásil critical za jediný HTTP odkaz.
  let mixedContent = 0;
  if (secure) {
    const srcHttp = (html.match(/\bsrc\s*=\s*["']http:\/\/[^"']+["']/gi) ?? []).length;
    const linkHttp = (html.match(/<link\b[^>]*\bhref\s*=\s*["']http:\/\/[^"']+["']/gi) ?? []).length;
    mixedContent = srcHttp + linkHttp;
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
    noindex,
  };
}

/** Klasifikácia HTTP stavu odkazu ako „nefunkčný". */
export function isBrokenStatus(status: number): boolean {
  // 401/403/429 = auth / anti-bot / rate-limit — nie je to rozbitý odkaz, len
  // nás server odmietol. Rátať ich ako broken = falošné criticaly v reporte.
  if (status === 401 || status === 403 || status === 429) return false;
  return status === 0 || status >= 400;
}

/** Vytiahne `<loc>` URL zo sitemap XML (urlset aj sitemapindex). */
export function parseSitemapUrls(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const u = decodeEntities(m[1]!);
    if (/^https?:\/\//i.test(u)) out.push(u);
  }
  return out;
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

  const broken = brokenLinks.filter((b) => isBrokenStatus(b.status));
  if (broken.length) issues.push({ type: 'Nefunkčné odkazy (4xx/5xx)', severity: 'critical', sample: short(broken.map((b) => b.url)).slice(0, 2).join(', '), count: broken.length, urls: broken.map((b) => `${new URL(b.url).pathname} → ${b.status || 'chyba'}`).slice(0, 20) });

  // noindex je najzávažnejšia SEO chyba (stránka vypadne z Googlu) — samostatné
  // critical issue, nech ho vidno v podklade pre klienta.
  const noindexed = pages.filter((p) => p.noindex);
  if (noindexed.length) issues.push({ type: 'Stránka s noindex (vylúčená z Googlu)', severity: 'critical', sample: short(noindexed).slice(0, 3).join(', '), count: noindexed.length, urls: short(noindexed) });

  // title a meta description sú ROZDELENÉ — chýbajúci <title> (vážne) sa predtým
  // strácal v generickom warningu spolu s chýbajúcim popisom (drobnosť).
  const noTitle = pages.filter((p) => !p.hasTitle);
  if (noTitle.length) issues.push({ type: 'Chýbajúci title', severity: 'warning', sample: short(noTitle.map((p) => p.url)).slice(0, 3).join(', '), count: noTitle.length, urls: short(noTitle.map((p) => p.url)) });

  const noDesc = pages.filter((p) => !p.hasMetaDesc);
  if (noDesc.length) issues.push({ type: 'Chýbajúca meta description', severity: 'info', sample: short(noDesc.map((p) => p.url)).slice(0, 3).join(', '), count: noDesc.length, urls: short(noDesc.map((p) => p.url)) });

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
