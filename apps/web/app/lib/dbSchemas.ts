// Validácia jsonb stĺpcov na hranici DB→prehliadač. Predtým sa čítali cez
// `as unknown as [...]` (slepý cast) — polovične zapísaný riadok (napr. z WP
// agenta so zdieľaným tokenom) by pri renderi hodil `undefined` prístup.
//
// Zámerne zhovievavé: pole validujeme PO KUSOCH a nevalidnú položku ZAHODÍME
// (nie celý riadok). Číselné polia koercujeme (string „9.8" → 9.8), nech
// legitímny riadok nevypadne kvôli typu. Bez zod (nie je to dep webu) —
// jednoduché type-guardy, nulová váha do bundlu.

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const bool = (v: unknown, fb = false): boolean => (typeof v === 'boolean' ? v : fb);
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown, fb = 0): number => numOrNull(v) ?? fb;

export type AeoCheck = { id: string; label: string; weight: number; earned: number; pass: boolean };
export type SeoIssue = { type: string; severity: string; sample: string; count: number; urls: string[] };
export type WpPlugin = { name: string; slug: string; version: string; active: boolean; update_version: string | null };
export type WpVuln = { target: string; slug: string; version: string; title: string; cve: string | null; fixed_in: string | null; cvss: number | null; severity: string };
export type SecurityHeaders = { hsts: boolean; csp: boolean; xframe: boolean; xcto: boolean; referrer: boolean; permissions: boolean };
export type GscTopQuery = { query: string; clicks: number; impressions: number; ctr: number; position: number };

// Každý parser vráti null, ak chýbajú kľúčové identifikačné polia → položka sa zahodí.
export const parseAeoCheck = (v: unknown): AeoCheck | null =>
  isObj(v) && typeof v.id === 'string'
    ? { id: v.id, label: str(v.label), weight: num(v.weight), earned: num(v.earned), pass: bool(v.pass) }
    : null;

export const parseSeoIssue = (v: unknown): SeoIssue | null =>
  isObj(v) && typeof v.type === 'string'
    ? { type: v.type, severity: str(v.severity, 'info'), sample: str(v.sample), count: num(v.count), urls: Array.isArray(v.urls) ? v.urls.filter((u): u is string => typeof u === 'string') : [] }
    : null;

export const parseWpPlugin = (v: unknown): WpPlugin | null =>
  isObj(v) && typeof v.name === 'string'
    ? { name: v.name, slug: str(v.slug), version: str(v.version), active: bool(v.active), update_version: strOrNull(v.update_version) }
    : null;

export const parseWpVuln = (v: unknown): WpVuln | null =>
  isObj(v) && typeof v.title === 'string'
    ? { target: str(v.target), slug: str(v.slug), version: str(v.version), title: v.title, cve: strOrNull(v.cve), fixed_in: strOrNull(v.fixed_in), cvss: numOrNull(v.cvss), severity: str(v.severity, 'unknown') }
    : null;

export const parseGscTopQuery = (v: unknown): GscTopQuery | null =>
  isObj(v) && typeof v.query === 'string'
    ? { query: v.query, clicks: num(v.clicks), impressions: num(v.impressions), ctr: num(v.ctr), position: num(v.position) }
    : null;

const DEFAULT_HEADERS: SecurityHeaders = { hsts: false, csp: false, xframe: false, xcto: false, referrer: false, permissions: false };
export const parseSecurityHeaders = (v: unknown): SecurityHeaders =>
  isObj(v)
    ? { hsts: bool(v.hsts), csp: bool(v.csp), xframe: bool(v.xframe), xcto: bool(v.xcto), referrer: bool(v.referrer), permissions: bool(v.permissions) }
    : DEFAULT_HEADERS;

/** Validuje pole po položkách, nevalidné zahodí (nie celé pole). */
export function parseItems<T>(parse: (v: unknown) => T | null, value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const v of value) {
    const r = parse(v);
    if (r !== null) out.push(r);
  }
  return out;
}
