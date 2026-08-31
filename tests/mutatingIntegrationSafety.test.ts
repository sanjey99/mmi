import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canRunLocalProfileElevationTests,
  canRunLocalMutationTests,
  requireLocalProfileElevationTests,
  requireLocalMutationTests,
} from './integration/mutationTestSafety';

describe('credential-gated mutation test safety', () => {
  it('requires an explicit opt-in and a loopback Supabase URL', () => {
    const credentials = {
      SUPABASE_TEST_ANON_KEY: 'anon',
      SUPABASE_TEST_SERVICE_ROLE_KEY: 'service',
    };

    expect(canRunLocalMutationTests({
      ...credentials,
      SUPABASE_TEST_URL: 'https://production-ref.supabase.co',
      SUPABASE_LOCAL_MUTATION_TESTS: 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA',
    })).toBe(false);
    expect(canRunLocalMutationTests({
      ...credentials,
      SUPABASE_TEST_URL: 'http://127.0.0.1:54321',
    })).toBe(false);
    expect(canRunLocalMutationTests({
      ...credentials,
      SUPABASE_TEST_URL: 'http://127.0.0.1:54321',
      SUPABASE_LOCAL_MUTATION_TESTS: 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA',
    })).toBe(true);
  });

  it('keeps the mutating contract out of the default Vitest include list', async () => {
    const config = await readFile(join(process.cwd(), 'vitest.config.mts'), 'utf8');
    expect(config).not.toContain("'tests/integration/aiKeyContract.integration.test.ts'");
  });

  it('fails the dedicated gate instead of reporting skipped mutation tests as green', () => {
    expect(() => requireLocalMutationTests({})).toThrow(/local mutation integration prerequisites/i);
    expect(() => requireLocalMutationTests({
      SUPABASE_TEST_URL: 'https://shared.supabase.co',
      SUPABASE_TEST_ANON_KEY: 'anon',
      SUPABASE_TEST_SERVICE_ROLE_KEY: 'service',
      SUPABASE_LOCAL_MUTATION_TESTS: 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA',
    })).toThrow(/local mutation integration prerequisites/i);
  });

  it('requires a loopback PostgreSQL URL before local profile elevation can run', () => {
    const localApiEnvironment = {
      SUPABASE_TEST_URL: 'http://127.0.0.1:54321',
      SUPABASE_TEST_ANON_KEY: 'anon',
      SUPABASE_TEST_SERVICE_ROLE_KEY: 'service',
      SUPABASE_LOCAL_MUTATION_TESTS: 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA',
    };

    expect(canRunLocalProfileElevationTests(localApiEnvironment)).toBe(false);
    expect(canRunLocalProfileElevationTests({
      ...localApiEnvironment,
      SUPABASE_TEST_DB_URL: 'postgresql://postgres:postgres@shared.example.test:5432/postgres',
    })).toBe(false);
    expect(canRunLocalProfileElevationTests({
      ...localApiEnvironment,
      SUPABASE_TEST_DB_URL: 'http://127.0.0.1:54322/postgres',
    })).toBe(false);
    expect(canRunLocalProfileElevationTests({
      ...localApiEnvironment,
      SUPABASE_TEST_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    })).toBe(true);
    expect(() => requireLocalProfileElevationTests(localApiEnvironment)).toThrow(/local profile elevation prerequisites/i);
  });

  it('excludes every mutating integration path from default package scripts', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['test:node']).not.toContain('tests/integration');
    expect(packageJson.scripts['test:coverage']).not.toContain('tests/integration');
    expect(packageJson.scripts['test:integration:mutating']).toContain('vitest.mutation.config.mts');
    expect(packageJson.scripts['test:integration:mutating']).toContain('tests/integration/mmi*.integration.test.ts');
    expect(packageJson.scripts['test:integration:mutating']).toContain('--test-concurrency=1');

    const mutationConfig = await readFile(join(process.cwd(), 'vitest.mutation.config.mts'), 'utf8');
    expect(mutationConfig).toContain("'tests/integration/candidateMmiStation.integration.test.ts'");
  });
});
