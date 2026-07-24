import type { Env } from './env';
import { serviceClient } from './supabase';

// Ručné spustenie collector jobu z UI. Bezpečnosť: over Supabase access-token
// (ES256 podpis cez JWKS + exp) → potom over cez service_role klienta, že
// `sub` (user id) je owner/staff membership v nejakej org (audit 6, "/trigger
// pustí hocijakého prihláseného" — `payload.role === 'authenticated'` je
// Supabase GLOBÁLNA auth rola, ktorú má KAŽDÝ prihlásený účet, nie appková
// rola owner/staff/client z `memberships`. Dnes má login len owner, takže
// diera je spiaca, ale read-only účet by inak vedel dispatchnúť všetkých 11
// GH workflow). Potom dispatchne GitHub workflow. GH token je serverový
// secret (nikdy v prehliadači).
//
// Supabase projekt prešiel na asymetrické JWT signing keys (ES256 cez JWKS),
// preto sa access-tokeny NEDAJÚ overiť ako HS256 zdieľaným secretom — starý
// kód overoval nesprávny algoritmus (fungoval len s ručne podpísaným HS256
// tokenom, nikdy s reálnym Supabase tokenom → "Spustiť" v produkcii vždy
// vrátilo 401).

// job kľúč → workflow súbor. Scheduler beží na Worker cron → nedispatchovateľný.
const WORKFLOWS: Record<string, string> = {
  psi: 'psi-probe.yml',
  tls: 'tls-probe.yml',
  security: 'security-probe.yml',
  aeo: 'aeo-probe.yml',
  gsc: 'gsc-probe.yml',
  seo: 'seo-crawl.yml',
  infra: 'infra-probe.yml',
  cve: 'wp-cve.yml',
  history: 'history.yml',
  digest: 'digest.yml',
  report: 'report.yml',
  'asset-check': 'asset-check.yml',
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// JWKS cache v module scope (Workers znovupoužívajú izolát medzi requestmi,
// kým beží). TTL 10 minút: dosť dlho aby "Spustiť" (nízkofrekventovaný admin
// klik) nefetchovalo JWKS pri každom requeste, dosť krátko aby rotácia
// signing keys na strane Supabase nezostala zamrznutá donekonečna. Neznámy
// `kid` navyše vynúti jednorazový okamžitý refetch (pozri `verifyJwt`) —
// TTL cache tak nie je jediná obrana proti rotácii.
const JWKS_TTL_MS = 10 * 60 * 1000;

interface Jwk extends JsonWebKey {
  kid?: string;
}

interface JwksCache {
  keys: Jwk[];
  fetchedAt: number;
}

let jwksCache: JwksCache | null = null;

async function fetchJwks(env: Env): Promise<Jwk[]> {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`JWKS fetch zlyhal (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  return body.keys ?? [];
}

// `forceRefresh` sa použije LEN pri neznámom `kid` (možná rotácia kľúčov) —
// nikdy pri bežnom volaní, aby neznámy kid nešiel zneužiť ako fetch-per-request
// DoS páka (viď `verifyJwt`, ktorý refetchuje najviac raz na verifikáciu).
async function getJwks(env: Env, forceRefresh = false): Promise<Jwk[]> {
  const now = Date.now();
  if (!forceRefresh && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const keys = await fetchJwks(env);
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

type JwtCheck =
  | { status: 'ok'; payload: Record<string, unknown> }
  | { status: 'unknown-kid' }
  | { status: 'invalid' };

// Čistá overovacia logika (bez fetchu) — testovateľná so statickou JWKS sadou.
// Overuje ES256 podpis cez Web Crypto (ECDSA/P-256). JWS ES256 podpis je
// surová r||s (64 bajtov) forma, presne to, čo `crypto.subtle.verify` s
// ECDSA čaká — netreba DER konverziu.
export async function verifyEs256(token: string, jwks: Jwk[]): Promise<JwtCheck> {
  const parts = token.split('.');
  if (parts.length !== 3) return { status: 'invalid' };
  const [h, p, sig] = parts;
  if (!h || !p || !sig) return { status: 'invalid' };

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h))) as Record<string, unknown>;
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as Record<string, unknown>;
  } catch {
    return { status: 'invalid' };
  }

  // Nikdy nedôveruj `alg` z tokenu na VOĽBU overovacej cesty — tu ho len
  // porovnávame s presne jednou povolenou hodnotou. Odmieta HS256 (algorithm
  // confusion — token podpísaný verejným JWKS materiálom ako HMAC kľúčom) aj
  // `none` aj čokoľvek iné.
  if (header.alg !== 'ES256') return { status: 'invalid' };

  const kid = typeof header.kid === 'string' ? header.kid : '';
  const jwk = jwks.find((k) => k.kid === kid);
  if (!jwk) return { status: 'unknown-kid' };

  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return { status: 'invalid' };
  } catch {
    // Fail closed: zlý JWK tvar, nepodporovaná krivka, čokoľvek — reject.
    return { status: 'invalid' };
  }

  const now = Date.now() / 1000;
  if (typeof payload.exp === 'number' && payload.exp < now) return { status: 'invalid' };
  if (typeof payload.nbf === 'number' && payload.nbf > now) return { status: 'invalid' };
  // Malá tolerancia (60s) na drift hodín — token vydaný "v budúcnosti" o viac
  // než to je podozrivý.
  if (typeof payload.iat === 'number' && payload.iat > now + 60) return { status: 'invalid' };

  return { status: 'ok', payload };
}

// Overí Supabase JWT (ES256 cez JWKS). Vráti payload alebo null. Zlyhanie
// akéhokoľvek druhu (sieť, parse, podpis, expirácia) = fail closed.
async function verifyJwt(token: string, env: Env): Promise<Record<string, unknown> | null> {
  try {
    const jwks = await getJwks(env);
    let result = await verifyEs256(token, jwks);
    if (result.status === 'unknown-kid') {
      // Kľúč mohol rotovať — refetchni JWKS PRESNE raz (nie pri každom
      // requeste), potom over znova. Ak stále neznámy kid, reject.
      const fresh = await getJwks(env, true);
      result = await verifyEs256(token, fresh);
    }
    return result.status === 'ok' ? result.payload : null;
  } catch {
    return null;
  }
}

// Fail closed: akékoľvek zlyhanie dotazu (sieť, chýbajúci service-role kľúč,
// neočakávaná výnimka) vráti `false` — neautorizované, nie "predpokladaj OK".
async function isOwnerOrStaff(env: Env, userId: string): Promise<boolean> {
  try {
    const { data, error } = await serviceClient(env)
      .from('memberships')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['owner', 'staff'])
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return data !== null;
  } catch {
    return false;
  }
}

export async function triggerJob(request: Request, env: Env): Promise<Response> {
  if (!env.GH_DISPATCH_TOKEN || !env.GH_REPO) {
    return json({ error: 'Ručné spustenie nie je nakonfigurované (chýba GH token / repo).' }, 503);
  }
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = token ? await verifyJwt(token, env) : null;
  if (!payload || payload.role !== 'authenticated' || typeof payload.sub !== 'string' || !payload.sub) {
    // Odlíšené od chýbajúcej owner/staff role nižšie — tento diagnostický
    // detail bol dôvod, prečo bol HS256/ES256 bug ťažké odhaliť (oba prípady
    // vracali identické "Neautorizované."). Nástroj má jedného operátora,
    // diagnostická hodnota prevažuje nad marginálnym info-leakom.
    return json({ error: 'Neplatný alebo expirovaný token.' }, 401);
  }
  // `role: 'authenticated'` je len globálna Supabase auth rola (má ju hocikto
  // s platným loginom) — appková autorizácia (owner/staff smie dispatchovať,
  // client nie) žije v `memberships`, cez `sub` (user id). Zlyhanie dotazu
  // = fail closed (žiadny dispatch), nie fail open.
  if (!(await isOwnerOrStaff(env, payload.sub))) {
    return json({ error: 'Účet nemá owner/staff oprávnenie.' }, 401);
  }

  let job = '';
  try {
    job = (((await request.json()) as { job?: string })?.job ?? '').trim();
  } catch {
    /* ignore */
  }
  const workflow = WORKFLOWS[job];
  if (!workflow) return json({ error: `Neznámy job: ${job}` }, 400);

  const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Monitorix-Trigger',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (res.status === 204) {
    console.log(JSON.stringify({ ev: 'trigger.ok', job, sub: payload.sub }));
    return json({ ok: true, job }, 200);
  }
  const body = await res.text();
  console.log(JSON.stringify({ ev: 'trigger.fail', job, status: res.status, body: body.slice(0, 200) }));
  return json({ error: `GitHub dispatch zlyhal (${res.status}).` }, 502);
}
