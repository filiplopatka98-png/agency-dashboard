import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Acceptance kritérium fázy 1:
 * packages/core NESMIE importovať cloudflare:*, next/* ani node:*.
 * Vynucujeme to lint pravidlom (no-restricted-imports patterns).
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['cloudflare:*'], message: 'core musí byť runtime-agnostický — cloudflare:* patrí do apps/scheduler.' },
            { group: ['next', 'next/*'], message: 'core nesmie závisieť na Next.js.' },
            { group: ['node:*'], message: 'core musí byť runtime-agnostický — žiadne node:* buildiny.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
