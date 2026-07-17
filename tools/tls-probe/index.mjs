#!/usr/bin/env node
// Týždenný TLS probe (GitHub Action). Node má node:tls a vie prečítať peer
// certifikát — Worker to NEVIE (ani fetch, ani cloudflare:sockets). Toto je
// zdroj pravdy pre tls_certs.valid_to.
//
// Režimy:
//   node index.mjs --probe <host>   → vypíše cert (test, bez DB)
//   node index.mjs                  → načíta aktívne weby zo Supabase a zapíše tls_certs
//
// Env (pre DB režim): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import tls from 'node:tls';

const TIMEOUT_MS = 15_000;

export function probeTls(host) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(443, host, { servername: host, timeout: TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) return reject(new Error('no certificate'));
      resolve({
        issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null,
        valid_from: new Date(cert.valid_from).toISOString(),
        valid_to: new Date(cert.valid_to).toISOString(),
      });
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('timeout'));
    });
    socket.once('error', reject);
  });
}

import { runJob } from '../_shared/runJob.mjs';

function restHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

async function loadSites(url, key) {
  const res = await fetch(`${url}/rest/v1/sites?select=id,org_id,domain&is_active=eq.true`, {
    headers: restHeaders(key),
  });
  if (!res.ok) throw new Error(`load sites ${res.status}: ${await res.text()}`);
  return res.json();
}

async function upsertCert(url, key, row) {
  // merge-duplicates: stĺpce mimo payloadu sa NEprepíšu → pri chybe ostane starý valid_to.
  const res = await fetch(`${url}/rest/v1/tls_certs?on_conflict=site_id`, {
    method: 'POST',
    headers: { ...restHeaders(key), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`upsert ${res.status}: ${await res.text()}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--probe') {
    // Manuálny test jedného hostu — nie je to scheduled beh, nezapisuje sa do job_runs.
    const host = args[1];
    if (!host) throw new Error('usage: --probe <host>');
    console.log(JSON.stringify(await probeTls(host), null, 2));
    return;
  }

  await runJob('tls', run);
}

async function run() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sites = await loadSites(url, key);
  const now = new Date().toISOString();
  let ok = 0;
  let failed = 0;

  for (const s of sites) {
    try {
      const cert = await probeTls(s.domain);
      await upsertCert(url, key, {
        site_id: s.id,
        org_id: s.org_id,
        issuer: cert.issuer,
        valid_from: cert.valid_from,
        valid_to: cert.valid_to,
        source: 'probe',
        checked_at: now,
        error: null,
      });
      ok++;
      console.log(JSON.stringify({ ev: 'tls.ok', domain: s.domain, valid_to: cert.valid_to }));
    } catch (err) {
      // Neprepisuj dobrý valid_to chybou — valid_to v payloade vynechávame.
      await upsertCert(url, key, {
        site_id: s.id,
        org_id: s.org_id,
        source: 'probe',
        checked_at: now,
        error: String(err?.message ?? err),
      }).catch(() => {});
      failed++;
      console.log(JSON.stringify({ ev: 'tls.fail', domain: s.domain, error: String(err?.message ?? err) }));
    }
  }
  console.log(JSON.stringify({ ev: 'tls.done', ok, failed, total: sites.length }));
  return { ok, failed };
}

// Spusti main len keď je skript volaný priamo (nie pri importe v teste).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
