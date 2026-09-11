import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

const importFixtureSuffix = '/tests/integration/candidateMmiStation.integration.test.ts';

class MutationFixtureSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((left, right) => {
      const leftPriority = left.moduleId.endsWith(importFixtureSuffix) ? 0 : 1;
      const rightPriority = right.moduleId.endsWith(importFixtureSuffix) ? 0 : 1;
      return leftPriority - rightPriority || left.moduleId.localeCompare(right.moduleId);
    });
  }
}

export default defineConfig({
  test: {
    fileParallelism: false,
    sequence: { sequencer: MutationFixtureSequencer },
    globalSetup: ['tests/integration/requireLocalMutationEnvironment.ts'],
    include: [
      'tests/integration/aiKeyContract.integration.test.ts',
      'tests/integration/candidateMmiStation.integration.test.ts',
      'tests/integration/mmiRubricScoringRetention.integration.test.ts',
      'tests/integration/mmiUniversityPractice.integration.test.ts',
      'tests/integration/adminMmiOperations.integration.test.ts',
    ],
  },
});
