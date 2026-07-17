import { describe, expect, it } from 'vitest';
import { verifyEs256 } from './trigger';

// Testujeme ČISTÚ overovaciu logiku (`verifyEs256`) so statickou JWKS sadou —
// bez sieťového fetchu (ten robí `verifyJwt`/`getJwks`, netriviálne mockovať
// v jednotkovom teste a nie je to, čo tu chceme overiť).

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

// Vygeneruje reálny ES256 (P-256) keypair cez Web Crypto a podpíše token.
// `kid` NIE JE produkčný — náhodný per-test reťazec, aby test fixture nikdy
// nevyzeral ako reálny Supabase JWKS kľúč.
async function makeEs256Keypair() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', kp.publicKey)) as JsonWebKey;
  return { privateKey: kp.privateKey, publicJwk: jwk };
}

async function signEs256(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: CryptoKey): Promise<string> {
  const h = b64urlJson(header);
  const p = b64urlJson(payload);
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data);
  const sig = b64url(new Uint8Array(sigBuf));
  return `${h}.${p}.${sig}`;
}

// HS256 podpis pomocou toho istého tajomstva, na simuláciu "starého" tokenu /
// regresie, ktorá spôsobila pôvodný bug (HS256 token by mal byť odmietnutý,
// nech je JWKS obsah akýkoľvek).
async function signHs256(header: Record<string, unknown>, payload: Record<string, unknown>, secret: string): Promise<string> {
  const h = b64urlJson(header);
  const p = b64urlJson(payload);
  const data = new TextEncoder().encode(`${h}.${p}`);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, data);
  const sig = b64url(new Uint8Array(sigBuf));
  return `${h}.${p}.${sig}`;
}

const TEST_KID = 'test-kid-not-production';
const now = () => Math.floor(Date.now() / 1000);

describe('verifyEs256', () => {
  it('platný ES256 token s korešpondujúcim kid → ok', async () => {
    const { privateKey, publicJwk } = await makeEs256Keypair();
    const jwks = [{ ...publicJwk, kid: TEST_KID }];
    const token = await signEs256(
      { alg: 'ES256', typ: 'JWT', kid: TEST_KID },
      { sub: 'user-1', role: 'authenticated', exp: now() + 3600, iat: now() },
      privateKey,
    );
    const result = await verifyEs256(token, jwks);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.payload.sub).toBe('user-1');
    }
  });

  it('alg: none → invalid (nikdy nedôveruj alg z tokenu)', async () => {
    const h = b64urlJson({ alg: 'none', typ: 'JWT', kid: TEST_KID });
    const p = b64urlJson({ sub: 'user-1', role: 'authenticated', exp: now() + 3600 });
    const token = `${h}.${p}.`;
    const result = await verifyEs256(token, [{ kty: 'EC', crv: 'P-256', kid: TEST_KID, x: 'a', y: 'b' }]);
    expect(result.status).toBe('invalid');
  });

  it('HS256 token (regresia pôvodného bugu) → invalid, aj keď JWKS obsahuje kid', async () => {
    const { publicJwk } = await makeEs256Keypair();
    const jwks = [{ ...publicJwk, kid: TEST_KID }];
    const token = await signHs256(
      { alg: 'HS256', typ: 'JWT', kid: TEST_KID },
      { sub: 'user-1', role: 'authenticated', exp: now() + 3600 },
      'hocijaky-secret',
    );
    const result = await verifyEs256(token, jwks);
    expect(result.status).toBe('invalid');
  });

  it('expirovaný token (exp v minulosti) → invalid', async () => {
    const { privateKey, publicJwk } = await makeEs256Keypair();
    const jwks = [{ ...publicJwk, kid: TEST_KID }];
    const token = await signEs256(
      { alg: 'ES256', typ: 'JWT', kid: TEST_KID },
      { sub: 'user-1', role: 'authenticated', exp: now() - 60, iat: now() - 3600 },
      privateKey,
    );
    const result = await verifyEs256(token, jwks);
    expect(result.status).toBe('invalid');
  });

  it('neznámy kid → unknown-kid (spúšťa refetch v verifyJwt, nie priamy reject)', async () => {
    const { privateKey, publicJwk } = await makeEs256Keypair();
    // JWKS obsahuje INÝ kid než token — simuluje rotáciu kľúčov.
    const jwks = [{ ...publicJwk, kid: 'iny-kid' }];
    const token = await signEs256(
      { alg: 'ES256', typ: 'JWT', kid: TEST_KID },
      { sub: 'user-1', role: 'authenticated', exp: now() + 3600 },
      privateKey,
    );
    const result = await verifyEs256(token, jwks);
    expect(result.status).toBe('unknown-kid');
  });

  it('podpis od iného kľúčového páru pre rovnaký kid → invalid (falošný podpis)', async () => {
    const legit = await makeEs256Keypair();
    const attacker = await makeEs256Keypair();
    // JWKS má LEGITÍMNY verejný kľúč pod TEST_KID, ale token podpísal útočník.
    const jwks = [{ ...legit.publicJwk, kid: TEST_KID }];
    const token = await signEs256(
      { alg: 'ES256', typ: 'JWT', kid: TEST_KID },
      { sub: 'user-1', role: 'authenticated', exp: now() + 3600 },
      attacker.privateKey,
    );
    const result = await verifyEs256(token, jwks);
    expect(result.status).toBe('invalid');
  });

  it('zle formovaný token (nie 3 časti) → invalid', async () => {
    const result = await verifyEs256('lebo.nie', []);
    expect(result.status).toBe('invalid');
  });
});
