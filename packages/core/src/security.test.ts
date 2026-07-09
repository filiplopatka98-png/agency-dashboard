import { describe, expect, it } from 'vitest';
import { scoreSecurityHeaders } from './security';

const getter = (map: Record<string, string>) => (name: string) => map[name.toLowerCase()];

describe('scoreSecurityHeaders', () => {
  it('všetky hlavičky → 100', () => {
    const r = scoreSecurityHeaders(
      getter({
        'strict-transport-security': 'max-age=63072000',
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'SAMEORIGIN',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'permissions-policy': 'geolocation=()',
      }),
    );
    expect(r.score).toBe(100);
    expect(r.headers.hsts).toBe(true);
    expect(r.headers.csp).toBe(true);
  });

  it('chýba CSP a HSTS → 50, správne flagy', () => {
    const r = scoreSecurityHeaders(
      getter({ 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin', 'permissions-policy': 'x=()' }),
    );
    expect(r.score).toBe(50);
    expect(r.headers.csp).toBe(false);
    expect(r.headers.hsts).toBe(false);
  });

  it('x-content-type-options bez nosniff sa neráta', () => {
    const r = scoreSecurityHeaders(getter({ 'x-content-type-options': 'nieco' }));
    expect(r.headers.xcto).toBe(false);
    expect(r.score).toBe(0);
  });
});
