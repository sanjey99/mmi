import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canRunLocalProfileElevationTests,
  canRunLocalMutationTests,
  requireLocalProfileElevationTests,
  requireLocalMutationTests,
} from './integration/mutationTestSafety';

const mutationEnvironmentKeys = [
  'SUPABASE_LOCAL_MUTATION_TESTS',
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_DB_URL',
] as const;

function mutationCommandEnvironment(
  overrides: Partial<Record<(typeof mutationEnvironmentKeys)[number], string>> = {},
): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of mutationEnvironmentKeys) delete environment[key];
  return { ...environment, ...overrides };
}

function runMutationCommand(environment: NodeJS.ProcessEnv) {
  return spawnSync('npm', ['run', 'test:integration:mutating'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: environment,
    timeout: 15_000,
  });
}

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
    expect(packageJson.scripts['test:integration:mutating']).toBe(
      'node scripts/run-mutating-integration-tests.mjs',
    );

    const wrapper = await readFile(
      join(process.cwd(), 'scripts/run-mutating-integration-tests.mjs'),
      'utf8',
    );
    expect(wrapper).toContain("'vitest.mutation.config.mts'");
    expect(wrapper).toContain("'--test-concurrency=1'");
    expect(wrapper).toMatch(/\^mmi\.\*\\\.integration\\\.test\\\.ts\$/);
    for (const key of mutationEnvironmentKeys) expect(wrapper).toContain(`'${key}'`);
    expect(wrapper).toContain('requireLocalProfileElevationTests(process.env)');
    expect(wrapper).toMatch(/if\s*\(vitestStatus\s*!==\s*0\)\s*process\.exit\(vitestStatus\)/);
    expect(wrapper).toMatch(/process\.exit\(nodeStatus\)/);

    const mutationConfig = await readFile(join(process.cwd(), 'vitest.mutation.config.mts'), 'utf8');
    expect(mutationConfig).toContain("'tests/integration/candidateMmiStation.integration.test.ts'");
  });

  it('reports an explicit successful SKIP before starting either test runner when unconfigured', () => {
    const result = runMutationCommand(mutationCommandEnvironment());
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toMatch(/SKIP mutating integration tests: disposable-local environment is unconfigured\./);
    expect(output).not.toMatch(/vitest\.mutation\.config|TAP version|tests\/integration\/mmi/i);
  });

  it('fails closed for partial or unsafe configuration without echoing credentials', () => {
    const credentialMarker = 'must-not-appear-in-output';
    const partial = runMutationCommand(mutationCommandEnvironment({
      SUPABASE_TEST_SERVICE_ROLE_KEY: credentialMarker,
    }));
    const partialOutput = `${partial.stdout}${partial.stderr}`;
    expect(partial.status).not.toBe(0);
    expect(partialOutput).toMatch(/mutating integration tests are partially configured or unsafe/i);
    expect(partialOutput).not.toContain(credentialMarker);

    const unsafe = runMutationCommand(mutationCommandEnvironment({
      SUPABASE_LOCAL_MUTATION_TESTS: 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA',
      SUPABASE_TEST_URL: 'https://shared.example.test',
      SUPABASE_TEST_ANON_KEY: credentialMarker,
      SUPABASE_TEST_SERVICE_ROLE_KEY: credentialMarker,
      SUPABASE_TEST_DB_URL: 'postgresql://postgres:secret@shared.example.test:5432/postgres',
    }));
    const unsafeOutput = `${unsafe.stdout}${unsafe.stderr}`;
    expect(unsafe.status).not.toBe(0);
    expect(unsafeOutput).toMatch(/mutating integration tests are partially configured or unsafe/i);
    expect(unsafeOutput).not.toContain(credentialMarker);
    expect(unsafeOutput).not.toContain('postgres:secret');
  });
});
