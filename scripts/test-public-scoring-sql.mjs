import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const database = 'mmi_public_scoring_proof';
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
  temporary = await mkdtemp('/tmp/mmi-public-scoring-sql-');
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
  await execute(binaries.psql,[...arguments_,'-c',`ALTER DATABASE ${database} SET app.mmi_public_scoring_proof='I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA'`],{
    env:environment,timeout:10_000,maxBuffer:1_048_576,
  });
  const baseline = await readFile(join(root,'supabase/migrations/20260910005000_mmi_final_high_blockers.sql'),'utf8');
  const start = baseline.indexOf('CREATE OR REPLACE FUNCTION public.claim_candidate_mmi_response_scoring(');
  const end = baseline.indexOf('$function$;',start)+ '$function$;'.length;
  if (start<0 || end<=start) throw new Error('Reviewed claim fixture missing.');
  const baselinePath = join(temporary,'baseline-claim.sql');
  await writeFile(baselinePath,baseline.slice(start,end));
  arguments_.push('--set',`baseline_claim=${baselinePath}`);
  const proof = await execute(binaries.psql,[...arguments_,'-f','tests/sql/public_scoring_allowances.local.sql'],{
    cwd:root,env:environment,timeout:30_000,maxBuffer:1_048_576,
  });
  if (!proof.stdout.includes('Public scoring allowance SQL proof passed')) throw new Error('SQL proof did not complete.');
  console.log('Public scoring allowance SQL proof passed.');

  // Each process has a separate transaction. Global limits must hold across
  // accounts, while a distinct-response limit must hold within one account.
  for (const scenario of [
    { name:'global daily', global:3, concurrent:10, responses:10, expected:3, oneAccount:false },
    { name:'global concurrent', global:100, concurrent:2, responses:10, expected:2, oneAccount:false },
    { name:'account distinct responses', global:100, concurrent:10, responses:2, expected:2, oneAccount:true },
  ]) {
    await execute(binaries.psql,[...arguments_,'-c',`
      DELETE FROM public.mmi_public_scoring_response_admissions;
      DELETE FROM public.mmi_public_scoring_account_days;
      DELETE FROM public.mmi_public_scoring_daily_totals;
      DELETE FROM public.mmi_paid_scoring_claim_attempts;
      DELETE FROM public.candidate_mmi_response_scoring_claims;
      UPDATE public.candidate_mmi_station_responses SET scoring_status='pending' WHERE session_id::text LIKE '10000000-0000-4000-8000-00000000010%';
      UPDATE public.mmi_public_scoring_limits SET responses_per_account_day=${scenario.responses},attempts_per_account_day=20,claims_per_day=${scenario.global},concurrent_claims=${scenario.concurrent},scoring_paused=false,daily_known_cost_limit_usd=NULL;
      UPDATE public.candidate_mmi_station_sessions SET user_id=('00000000-0000-4000-8000-'||lpad((${scenario.oneAccount?'1':"((right(id::text,3)::integer-100)%3+1)"})::text,12,'0'))::uuid WHERE id::text LIKE '10000000-0000-4000-8000-00000000010%';
    `],{env:environment,timeout:10_000,maxBuffer:1_048_576});
    const results = await Promise.all(Array.from({length:6},(_,index)=>execute(binaries.psql,[...arguments_,'-t','-A','-c',`
      SET request.jwt.claim.role='service_role';
      SELECT public.claim_candidate_mmi_response_scoring(
        '00000000-0000-4000-8000-${String(scenario.oneAccount?1:index%3+1).padStart(12,'0')}',
        '10000000-0000-4000-8000-${String(100+index).padStart(12,'0')}',1::smallint,
        '50000000-0000-4000-8000-${String(index+1).padStart(12,'0')}');
    `],{env:environment,timeout:20_000,maxBuffer:1_048_576})));
    const statuses=results.map(result=>JSON.parse(result.stdout.trim()).status);
    if(statuses.filter(status=>status==='claimed').length!==scenario.expected
      || statuses.some(status=>!['claimed','rate_limited'].includes(status))) throw new Error(`Concurrent ${scenario.name} limit failed.`);
    const total=await execute(binaries.psql,[...arguments_,'-t','-A','-c',"SELECT sum(attempt_count) FROM public.mmi_public_scoring_daily_totals"],{env:environment,timeout:10_000,maxBuffer:1_048_576});
    if(Number(total.stdout.trim())!==scenario.expected) throw new Error('Rejected claims consumed allowance.');
    console.log(`Concurrent ${scenario.name} proof passed: six contenders, ${scenario.expected} admitted.`);
  }
} catch (error) {
  failure = true;
  console.error('Public scoring SQL proof failed.');
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
