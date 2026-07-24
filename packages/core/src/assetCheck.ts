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
      out.push(new URL(m[1]!, baseUrl).href);
    } catch {
      /* neplatné URL — vynechaj */
    }
  }
  return [...new Set(out)];
}

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
    const hrefs = [...fragment.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!);
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
      const norm = abs.split('#')[0]!.replace(/\/$/, '');
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

export type AssetVerdict = 'ok' | 'broken' | 'unknown';

// `status: null` = NAŠA sieťová chyba/timeout, nie fakt o webe → `unknown`
// (nikdy nehlásime ako broken; collector to skúsi znova a ak stále unknown,
// preskočí — zero-fabrication).
//
// `broken` je LEN definitívny signál „súbor je preukázateľne preč": 404/410 —
// presne to, čo Elementor spraví keď prečísluje/zmaže vygenerovaný CSS a
// zacachovaná HTML naň stále odkazuje. VŠETKO ostatné je `unknown`, NIE broken:
//   - 2xx (súbor sa NAČÍTA — vrátane prázdneho 0-bajtového; prázdny CSS je
//     bežný a legitímny: LiteSpeed inlinuje kritické CSS a kombinovaný súbor
//     nechá prázdny, pluginy dodávajú placeholder CSS. Overené na reálnych
//     weboch — 0-bajt dával falošné poplachy. Symptóm „nenačíta sa" je 404,
//     nie prázdny 200; režim „200 ale prázdne/staré" je vedome mimo rozsah.)
//   - 403/406/… (WAF alebo server nepriateľský voči HEAD — súbor sa reálne
//     servíruje na GET),
//   - 429 (rate-limit — naša chyba tempa, nie fakt o webe),
//   - 5xx (prechodná serverová chyba — self-heal),
//   - 3xx (nenasledovaný redirect).
// Tým sa nikdy neposkytne falošný poplach z prechodného/dvojznačného stavu —
// collector `unknown` GET-om overí a ak stále nie je definitívne preč, preskočí.
export function classifyAsset(status: number | null): AssetVerdict {
  if (status === null) return 'unknown';
  if (status === 404 || status === 410) return 'broken';
  if (status >= 200 && status < 300) return 'ok';
  return 'unknown'; // iné 4xx (403/429/…), 5xx, 3xx, 1xx — neistý stav, nehlásime
}
