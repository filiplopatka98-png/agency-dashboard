#!/usr/bin/env node
// Generický infra collector — zvonku zistiteľné údaje pre KAŽDÝ web (nie len WP):
// hosting/CDN, server, X-Powered-By (PHP), TLS verzia, http→https, security.txt.
// Zdroj: DNS + TLS handshake + HTTP hlavičky + ip-api.com (bez API kľúča).
//
//   node index.mjs --probe <domena>   → vypíše (test, bez DB)
//   node index.mjs                     → prejde aktívne weby zo Supabase → infra_snapshots
//
// Env (DB režim): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import dns from 'node:dns/promises';
import tls from 'node:tls';
import { runJob } from '../_shared/runJob.mjs';

const UA = 'AgencyDashboard/1.0 (+https://dash.lopatka.sk)';
const T = 12_000;

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function resolveIp(host) {
  try {
    const a = await dns.resolve4(host);
    return a[0] ?? null;
  } catch {
    return null;
  }
}

async function ipHosting(ip) {
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,org,isp,as`, { signal: AbortSignal.timeout(10_000) });
    const j = await r.json();
    if (j.status !== 'success') return null;
    return j.org || j.isp || j.as || null;
  } catch {
    return null;
  }
}

function detectCdn(h) {
  const g = (n) => h.get(n) || '';
  const server = g('server').toLowerCase();
  if (g('cf-ray') || server.includes('cloudflare')) return 'Cloudflare';
  if (g('x-amz-cf-id')) return 'CloudFront';
  if (g('x-served-by') || g('x-fastly-request-id')) return 'Fastly';
  if (g('x-github-request-id') || server.includes('github')) return 'GitHub Pages';
  if (g('x-vercel-id')) return 'Vercel';
  if (g('x-nf-request-id') || server.includes('netlify')) return 'Netlify';
  return null;
}

function tlsVersion(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const p = socket.getProtocol();
      socket.end();
      resolve(p);
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

async function httpsRedirect(host) {
  try {
    const r = await fetch(`http://${host}/`, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA } });
    const loc = r.headers.get('location') || '';
    if (r.status >= 300 && r.status < 400) return loc.startsWith('https://');
    return false; // odpovedal 2xx cez http bez presmerovania
  } catch {
    return null;
  }
}

async function securityTxt(host) {
  for (const p of ['/.well-known/security.txt', '/security.txt']) {
    try {
      const r = await fetch(`https://${host}${p}`, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': UA } });
      if (r.ok && (r.headers.get('content-type') || '').includes('text/plain')) return true;
    } catch {
      /* skús ďalšiu cestu */
    }
  }
  return false;
}

export async function probeInfra(domain) {
  const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase();

  let server = null;
  let powered_by = null;
  let cdn = null;
  try {
    const res = await fetch(`https://${host}/`, { redirect: 'follow', signal: AbortSignal.timeout(T), headers: { 'User-Agent': UA } });
    server = res.headers.get('server');
    powered_by = res.headers.get('x-powered-by');
    cdn = detectCdn(res.headers);
  } catch {
    /* web nedostupný — ostatné (IP/TLS) sa aj tak skúsia */
  }

  const ip = await resolveIp(host);
  const [hosting, tls_version, https_redirect, security_txt] = await Promise.all([
    ip ? ipHosting(ip) : Promise.resolve(null),
    tlsVersion(host),
    httpsRedirect(host),
    securityTxt(host),
  ]);

  if (!ip && !server && !tls_version) throw new Error('web nedostupný / nerezolvoval');
  return { ip, hosting, cdn, server, powered_by, tls_version, https_redirect, security_txt };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--probe') {
    // Manuálny test jednej domény — nie je to scheduled beh, nezapisuje sa do job_runs.
    const d = args[1];
    if (!d) throw new Error('usage: --probe <domena>');
    console.log(JSON.stringify(await probeInfra(d), null, 2));
    return;
  }

  await runJob('infra', run);
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sites = await (await fetch(`${url}/rest/v1/sites?select=id,org_id,domain&is_active=eq.true`, { headers: restHeaders(srv) })).json();
  const now = new Date().toISOString();
  let ok = 0;
  let failed = 0;

  for (const s of sites) {
    let row;
    try {
      const r = await probeInfra(s.domain);
      row = { site_id: s.id, org_id: s.org_id, ...r, measured_at: now, error: null };
      ok++;
      console.log(JSON.stringify({ ev: 'infra.ok', domain: s.domain, hosting: r.hosting, server: r.server, tls: r.tls_version }));
    } catch (e) {
      // Nuluj VŠETKY merané polia — na rozdiel od tls-probe (kde chránený
      // `valid_to` je absolútny dátum expirácie, nie bodové meranie) sú
      // ip/hosting/cdn/server/tls_version/https_redirect/security_txt vždy
      // hodnoty z TOHTO behu. Bez explicitného nulovania by `merge-duplicates`
      // upsert ponechal staré hodnoty s čerstvým `measured_at` a null-guard v
      // data.ts (`inf.error && inf.ip === null && inf.server === null`) by
      // ostal mŕtvy kód po prvom úspešnom behu.
      row = {
        site_id: s.id, org_id: s.org_id,
        ip: null, hosting: null, cdn: null, server: null, powered_by: null,
        tls_version: null, https_redirect: null, security_txt: null,
        measured_at: now, error: String(e?.message ?? e),
      };
      failed++;
      console.log(JSON.stringify({ ev: 'infra.fail', domain: s.domain, error: String(e?.message ?? e) }));
    }
    const up = await fetch(`${url}/rest/v1/infra_snapshots?on_conflict=site_id`, {
      method: 'POST',
      headers: { ...restHeaders(srv), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!up.ok) console.log(JSON.stringify({ ev: 'infra.upsert_fail', domain: s.domain, status: up.status, body: await up.text() }));
  }
  console.log(JSON.stringify({ ev: 'infra.done', ok, failed }));
  return { ok, failed };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
