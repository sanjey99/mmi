import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/aiConfig.test.ts',
      'tests/aiProviderSecurity.test.ts',
      'tests/aiKeyWriteOnlyPolicy.test.ts',
      'tests/edgeHttp.test.ts',
      'tests/scoringCoverage.test.ts',
      'tests/integration/aiKeyContract.integration.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['supabase/functions/_shared/**/*.ts'],
      exclude: [
        'supabase/functions/_shared/mmiContracts.ts',
        'supabase/functions/_shared/mmiScoringContract.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
