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
