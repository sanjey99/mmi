import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const database = 'mmi_operations_monitoring_proof';
// Never inherit libpq connection/service/password/URL settings. Every client
// command below targets the freshly created private socket with TCP disabled.
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
let temporary;
let binaries;
let startAttempted = false;
let keepTemporary = false;
let failure = false;

try {
  const configured = process.env.PG_BIN;
  const directory = configured ?? (await execute('pg_config', ['--bindir'], {
    env: environment, timeout: 10_000, maxBuffer: 65_536,
  })).stdout.trim();
  if (!directory || !isAbsolute(directory)) throw new Error('PostgreSQL binary directory must be absolute.');
  binaries = Object.fromEntries(['initdb','pg_ctl','createdb','psql'].map(name => [name,join(directory,name)]));
  await Promise.all(Object.values(binaries).map(path => access(path,constants.X_OK)));
  temporary = await mkdtemp('/tmp/mmi-operations-sql-');
  await writeFile(join(temporary,'empty-pgpass'),'');
  environment.PGPASSFILE = join(temporary,'empty-pgpass');
  const data = join(temporary,'data');
  await execute(binaries.initdb, ['-D',data,'-A','trust','-U','postgres','--no-locale','--encoding=UTF8'], {
    env: environment, timeout: 30_000, maxBuffer: 1_048_576,
  });
  startAttempted = true;
  await execute(binaries.pg_ctl, ['-D',data,'-l',join(temporary,'postgres.log'),'-o',`-h '' -k ${temporary} -p 5432`,'-w','-t','20','start'], {
    env: environment, timeout: 30_000, maxBuffer: 1_048_576,
  });
  const connection = [`--host=${temporary}`,'--port=5432','--username=postgres','--no-password'];
  await execute(binaries.createdb,[...connection,database],{ env:environment,timeout:10_000,maxBuffer:1_048_576 });
  const arguments_ = ['-X','-q',...connection,`--dbname=${database}`,'-v','ON_ERROR_STOP=1'];
  await execute(binaries.psql,[...arguments_,'-c',`ALTER DATABASE ${database} SET app.mmi_operations_proof='I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA'`],{
    env:environment,timeout:10_000,maxBuffer:1_048_576,
  });
  const proof = await execute(binaries.psql,[...arguments_,'-f','tests/sql/operations_monitoring.local.sql'],{
    cwd:root,env:environment,timeout:30_000,maxBuffer:1_048_576,
  });
  if (!proof.stdout.includes('Operations monitoring local SQL proof passed')) throw new Error('SQL proof did not complete.');
  console.log('Operations monitoring local SQL proof passed.');

  // Separate transactions contend across six distinct keys for the same
  // account/hour. The total must remain 100 after 180 concurrent submissions.
  const kinds = ['runtime_error','unhandled_rejection','render_error'];
  const areas = ['practice','feedback','progress','profile','other','admin'];
  await Promise.all(areas.map((area,index) => execute(binaries.psql,[...arguments_,'-c',
    `SET ROLE authenticated; SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000004'; DO $$ BEGIN FOR n IN 1..30 LOOP PERFORM public.record_app_runtime_event('${kinds[index%3]}','${area}'); PERFORM pg_sleep(0.001); END LOOP; END $$;`,
  ],{env:environment,timeout:30_000,maxBuffer:1_048_576})));
  const concurrent = await execute(binaries.psql,[...arguments_,'-t','-A','-c',
    "SELECT sum(event_count) FROM public.app_runtime_hourly_counters WHERE user_id='00000000-0000-4000-8000-000000000004'",
  ],{env:environment,timeout:10_000,maxBuffer:1_048_576});
  if (concurrent.stdout.trim() !== '100') throw new Error('Concurrent runtime-event cap failed.');
  console.log('Concurrent runtime-event cap passed: 180 submissions, 100 accepted.');
} catch (error) {
  failure = true;
  console.error('Operations SQL proof failed.');
  // Only local test diagnostics are printed; this process never receives a
  // hosted URL/key and every SQL fixture contains synthetic values only.
  if (error?.stderr) console.error(String(error.stderr).trim());
  else console.error(error instanceof Error ? error.message : 'Unknown local proof failure.');
} finally {
  if (temporary && startAttempted && binaries) {
    try {
      await execute(binaries.pg_ctl,['-D',join(temporary,'data'),'-m','fast','-w','-t','15','stop'],{
        env:environment,timeout:20_000,maxBuffer:1_048_576,
      });
    } catch {
      try {
        await execute(binaries.pg_ctl,['-D',join(temporary,'data'),'status'],{env:environment,timeout:5_000,maxBuffer:65_536});
        keepTemporary = true;
        failure = true;
        console.error(`Owned test cluster could not be stopped; retained at ${temporary}.`);
      } catch { /* No owned server remains running. */ }
    }
  }
  if (temporary && !keepTemporary) await rm(temporary,{recursive:true,force:true});
}
process.exitCode = failure ? 1 : 0;
