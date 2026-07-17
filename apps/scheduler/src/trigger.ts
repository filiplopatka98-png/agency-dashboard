import type { Env } from './env';
import { serviceClient } from './supabase';

// Ručné spustenie collector jobu z UI. Bezpečnosť: over Supabase access-token
// (HS256 podpis + exp) → potom over cez service_role klienta, že `sub`
// (user id) je owner/staff membership v nejakej org (audit 6, "/trigger
// pustí hocijakého prihláseného" — `payload.role === 'authenticated'` je
// Supabase GLOBÁLNA auth rola, ktorú má KAŽDÝ prihlásený účet, nie appková
// rola owner/staff/client z `memberships`. Dnes má login len owner, takže
// diera je spiaca, ale read-only účet by inak vedel dispatchnúť všetkých 11
// GH workflow). Potom dispatchne GitHub workflow. GH token je serverový
// secret (nikdy v prehliadači).

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

// Overí Supabase JWT (HS256). Vráti payload alebo null.
async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  if (!h || !p || !sig) return null;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p))) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return payload;
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
  if (!env.GH_DISPATCH_TOKEN || !env.GH_REPO || !env.SUPABASE_JWT_SECRET) {
    return json({ error: 'Ručné spustenie nie je nakonfigurované (chýba GH token / JWT secret).' }, 503);
  }
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = token ? await verifyJwt(token, env.SUPABASE_JWT_SECRET) : null;
  if (!payload || payload.role !== 'authenticated' || typeof payload.sub !== 'string' || !payload.sub) {
    return json({ error: 'Neautorizované.' }, 401);
  }
  // `role: 'authenticated'` je len globálna Supabase auth rola (má ju hocikto
  // s platným loginom) — appková autorizácia (owner/staff smie dispatchovať,
  // client nie) žije v `memberships`, cez `sub` (user id). Zlyhanie dotazu
  // = fail closed (žiadny dispatch), nie fail open.
  if (!(await isOwnerOrStaff(env, payload.sub))) {
    return json({ error: 'Neautorizované.' }, 401);
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
