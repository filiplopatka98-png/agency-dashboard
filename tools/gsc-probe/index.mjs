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
import { isoWeek } from '../../packages/core/dist/proactive.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const RANGE_DAYS = 28;
const LAG_DAYS = 3; // GSC dáta majú ~2-3 dňové oneskorenie
// Prepad návštevnosti na ~nulu (možný deindex/penalta): predošlé impresie musia
// prekročiť FLOOR (ignoruj drobné/sezónne weby), aktuálne musia byť pod NEAR_ZERO.
const GSC_COLLAPSE_FLOOR = 100;
const GSC_COLLAPSE_NEAR_ZERO = 5;

import { runJob } from '../_shared/runJob.mjs';
import { raiseAlerts } from '../_shared/raiseAlert.mjs';

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
  let sawForbidden = false; // 403 = property v GSC existuje, ale prístup nám odobrali
  for (const property of candidates) {
    const totals = await queryProperty(token, property, [], startDate, endDate, 1);
    // ROZLÍŠENIE 403 vs 404: 403 = property JE nakonfigurovaná, len service
    // accountu odobrali prístup (= zlyhanie zberu). 404 = property v GSC vôbec
    // nie je (web ju nemá → legitímne preskočenie). Pri 403 skús ešte ďalších
    // kandidátov (možno funguje sc-domain:), ale zapamätaj si to.
    if (totals.status === 403) { sawForbidden = true; continue; }
    if (totals.status === 404) continue;
    if (!totals.ok) throw new Error(`GSC ${totals.status}: ${JSON.stringify(totals.body)}`);
    const queries = await queryProperty(token, property, ['query'], startDate, endDate, 25);
    const sum = parseGscResponse(totals.body.rows ?? [], queries.body.rows ?? [], 10);
    return { property, range_days: RANGE_DAYS, ...sum };
  }
  // Žiadny kandidát nevrátil dáta. Ak sme videli 403 → property existovala a
  // prístup nám odobrali = tvrdé zlyhanie (throw → zaráta sa do failed →
  // job_failed). Ak boli len 404 → web GSC property nemá → null (legit skip).
  if (sawForbidden) throw new Error('GSC_REVOKED: prístup k property odobraný (403)');
  return null;
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

  const sitesRes = await fetch(`${url}/rest/v1/sites?select=id,org_id,url,domain&is_active=eq.true`, { headers: restHeaders(srv) });
  const sites = await sitesRes.json();
  // Predošlé impresie PRED prepisom (gsc_snapshots je 1 riadok/web,
  // on_conflict=site_id) — potrebné na detekciu prepadu na ~nulu.
  const prevRows = await (await fetch(`${url}/rest/v1/gsc_snapshots?select=site_id,impressions`, { headers: restHeaders(srv) })).json();
  const prevImpr = new Map((Array.isArray(prevRows) ? prevRows : []).map((r) => [r.site_id, r.impressions]));
  const now = new Date().toISOString();
  const wk = isoWeek(new Date());
  let ok = 0;
  let missing = 0;
  let failed = 0;
  const alertRows = []; // prepad návštevnosti → e-mailová fronta (runAlerts)

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

        // Prepad na ~nulu (možný deindex/penalta): LEN keď predošlý snapshot
        // prekročil FLOOR (permanentne maličký/sezónny web tak nikdy nealertuje)
        // a aktuálne impresie sú pod NEAR_ZERO. Dedupe: 1× per web per ISO týždeň.
        const prev = prevImpr.get(s.id);
        if (typeof prev === 'number' && prev >= GSC_COLLAPSE_FLOOR && r.impressions < GSC_COLLAPSE_NEAR_ZERO) {
          const dom = s.domain ?? s.url ?? 'web';
          alertRows.push({
            org_id: s.org_id,
            site_id: s.id,
            type: 'gsc_collapse',
            severity: 'warning',
            title: `${dom}: prepad návštevnosti z Google`,
            body: `impresie ${prev} → ${r.impressions} — možný deindex / penalta, over v Search Console`,
            dedupe_key: `gsc_collapse:${s.id}:${wk}`,
          });
        }
      } else {
        row = { site_id: s.id, org_id: s.org_id, clicks: null, range_days: RANGE_DAYS, measured_at: now, error: 'no accessible GSC property' };
        missing++;
        console.log(JSON.stringify({ ev: 'gsc.missing', url: s.url }));
      }
    } catch (e) {
      const reason = String(e?.message ?? e);
      if (reason.startsWith('GSC_REVOKED')) {
        // Odobraný prístup k EXISTUJÚCEJ property = zlyhanie zberu (nie „web nemá
        // GSC"). Ráta sa do failed (→ status partial/error → job_failed e-mail) a
        // ZÁMERNE NEUPSERTUJEME: čerstvý measured_at s clicks=null by cez
        // computeFreshness vyzeral „dnes zmerané", hoci sme nič nezmerali — nechaj
        // staré dáta prirodzene zostarnúť (stale), nemaskuj ich.
        failed++;
        console.log(JSON.stringify({ ev: 'gsc.revoked', url: s.url }));
        continue; // preskoč upsert
      }
      row = { site_id: s.id, org_id: s.org_id, clicks: null, range_days: RANGE_DAYS, measured_at: now, error: reason };
      failed++;
      console.log(JSON.stringify({ ev: 'gsc.fail', url: s.url, error: reason }));
    }
    const up = await fetch(`${url}/rest/v1/gsc_snapshots?on_conflict=site_id`, {
      method: 'POST',
      headers: { ...restHeaders(srv), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!up.ok) console.log(JSON.stringify({ ev: 'gsc.upsert_fail', url: s.url, status: up.status, body: await up.text() }));
  }
  // Non-fatal insert, dedupe cez unique dedupe_key.
  await raiseAlerts(url, srv, alertRows, 'gsc.alerts_fail');
  console.log(JSON.stringify({ ev: 'gsc.done', ok, missing, failed, alerts: alertRows.length }));
  return { ok, failed };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
