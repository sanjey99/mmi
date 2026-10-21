import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const database = 'mmi_candidate_start_limits_proof';
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
  temporary = await mkdtemp('/tmp/mmi-candidate-start-limits-sql-');
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
  await execute(binaries.psql, [...arguments_, '-c', `ALTER DATABASE ${database} SET app.mmi_candidate_start_limits_proof='I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA'`], {
    env: environment, timeout: 10_000, maxBuffer: 1_048_576,
  });
  const original = await readFile(join(root, 'supabase/migrations/20260910002000_mmi_university_practice_history.sql'), 'utf8');
  const starts = [...original.matchAll(/CREATE OR REPLACE FUNCTION public\.start_candidate_mmi_station_session\(p_scope text DEFAULT 'all'\).*?\$function\$;/gs)];
  const previous = starts.at(-1)?.[0];
  const abandonment = (await readFile(join(root, 'supabase/migrations/20260904000000_single_mmi_station.sql'), 'utf8'))
    .match(/CREATE OR REPLACE FUNCTION public\.abandon_candidate_mmi_station_session\(p_session_id uuid\).*?\$function\$;/s)?.[0];
  if (!previous || !abandonment) throw new Error('Reviewed baseline start/abandon bodies not found.');
  const baseline = join(temporary, 'baseline-start.sql');
  await writeFile(baseline, `${previous}\n${abandonment}\n`);
  const proof = await execute(binaries.psql, [...arguments_, '-v', `baseline_start=${baseline}`, '-f', 'tests/sql/candidate_mmi_start_limits.local.sql'], {
    cwd: root, env: environment, timeout: 30_000, maxBuffer: 1_048_576,
  });
  if (!proof.stdout.includes('Candidate MMI station start limits SQL proof passed')) throw new Error('SQL proof did not complete.');
  console.log('Candidate MMI station start limits SQL proof passed.');
  async function ownerQuery(sql) {
    return (await execute(binaries.psql, [...arguments_, '-t', '-A', '-c', sql], {
      cwd: root, env: environment, timeout: 30_000, maxBuffer: 1_048_576,
    })).stdout.trim();
  }
  const syntheticId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  async function contender(n, abandon = true) {
    const result = await ownerQuery(`SET request.jwt.claim.role='authenticated';
      SET request.jwt.claim.sub='${syntheticId(n)}'; SET ROLE authenticated;
      DO $proof$ DECLARE value_ jsonb; BEGIN
        value_:=public.start_candidate_mmi_station_session('all');
        ${abandon ? "PERFORM public.abandon_candidate_mmi_station_session((value_->>'sessionId')::uuid);" : ''}
        PERFORM set_config('app.proof_admitted','true',false);
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM<>'candidate_mmi_start_rate_limited' THEN RAISE; END IF;
        PERFORM set_config('app.proof_admitted','false',false);
      END; $proof$;
      SELECT current_setting('app.proof_admitted');`);
    if (!['true', 'false'].includes(result)) throw new Error('Unexpected contender result.');
    return result === 'true';
  }
  let results = await Promise.all(Array.from({ length: 12 }, () => contender(6)));
  if (results.filter(Boolean).length !== 5 || await ownerQuery(`SELECT count(*) FROM public.candidate_mmi_station_sessions WHERE user_id='${syntheticId(6)}'`) !== '5') throw new Error('Concurrent rolling-minute cap failed.');
  console.log('Concurrent rolling-minute proof passed: twelve contenders, five admitted.');
  await ownerQuery(`UPDATE public.mmi_station_start_limits SET starts_per_rolling_minute=30;
    INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,abandoned_at,practice_scope)
    SELECT '${syntheticId(7)}','station-a',date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',clock_timestamp(),'all' FROM generate_series(1,28);`);
  results = await Promise.all(Array.from({ length: 8 }, () => contender(7)));
  if (results.filter(Boolean).length !== 2 || await ownerQuery(`SELECT count(*) FROM public.candidate_mmi_station_sessions WHERE user_id='${syntheticId(7)}'`) !== '30') throw new Error('Concurrent daily cap failed.');
  console.log('Concurrent UTC-day proof passed: eight contenders, two remaining admissions.');
  await ownerQuery('UPDATE public.mmi_station_start_limits SET starts_per_rolling_minute=5;');
  results = await Promise.all(Array.from({ length: 12 }, () => contender(8, false)));
  if (!results.every(Boolean) || await ownerQuery(`SELECT count(*) FROM public.candidate_mmi_station_sessions WHERE user_id='${syntheticId(8)}'`) !== '1') throw new Error('Concurrent active-session reuse consumed admissions.');
  console.log('Concurrent active-reuse proof passed: twelve requests, one new station.');
  results = await Promise.all([9,10].flatMap(n => Array.from({ length: 6 }, () => contender(n))));
  if (results.filter(Boolean).length !== 10 || await ownerQuery(`SELECT count(*) FROM public.candidate_mmi_station_sessions WHERE user_id='${syntheticId(9)}'`) !== '5' || await ownerQuery(`SELECT count(*) FROM public.candidate_mmi_station_sessions WHERE user_id='${syntheticId(10)}'`) !== '5') throw new Error('Concurrent account isolation failed.');
  console.log('Concurrent account-isolation proof passed: five admissions each, no global cap.');

} catch (error) {
  failure = true;
  console.error('Candidate MMI station start limits SQL proof failed.');
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
