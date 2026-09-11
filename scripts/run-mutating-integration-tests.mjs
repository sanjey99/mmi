import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLocalProfileElevationTests } from '../tests/integration/mutationTestSafety.ts';

const mutationEnvironmentKeys = [
  'SUPABASE_LOCAL_MUTATION_TESTS',
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_ROLE_KEY',
  'SUPABASE_TEST_DB_URL',
];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(executable, arguments_) {
  const result = spawnSync(executable, arguments_, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error('ERROR: unable to start the mutating integration test runner.');
    return 1;
  }
  return result.status ?? 1;
}

const configuredKeyCount = mutationEnvironmentKeys.filter(key =>
  Object.hasOwn(process.env, key)).length;

if (configuredKeyCount === 0) {
  console.log('SKIP mutating integration tests: disposable-local environment is unconfigured.');
  process.exit(0);
}

try {
  requireLocalProfileElevationTests(process.env);
} catch {
  console.error('ERROR: mutating integration tests are partially configured or unsafe.');
  process.exit(1);
}

const vitestStatus = run(process.execPath, [
  join(root, 'node_modules', 'vitest', 'vitest.mjs'),
  'run',
  '--config',
  'vitest.mutation.config.mts',
]);
if (vitestStatus !== 0) process.exit(vitestStatus);

const integrationDirectory = join(root, 'tests', 'integration');
const nodeIntegrationTests = readdirSync(integrationDirectory)
  .filter(fileName => /^mmi.*\.integration\.test\.ts$/.test(fileName))
  .sort()
  .map(fileName => join('tests', 'integration', fileName));

const nodeStatus = run(process.execPath, [
  '--test',
  '--test-concurrency=1',
  ...nodeIntegrationTests,
]);
process.exit(nodeStatus);
