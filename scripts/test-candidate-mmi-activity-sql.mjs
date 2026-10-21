import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const database = 'mmi_candidate_activity_proof';
// Ignore inherited libpq URLs, services, passwords and connection settings.
// Every SQL client below uses only this newly created private Unix socket.
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
let temporary;
let binaries;
let startAttempted = false;
let keepTemporary = false;
let failure = false;

try {
  const directory = process.env.PG_BIN ?? (await execute('pg_config', ['--bindir'], {
    env: environment, timeout: 10_000, maxBuffer: 65_536,
  })).stdout.trim();
  if (!directory || !isAbsolute(directory)) throw new Error('PostgreSQL binary directory must be absolute.');
  binaries = Object.fromEntries(['initdb', 'pg_ctl', 'createdb', 'psql'].map(name => [name, join(directory, name)]));
  await Promise.all(Object.values(binaries).map(path => access(path, constants.X_OK)));
  temporary = await mkdtemp('/tmp/mmi-candidate-activity-sql-');
  await writeFile(join(temporary, 'empty-pgpass'), '');
  environment.PGPASSFILE = join(temporary, 'empty-pgpass');
  const data = join(temporary, 'data');
  await execute(binaries.initdb, ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'], {
    env: environment, timeout: 30_000, maxBuffer: 1_048_576,
  });
  startAttempted = true;
  await execute(binaries.pg_ctl, ['-D', data, '-l', join(temporary, 'postgres.log'), '-o', `-h '' -k ${temporary} -p 5432`, '-w', '-t', '20', 'start'], {
    env: environment, timeout: 30_000, maxBuffer: 1_048_576,
  });
  const connection = [`--host=${temporary}`, '--port=5432', '--username=postgres', '--no-password'];
  await execute(binaries.createdb, [...connection, database], { env: environment, timeout: 10_000, maxBuffer: 1_048_576 });
  const arguments_ = ['-X', '-q', ...connection, `--dbname=${database}`, '-v', 'ON_ERROR_STOP=1'];
  await execute(binaries.psql, [...arguments_, '-c', `ALTER DATABASE ${database} SET app.mmi_candidate_activity_proof='I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA'`], {
    env: environment, timeout: 10_000, maxBuffer: 1_048_576,
  });
  const proof = await execute(binaries.psql, [...arguments_, '-f', 'tests/sql/candidate_mmi_activity_summary.local.sql'], {
    cwd: root, env: environment, timeout: 30_000, maxBuffer: 1_048_576,
  });
  if (!proof.stdout.includes('Candidate MMI activity summary SQL proof passed')) throw new Error('SQL proof did not complete.');
  console.log('Candidate MMI activity summary SQL proof passed.');
} catch (error) {
  failure = true;
  console.error('Candidate MMI activity SQL proof failed.');
  // This runner has no hosted connection and its fixture is synthetic only.
  if (error?.stderr) console.error(String(error.stderr).trim());
  else console.error(error instanceof Error ? error.message : 'Unknown local proof failure.');
} finally {
  if (temporary && startAttempted && binaries) {
    try {
      await execute(binaries.pg_ctl, ['-D', join(temporary, 'data'), '-m', 'fast', '-w', '-t', '15', 'stop'], {
        env: environment, timeout: 20_000, maxBuffer: 1_048_576,
      });
    } catch {
      try {
        await execute(binaries.pg_ctl, ['-D', join(temporary, 'data'), 'status'], { env: environment, timeout: 5_000, maxBuffer: 65_536 });
        keepTemporary = true;
        failure = true;
        console.error(`Owned test cluster could not be stopped; retained at ${temporary}.`);
      } catch { /* No owned server remains running. */ }
    }
  }
  if (temporary && !keepTemporary) await rm(temporary, { recursive: true, force: true });
}
process.exitCode = failure ? 1 : 0;
