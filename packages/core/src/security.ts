/**
 * Security — skóre bezpečnostných hlavičiek (čistá funkcia) + Google Safe Browsing.
 * Vuln/CVE (plugin × CVE) je samostatné (WPScan) — tu nie je.
 */

export interface SecurityHeaders {
  hsts: boolean;
  csp: boolean;
  xframe: boolean;
  xcto: boolean;
  referrer: boolean;
  permissions: boolean;
}

const HEADER_WEIGHTS: Record<keyof SecurityHeaders, number> = {
  hsts: 25,
  csp: 25,
  xframe: 15,
  xcto: 15,
  referrer: 10,
  permissions: 10,
};

/** Skóre 0..100 z HTTP hlavičiek. `get` = case-insensitive getter (napr. Headers.get). */
export function scoreSecurityHeaders(get: (name: string) => string | null | undefined): {
  score: number;
  headers: SecurityHeaders;
} {
  const has = (n: string) => Boolean(get(n));
  const headers: SecurityHeaders = {
    hsts: has('strict-transport-security'),
    csp: has('content-security-policy'),
    xframe: has('x-frame-options'),
    xcto: (get('x-content-type-options') ?? '').toLowerCase().includes('nosniff'),
    referrer: has('referrer-policy'),
    permissions: has('permissions-policy'),
  };
  const score = (Object.keys(HEADER_WEIGHTS) as (keyof SecurityHeaders)[]).reduce(
    (n, k) => n + (headers[k] ? HEADER_WEIGHTS[k] : 0),
    0,
  );
  return { score, headers };
}

/** Google Safe Browsing v4 — vráti clean:true (žiadny nález) / false (nález). */
export async function fetchSafeBrowsing(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: true; clean: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        client: { clientId: 'agency-dashboard', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }),
    });
    if (!res.ok) return { ok: false, error: `safebrowsing ${res.status}` };
    const json = (await res.json()) as { matches?: unknown[] };
    return { ok: true, clean: !(json.matches && json.matches.length > 0) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
