import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/aiConfig.test.ts',
      'tests/aiProviderSecurity.test.ts',
      'tests/aiKeyWriteOnlyPolicy.test.ts',
      'tests/edgeHttp.test.ts',
      'tests/uiContracts.test.ts',
      'tests/navigation.test.ts',
      'tests/authStorage.test.ts',
      'tests/authStore.test.ts',
      'tests/questions.test.ts',
      'tests/practiceRestoration.test.ts',
      'tests/practiceSubmission.test.ts',
      'tests/questionValidation.test.ts',
      'tests/questionCsv.test.ts',
      'tests/integration/aiKeyContract.integration.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'supabase/functions/_shared/**/*.ts',
        'src/theme/designTokens.ts',
        'src/navigation/tabConfig.ts',
        'src/lib/navigation.ts',
        'src/lib/authStorageCore.ts',
        'src/stores/authStore.ts',
        'src/features/questions/selection.ts',
        'src/features/practice/restoration.ts',
        'src/features/practice/submission.ts',
        'src/features/questions/validation.ts',
        'src/features/questions/csv.ts',
      ],
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
