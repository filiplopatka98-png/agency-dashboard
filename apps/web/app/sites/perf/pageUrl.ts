// Validácia + normalizácia URL pridávanej stránky. Musí byť na rovnakej doméne
// ako web (sú to jeho podstránky). Normalizuje na https://<doména><path><query>,
// bez fragmentu, bez trailing slash (okrem roota). Čisté (testovateľné).
export type NormResult = { ok: true; url: string } | { ok: false; reason: string };

const stripWww = (h: string) => h.replace(/^www\./i, '');

export function normalizePageUrl(input: string, siteDomain: string): NormResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'Zadaj URL.' };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'Neplatná URL.' };
  }
  if (!u.hostname) return { ok: false, reason: 'Neplatná URL.' };
  const dom = stripWww(siteDomain);
  if (stripWww(u.hostname) !== dom) return { ok: false, reason: `URL musí byť na doméne ${siteDomain}.` };
  const path = u.pathname.replace(/\/+$/, '') || '/';
  return { ok: true, url: `https://${dom}${path}${u.search}` };
}
