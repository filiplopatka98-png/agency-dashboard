#!/usr/bin/env node
// Google Search Console collector — reálne clicks/impressions/CTR/pozícia + top dopyty.
//
//   node index.mjs --probe <url>   → vypíše pre jeden web (test, potrebuje GSC_SA_JSON)
//   node index.mjs                  → prejde aktívne weby zo Supabase
//
// Auth: service account (webmasters.readonly). GSC_SA_JSON = obsah JSON kľúča
//   (buď raw JSON, alebo base64). Service account email musí byť pridaný ako
//   používateľ v každej GSC property.
// Env: GSC_SA_JSON, (DB) SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createSign } from 'node:crypto';
import { gscPropertyCandidates, parseGscResponse } from '../../packages/core/dist/gsc.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const RANGE_DAYS = 28;
const LAG_DAYS = 3; // GSC dáta majú ~2-3 dňové oneskorenie

import { runJob } from '../_shared/runJob.mjs';

function restHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadServiceAccount() {
  const raw = process.env.GSC_SA_JSON;
  if (!raw) throw new Error('GSC_SA_JSON je povinný (obsah service-account JSON kľúča)');
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(text);
  if (!sa.client_email || !sa.private_key) throw new Error('GSC_SA_JSON: chýba client_email / private_key');
  return sa;
}

// Service account JWT → OAuth2 access token (bez externých knižníc).
async function getAccessToken(sa) {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URI, iat, exp: iat + 3600 }));
  const signingInput = `${header}.${claim}`;
  const signature = b64url(createSign('RSA-SHA256').update(signingInput).end().sign(sa.private_key));
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${JSON.stringify(body)}`);
  return body.access_token;
}

function dateRange() {
  const end = new Date(Date.now() - LAG_DAYS * 86_400_000);
  const start = new Date(end.getTime() - (RANGE_DAYS - 1) * 86_400_000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

async function queryProperty(token, property, dims, startDate, endDate, rowLimit) {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate, dimensions: dims, rowLimit }),
  });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

// Nájde prvú GSC property, ku ktorej má service account prístup, a vráti dáta.
export async function probeGsc(token, siteUrl) {
  const { startDate, endDate } = dateRange();
  const candidates = gscPropertyCandidates(siteUrl);
  for (const property of candidates) {
    const totals = await queryProperty(token, property, [], startDate, endDate, 1);
    if (totals.status === 403 || totals.status === 404) continue; // property/prístup neexistuje → skús ďalšiu
    if (!totals.ok) throw new Error(`GSC ${totals.status}: ${JSON.stringify(totals.body)}`);
    const queries = await queryProperty(token, property, ['query'], startDate, endDate, 25);
    const sum = parseGscResponse(totals.body.rows ?? [], queries.body.rows ?? [], 10);
    return { property, range_days: RANGE_DAYS, ...sum };
  }
  return null; // žiadna property nedostupná pre tento web
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--probe') {
    // Manuálny test jedného URL — nie je to scheduled beh, nezapisuje sa do job_runs.
    const sa = loadServiceAccount();
    const token = await getAccessToken(sa);
    const url = args[1];
    if (!url) throw new Error('usage: --probe <url>');
    const r = await probeGsc(token, url);
    console.log(JSON.stringify(r ?? { error: 'žiadna dostupná GSC property (pridaj service account ako používateľa)' }, null, 2));
    return;
  }

  await runJob('gsc', run);
}

async function run() {
  const sa = loadServiceAccount();
  const token = await getAccessToken(sa);

  const url = process.env.SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error('SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY sú povinné');

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,url&is_active=eq.true`, { headers: restHeaders(srv) });
  const sites = await sitesRes.json();
  const now = new Date().toISOString();
  let ok = 0;
  let missing = 0;
  let failed = 0;

  for (const s of sites) {
    let row;
    try {
      const r = await probeGsc(token, s.url);
      if (r) {
        row = {
          site_id: s.id,
          org_id: s.org_id,
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
          range_days: r.range_days,
          top_queries: r.topQueries,
          property: r.property,
          measured_at: now,
          error: null,
        };
        ok++;
        console.log(JSON.stringify({ ev: 'gsc.ok', url: s.url, property: r.property, clicks: r.clicks, impressions: r.impressions }));
      } else {
        row = { site_id: s.id, org_id: s.org_id, clicks: null, range_days: RANGE_DAYS, measured_at: now, error: 'no accessible GSC property' };
        missing++;
        console.log(JSON.stringify({ ev: 'gsc.missing', url: s.url }));
      }
    } catch (e) {
      row = { site_id: s.id, org_id: s.org_id, clicks: null, range_days: RANGE_DAYS, measured_at: now, error: String(e?.message ?? e) };
      failed++;
      console.log(JSON.stringify({ ev: 'gsc.fail', url: s.url, error: String(e?.message ?? e) }));
    }
    const up = await fetch(`${url}/rest/v1/gsc_snapshots?on_conflict=site_id`, {
      method: 'POST',
      headers: { ...restHeaders(srv), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!up.ok) console.log(JSON.stringify({ ev: 'gsc.upsert_fail', url: s.url, status: up.status, body: await up.text() }));
  }
  console.log(JSON.stringify({ ev: 'gsc.done', ok, missing, failed }));
  return { ok, failed };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
