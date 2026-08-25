import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/integration/requireLocalMutationEnvironment.ts'],
    include: ['tests/integration/aiKeyContract.integration.test.ts'],
  },
});
