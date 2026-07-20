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
import { raiseAlerts } from '../_shared/raiseAlert.mjs';

// Kódy chýb (Node TLS + OpenSSL X509_V_ERR_* verify kódy), ktoré sú SKUTOČNÝM
// faktom o certifikáte — teda cert je naozaj zlý. LEN tieto smú vyrobiť
// tls_invalid alert. Zdroj: openssl verify error kódy + Node ERR_TLS_*.
const CERT_INVALID_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REVOKED',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID', // nezhoda hostname (SAN)
  'HOSTNAME_MISMATCH',
]);

// True LEN keď chyba JEDNOZNAČNE hovorí, že certifikát je neplatný. Všetko
// ostatné — timeout (15 s), DNS (ENOTFOUND/EAI_AGAIN), odmietnuté/resetnuté
// spojenie (ECONNREFUSED/ECONNRESET/EHOSTUNREACH), „no certificate", neznáme —
// je problém DOSTUPNOSTI, nie neplatnosti certu → NEALERTUJEME (zero-fabrication:
// netvrdíme neplatnosť, ktorú sme nepozorovali). Nedostupný web pokrýva uptime;
// reálne expirovaný/rozbitý cert sa navyše ohlási cez valid_to (expiry pg_cron).
// Pri nejednoznačnej chybe volíme fail-safe: NEalertovať.
function isCertInvalidError(err) {
  return typeof err?.code === 'string' && CERT_INVALID_CODES.has(err.code);
}

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
  const today = now.slice(0, 10); // YYYY-MM-DD pre dedupe (1× per web per deň)
  let ok = 0;
  let failed = 0;
  const alertRows = []; // neplatné certifikáty → e-mailová fronta (runAlerts)

  for (const s of sites) {
    try {
      const cert = await probeTls(s.domain);
      // Úspešný handshake ešte neznamená platný cert — cert už mohol expirovať
      // (napr. revoked reťazec prejde, ale valid_to je v minulosti). Ak je
      // valid_to v minulosti, hlás to hneď (expiry pg_cron beží nezávisle).
      const expired = Date.parse(cert.valid_to) < Date.now();
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
      if (expired) {
        alertRows.push({
          org_id: s.org_id,
          site_id: s.id,
          type: 'tls_invalid',
          severity: 'critical',
          title: `${s.domain}: TLS certifikát neplatný`,
          body: `certifikát expiroval (valid_to ${cert.valid_to})`,
          dedupe_key: `tls_invalid:${s.id}:${today}`,
        });
      }
    } catch (err) {
      const reason = String(err?.message ?? err);
      // Neprepisuj dobrý valid_to chybou — valid_to v payloade vynechávame.
      await upsertCert(url, key, {
        site_id: s.id,
        org_id: s.org_id,
        source: 'probe',
        checked_at: now,
        error: reason,
      }).catch(() => {});
      failed++;
      console.log(JSON.stringify({ ev: 'tls.fail', domain: s.domain, error: reason }));
      // tls_invalid LEN pri chybe, ktorá je faktom o certifikáte (expirovaný /
      // revoked / rozbitý reťazec / self-signed / nezhoda hostname). Sieťový blip
      // (timeout, DNS, refused) NESMIE vyrobiť kritický „cert neplatný" e-mail —
      // to by bola fabrikácia (cert je v poriadku, len nedostupný). Bez tohto by
      // expiry pg_cron (číta len valid_to) reálne zlý cert neohlásil.
      if (isCertInvalidError(err)) {
        alertRows.push({
          org_id: s.org_id,
          site_id: s.id,
          type: 'tls_invalid',
          severity: 'critical',
          title: `${s.domain}: TLS certifikát neplatný`,
          body: reason,
          dedupe_key: `tls_invalid:${s.id}:${today}`,
        });
      } else {
        console.log(JSON.stringify({ ev: 'tls.unreachable', domain: s.domain, code: err?.code ?? null }));
      }
    }
  }
  // Non-fatal insert, dedupe cez unique dedupe_key (1× per web per deň).
  await raiseAlerts(url, key, alertRows, 'tls.alerts_fail');
  console.log(JSON.stringify({ ev: 'tls.done', ok, failed, total: sites.length, alerts: alertRows.length }));
  return { ok, failed };
}

// Spusti main len keď je skript volaný priamo (nie pri importe v teste).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
