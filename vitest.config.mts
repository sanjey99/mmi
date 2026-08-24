import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/aiConfig.test.ts',
      'tests/aiKeyWriteOnlyPolicy.test.ts',
      'tests/integration/aiKeyContract.integration.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['supabase/functions/_shared/**/*.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
