import type { DomainSource } from '@agency/shared';

export interface DomainInfo {
  expiresAt: string | null; // 'YYYY-MM-DD'
  registrar: string | null;
  nameservers: string[];
  source: DomainSource;
  error?: string;
}

/**
 * Ktorý zdroj použiť pre expiráciu domény.
 *  - .sk → whois:43 (SK-NIC nemá RDAP). Väčšina Filipových webov.
 *  - .eu/.com/.cz/.online/.fr/.ie → rdap.org
 *  - inak → skús rdap, pri 404 unsupported (rieši fetchRdapDomain)
 */
const RDAP_TLDS = new Set(['eu', 'com', 'cz', 'online', 'fr', 'ie', 'net', 'org', 'io', 'dev']);

export function pickDomainStrategy(domain: string): DomainSource {
  const tld = domain.trim().toLowerCase().split('.').pop() ?? '';
  if (tld === 'sk') return 'whois43';
  if (RDAP_TLDS.has(tld)) return 'rdap';
  return 'rdap'; // pokus; fetchRdapDomain zmení na 'unsupported' pri 404
}

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown;
}
interface RdapResponse {
  events?: RdapEvent[];
  entities?: RdapEntity[];
  nameservers?: { ldhName?: string }[];
}

function registrarFromEntities(entities: RdapEntity[] | undefined): string | null {
  const reg = entities?.find((e) => e.roles?.includes('registrar'));
  const vcard = reg?.vcardArray;
  // vcardArray = ['vcard', [ [name, {}, type, value], ... ]]
  if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
    const fn = (vcard[1] as unknown[]).find(
      (f): f is unknown[] => Array.isArray(f) && f[0] === 'fn',
    );
    if (fn && typeof fn[3] === 'string') return fn[3];
  }
  return null;
}

/** Parsuje RDAP JSON odpoveď. Čistá funkcia. */
export function parseRdapExpiry(json: RdapResponse): Omit<DomainInfo, 'source'> {
  const exp = json.events?.find((e) => e.eventAction === 'expiration')?.eventDate;
  return {
    expiresAt: exp ? exp.slice(0, 10) : null,
    registrar: registrarFromEntities(json.entities),
    nameservers: (json.nameservers ?? [])
      .map((n) => n.ldhName?.toLowerCase())
      .filter((n): n is string => Boolean(n)),
  };
}

/**
 * Parsuje surový WHOIS:43 výstup SK-NIC. Hľadá riadok `Valid Until:`.
 * Fetcher (socket) žije v scheduleri; parser je tu a je unit-testovaný.
 */
export function parseWhoisSk(raw: string): { expiresAt: string | null; registrar: string | null } {
  const expMatch = raw.match(/valid until:\s*(\d{4}-\d{2}-\d{2})/i);
  const regMatch = raw.match(/registrar:\s*(.+)/i);
  return {
    expiresAt: expMatch ? expMatch[1]! : null,
    registrar: regMatch ? regMatch[1]!.trim() : null,
  };
}

/**
 * RDAP fetch + parse (čisto HTTP → môže byť v core). fetch je injektovateľný.
 * 404 → source 'unsupported' (doména bez RDAP), inú chybu vráti v error.
 */
export async function fetchRdapDomain(
  domain: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DomainInfo> {
  const empty: DomainInfo = { expiresAt: null, registrar: null, nameservers: [], source: 'rdap' };
  try {
    const res = await fetchImpl(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'AgencyDashboard/1.0 (+https://dash.lopatka.sk)' },
    });
    if (res.status === 404) return { ...empty, source: 'unsupported', error: 'no rdap (404)' };
    if (!res.ok) return { ...empty, error: `rdap ${res.status}` };
    const json = (await res.json()) as RdapResponse;
    return { ...parseRdapExpiry(json), source: 'rdap' };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}
