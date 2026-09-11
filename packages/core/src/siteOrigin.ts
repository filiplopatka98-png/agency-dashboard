// Efektívny origin webu po redirecte homepage. `sites.domain` je uložená bez
// www, ale web môže kanonicky bežať na www.<domain> (apex 301 → www, napr.
// krivosik.sk). Sitemap URL aj odkazy sú potom na www origine a porovnanie s
// holým https://<domain> by ich všetky zahodilo (crawl len homepage). Collector
// preto najprv fetchne homepage (redirect: follow) a origin vezme z `res.url`.
//
// Prijme sa len ten istý web (apex ↔ www). Redirect na cudziu doménu, sieťová
// chyba alebo nevalidná URL → https://<domain>, ako doteraz.
export function resolveSiteOrigin(domain: string, finalUrl?: string | null): string {
  const fallback = `https://${domain}`;
  if (!finalUrl) return fallback;
  let final: URL;
  try {
    final = new URL(finalUrl);
  } catch {
    return fallback;
  }
  const bare = (host: string) => host.toLowerCase().replace(/^www\./, '');
  return bare(final.hostname) === bare(domain) ? final.origin : fallback;
}
