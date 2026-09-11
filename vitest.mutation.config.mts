import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ['tests/integration/requireLocalMutationEnvironment.ts'],
    include: [
      'tests/integration/aiKeyContract.integration.test.ts',
      'tests/integration/candidateMmiStation.integration.test.ts',
      'tests/integration/mmiRubricScoringRetention.integration.test.ts',
      'tests/integration/mmiUniversityPractice.integration.test.ts',
    ],
  },
});
