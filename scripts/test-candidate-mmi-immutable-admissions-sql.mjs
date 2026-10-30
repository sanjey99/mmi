import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const database = 'mmi_immutable_admissions_proof';
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
let temporary;
let binaries;
let startAttempted = false;
let keepTemporary = false;
let failure = false;

try {
  const directory = process.env.PG_BIN ?? (await execute('pg_config', ['--bindir'], { env: environment, timeout: 10_000, maxBuffer: 65_536 })).stdout.trim();
  if (!directory || !isAbsolute(directory)) throw new Error('PostgreSQL binary directory must be absolute.');
  binaries = Object.fromEntries(['initdb', 'pg_ctl', 'createdb', 'psql'].map(name => [name, join(directory, name)]));
  await Promise.all(Object.values(binaries).map(path => access(path, constants.X_OK)));
  temporary = await mkdtemp('/tmp/mmi-immutable-admissions-sql-');
  await writeFile(join(temporary, 'empty-pgpass'), '', { mode: 0o600 });
  environment.PGPASSFILE = join(temporary, 'empty-pgpass');
  await execute(binaries.initdb, ['-D', join(temporary, 'data'), '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8'], { env: environment, timeout: 30_000, maxBuffer: 1_048_576 });
  startAttempted = true;
  await execute(binaries.pg_ctl, ['-D', join(temporary, 'data'), '-l', join(temporary, 'postgres.log'), '-o', `-h '' -k ${temporary} -p 5432`, '-w', '-t', '20', 'start'], { env: environment, timeout: 30_000, maxBuffer: 1_048_576 });
  const connection = [`--host=${temporary}`, '--port=5432', '--username=postgres', '--no-password'];
  await execute(binaries.createdb, [...connection, database], { env: environment, timeout: 10_000, maxBuffer: 1_048_576 });
  const arguments_ = ['-X', '-q', ...connection, `--dbname=${database}`, '-v', 'ON_ERROR_STOP=1'];
  await execute(binaries.psql, [...arguments_, '-c', `ALTER DATABASE ${database} SET app.mmi_immutable_admissions_proof='I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA'`], { env: environment, timeout: 10_000, maxBuffer: 1_048_576 });

  // Reuse the existing minimal schema fixture, then replace its projection stub
  // with actual repository lifecycle bodies. No full hosted-schema claim is made.
  const schemaSource = await readFile(join(root, 'tests/sql/candidate_mmi_start_limits.local.sql'), 'utf8');
  const schema = schemaSource.slice(0, schemaSource.indexOf('\\i :baseline_start')).replaceAll('mmi_candidate_start_limits_proof', database);
  await writeFile(join(temporary, 'fixture-schema.sql'), schema);
  const migration = async name => readFile(join(root, 'supabase/migrations', name), 'utf8');
  const speech = await migration('20260831000000_candidate_mmi_browser_speech.sql');
  const station = await migration('20260904000000_single_mmi_station.sql');
  const history = await migration('20260910002000_mmi_university_practice_history.sql');
  function exact(source, name) {
    const value = [...source.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(.*?\\$function\\$;`, 'gs'))].at(-1)?.[0];
    if (!value) throw new Error(`Missing reviewed lifecycle body: ${name}`);
    return value;
  }
  const responseTable = speech.match(/CREATE TABLE public\.candidate_mmi_station_responses \([\s\S]*?\n\);/)?.[0];
  if (!responseTable) throw new Error('Missing reviewed response table.');
  const lifecycle = `CREATE SCHEMA extensions;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
${responseTable}
ALTER TABLE public.candidate_mmi_station_response_drafts ADD COLUMN client_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.candidate_mmi_station_response_drafts ADD COLUMN accepted_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE public.candidate_mmi_station_sessions ADD CONSTRAINT actual_abandoned_after_start CHECK(abandoned_at IS NULL OR abandoned_at>=started_at);
ALTER TABLE public.candidate_mmi_station_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.candidate_mmi_station_responses FROM PUBLIC,anon,authenticated,service_role;
${exact(speech, 'candidate_mmi_station_window')}
${exact(station, 'finalize_candidate_mmi_station_response_internal')}
${exact(speech, 'catch_up_candidate_mmi_station_responses')}
${exact(history, 'get_candidate_mmi_station_session')}
${exact(history, 'start_candidate_mmi_station_session')}
${exact(station, 'abandon_candidate_mmi_station_session')}
ALTER FUNCTION public.start_candidate_mmi_station_session(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.start_candidate_mmi_station_session(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.start_candidate_mmi_station_session(text) TO authenticated;
${await migration('20261021001000_candidate_mmi_station_start_limits.sql')}
${await migration('20260905000000_candidate_mmi_response_controls.sql')}
REVOKE ALL ON FUNCTION public.finalize_candidate_mmi_station_response_internal(uuid,smallint,uuid,timestamptz),public.catch_up_candidate_mmi_station_responses(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.abandon_candidate_mmi_station_session(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.abandon_candidate_mmi_station_session(uuid) TO authenticated;
`;
  await writeFile(join(temporary, 'actual-lifecycle.sql'), lifecycle);
  const proof = await execute(binaries.psql, [...arguments_, '-v', `fixture_schema=${join(temporary, 'fixture-schema.sql')}`, '-v', `actual_lifecycle=${join(temporary, 'actual-lifecycle.sql')}`, '-f', 'tests/sql/candidate_mmi_immutable_admissions.local.sql'], { cwd: root, env: environment, timeout: 30_000, maxBuffer: 1_048_576 });
  if (!proof.stdout.includes('Candidate MMI immutable admissions SQL proof passed')) throw new Error('SQL proof did not complete.');
  console.log('Candidate MMI immutable admissions SQL proof passed (actual early-finalize negative control, cutover, fixed boundary, roles, and immutability).');
  async function ownerQuery(sql) {
    return (await execute(binaries.psql, [...arguments_, '-t', '-A', '-c', sql], { cwd: root, env: environment, timeout: 30_000, maxBuffer: 1_048_576 })).stdout.trim();
  }
  const syntheticId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const point = "date_trunc('day',pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '4 days 12 hours'";
  async function contender(n, abandon = true) {
    const result = await ownerQuery(`SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${syntheticId(n)}';
      SELECT set_config('app.proof_now',(${point})::text,false) IS NOT NULL WHERE false;
      DO $$ BEGIN PERFORM set_config('app.proof_now',(${point})::text,false); END; $$;
      SET ROLE authenticated;
      DO $proof$ DECLARE value_ jsonb; BEGIN
        value_:=public.start_candidate_mmi_station_session('all');
        ${abandon ? "PERFORM public.abandon_candidate_mmi_station_session((value_->>'sessionId')::uuid);" : ''}
        PERFORM set_config('app.proof_admitted','true',false);
      EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'candidate_mmi_start_rate_limited' THEN RAISE; END IF;
        PERFORM set_config('app.proof_admitted','false',false);
      END; $proof$; SELECT current_setting('app.proof_admitted');`);
    if (!['true', 'false'].includes(result)) throw new Error('Unexpected contender result.');
    return result === 'true';
  }
  let results = await Promise.all(Array.from({ length: 12 }, () => contender(31)));
  if (results.filter(Boolean).length !== 5 || await ownerQuery(`SELECT count(*) FROM public.candidate_mmi_station_sessions WHERE user_id='${syntheticId(31)}'`) !== '5') throw new Error('Concurrent minute cap failed.');
  console.log('Concurrent immutable minute proof passed: twelve contenders, five admissions.');
  await ownerQuery(`INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,admission_earliest_at,admission_latest_at,abandoned_at,practice_scope)
    SELECT '${syntheticId(32)}','station-a',(${point})-interval '12 hours',(${point})-interval '12 hours',(${point})-interval '12 hours',(${point})-interval '12 hours','all' FROM generate_series(1,28);`);
  results = await Promise.all(Array.from({ length: 8 }, () => contender(32)));
  if (results.filter(Boolean).length !== 2 || await ownerQuery(`SELECT count(*) FROM public.candidate_mmi_station_sessions WHERE user_id='${syntheticId(32)}'`) !== '30') throw new Error('Concurrent day cap failed.');
  console.log('Concurrent immutable day proof passed: eight contenders, two remaining admissions.');
  results = await Promise.all(Array.from({ length: 12 }, () => contender(33, false)));
  if (!results.every(Boolean) || await ownerQuery(`SELECT count(*) FROM public.candidate_mmi_station_sessions WHERE user_id='${syntheticId(33)}'`) !== '1') throw new Error('Concurrent active reuse allocated extra admissions.');
  console.log('Concurrent immutable reuse proof passed: twelve requests, one admission.');
  results = await Promise.all([34, 35].flatMap(n => Array.from({ length: 6 }, () => contender(n))));
  if (results.filter(Boolean).length !== 10 || await ownerQuery(`SELECT count(*) FROM public.candidate_mmi_station_sessions WHERE user_id='${syntheticId(34)}'`) !== '5' || await ownerQuery(`SELECT count(*) FROM public.candidate_mmi_station_sessions WHERE user_id='${syntheticId(35)}'`) !== '5') throw new Error('Concurrent account isolation failed.');
  console.log('Concurrent immutable account proof passed: five admissions each, no global cap.');
} catch (error) {
  failure = true;
  console.error('Candidate MMI immutable admissions SQL proof failed.');
  if (error?.stderr) console.error(String(error.stderr).trim());
  else console.error(error instanceof Error ? error.message : 'Unknown local proof failure.');
} finally {
  if (temporary && startAttempted && binaries) {
    try { await execute(binaries.pg_ctl, ['-D', join(temporary, 'data'), '-m', 'fast', '-w', '-t', '15', 'stop'], { env: environment, timeout: 20_000, maxBuffer: 1_048_576 }); }
    catch {
      try { await execute(binaries.pg_ctl, ['-D', join(temporary, 'data'), 'status'], { env: environment, timeout: 5_000, maxBuffer: 65_536 }); keepTemporary=true; failure=true; console.error(`Owned test cluster could not be stopped; retained at ${temporary}.`); }
      catch { /* No owned server remains. */ }
    }
  }
  if (temporary && !keepTemporary) await rm(temporary, { recursive: true, force: true });
}
process.exitCode = failure ? 1 : 0;
