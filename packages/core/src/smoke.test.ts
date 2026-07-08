import { describe, expect, it } from 'vitest';
import { checkResultSchema } from '@agency/shared';

describe('scaffold smoke', () => {
  it('shared schémy sú importovateľné z core', () => {
    const parsed = checkResultSchema.parse({
      siteId: '00000000-0000-0000-0000-000000000000',
      ok: true,
    });
    expect(parsed.ok).toBe(true);
  });
});
