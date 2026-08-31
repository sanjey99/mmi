import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { requireLocalProfileElevationTests } from './mutationTestSafety.ts';

const execFileAsync = promisify(execFile);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIXTURE_PREFIX_PATTERN = /^[a-z0-9-]{1,128}$/i;
const VERIFIED_MMI_SOURCE_NAMESPACE = 'med_interview_question_bank';
const VERIFIED_MMI_SOURCE_MANIFEST_SHA256 = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71';

export type LocalAssessorContentTable =
  | 'mmi_stations'
  | 'mmi_sub_questions'
  | 'roleplay_stations';

const LOCAL_ASSESSOR_CONTENT_TABLES = new Set<LocalAssessorContentTable>([
  'mmi_stations',
  'mmi_sub_questions',
  'roleplay_stations',
]);

type PsqlError = Error & { code?: string; stderr?: string };

export function isLocalAssessorContentTable(table: string): table is LocalAssessorContentTable {
  return LOCAL_ASSESSOR_CONTENT_TABLES.has(table as LocalAssessorContentTable);
}

async function executeLocalFixtureSql(
  sql: string,
  environment: Record<string, string | undefined>,
): Promise<string> {
  const databaseUrl = requireLocalProfileElevationTests(environment);

  try {
    const { stdout } = await execFileAsync('psql', [
      '--no-psqlrc',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--set', 'ON_ERROR_STOP=1',
      '--set', 'VERBOSITY=verbose',
      '--dbname', databaseUrl,
      '--command', sql,
    ], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (cause) {
    const processError = cause as PsqlError;
    const sqlState = processError.stderr?.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];
    const fixtureError = new Error(
      processError.stderr?.trim() || processError.message || 'Local fixture SQL failed.',
    ) as PsqlError;
    fixtureError.code = sqlState;
    throw fixtureError;
  }
}

export async function insertLocalAssessorContentRows<Row extends Record<string, unknown>>(
  table: LocalAssessorContentTable,
  rows: Row | Row[],
  environment: Record<string, string | undefined> = process.env,
): Promise<Array<Record<string, unknown> & Row>> {
  if (!isLocalAssessorContentTable(table)) {
    throw new Error(`Unsupported local assessor-content fixture table: ${table}`);
  }
  const fixtureRows = Array.isArray(rows) ? rows : [rows];
  if (fixtureRows.length === 0) return [];
  const encodedFixtureRows = Buffer.from(JSON.stringify(fixtureRows), 'utf8').toString('base64');

  const output = await executeLocalFixtureSql(
    `CREATE OR REPLACE FUNCTION pg_temp.insert_fixture_row(p_table regclass, p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fixture$
DECLARE
  v_columns text;
  v_inserted jsonb;
BEGIN
  SELECT string_agg(format('%I', key), ', ' ORDER BY key)
  INTO v_columns
  FROM jsonb_object_keys(p_row) AS key;
  IF v_columns IS NULL THEN
    RAISE EXCEPTION 'fixture row must not be empty' USING ERRCODE = '22023';
  END IF;
  EXECUTE format(
    'INSERT INTO %s AS inserted (%s) SELECT %s FROM jsonb_populate_record(NULL::%s, $1) RETURNING to_jsonb(inserted)',
    p_table, v_columns, v_columns, p_table
  ) INTO v_inserted USING p_row;
  RETURN v_inserted;
END;
$fixture$;
SELECT pg_temp.insert_fixture_row('public.${table}'::regclass, value)
FROM jsonb_array_elements(convert_from(decode('${encodedFixtureRows}', 'base64'), 'UTF8')::jsonb);`,
    environment,
  );

  return output
    ? output.split('\n').map((line) => JSON.parse(line) as Record<string, unknown> & Row)
    : [];
}

export async function deleteLocalAssessorContentByPrefix(
  fixturePrefix: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!FIXTURE_PREFIX_PATTERN.test(fixturePrefix)) {
    throw new Error('Local assessor-content cleanup requires a safe fixture prefix.');
  }
  await executeLocalFixtureSql(
    `DELETE FROM public.roleplay_stations WHERE station_id LIKE '${fixturePrefix}%';
DELETE FROM public.mmi_stations WHERE station_id LIKE '${fixturePrefix}%';`,
    environment,
  );
}

export async function elevateLocalProfileToAdmin(
  userId: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!UUID_PATTERN.test(userId)) {
    throw new Error('Local profile elevation requires an auth user UUID.');
  }
  const databaseUrl = requireLocalProfileElevationTests(environment);
  const normalizedUserId = userId.toLowerCase();
  await execFileAsync('psql', [
    '--no-psqlrc',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', databaseUrl,
    '--command',
    `WITH elevated AS (UPDATE public.profiles SET is_admin = TRUE WHERE id = '${normalizedUserId}'::uuid RETURNING id) SELECT 1 / CASE WHEN count(*) = 1 THEN 1 ELSE 0 END FROM elevated;`,
  ], {
    windowsHide: true,
  });
}

export async function setCandidateSessionStartedAt(
  sessionId: string,
  startedAt: Date,
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!UUID_PATTERN.test(sessionId) || !Number.isFinite(startedAt.getTime())) {
    throw new Error('Local candidate session adjustment requires a session UUID and valid timestamp.');
  }
  const databaseUrl = requireLocalProfileElevationTests(environment);
  const normalizedSessionId = sessionId.toLowerCase();
  const canonicalStartedAt = startedAt.toISOString();
  await execFileAsync('psql', [
    '--no-psqlrc',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', databaseUrl,
    '--command',
    `WITH adjusted AS (UPDATE public.candidate_mmi_station_sessions SET started_at = '${canonicalStartedAt}'::timestamptz WHERE id = '${normalizedSessionId}'::uuid RETURNING id) SELECT 1 / CASE WHEN count(*) = 1 THEN 1 ELSE 0 END FROM adjusted;`,
  ], {
    windowsHide: true,
  });
}

export async function runCandidateMmiRetentionMaintenance(
  environment: Record<string, string | undefined> = process.env,
): Promise<{ purged: number }> {
  const output = await executeLocalFixtureSql(
    'SELECT public.purge_expired_candidate_mmi_free_text_internal();',
    environment,
  );
  const result = JSON.parse(output) as { purged?: unknown };
  if (!Number.isInteger(result.purged) || Number(result.purged) < 0) {
    throw new Error('Local candidate retention maintenance returned invalid evidence.');
  }
  return { purged: Number(result.purged) };
}

export async function finalizeCandidateMmiResponseAt(
  sessionId: string,
  promptOrder: number,
  finalizationKey: string,
  finalizedAt: Date,
  environment: Record<string, string | undefined> = process.env,
): Promise<string> {
  if (
    !UUID_PATTERN.test(sessionId)
    || !Number.isInteger(promptOrder)
    || promptOrder < 1
    || promptOrder > 5
    || !UUID_PATTERN.test(finalizationKey)
    || !Number.isFinite(finalizedAt.getTime())
  ) {
    throw new Error('Local candidate finalization fixture requires valid identifiers and time.');
  }
  return executeLocalFixtureSql(
    `SELECT (public.finalize_candidate_mmi_station_response_internal('${sessionId.toLowerCase()}'::uuid, ${promptOrder}::smallint, '${finalizationKey.toLowerCase()}'::uuid, '${finalizedAt.toISOString()}'::timestamptz)).id;`,
    environment,
  );
}

export async function activateVerifiedFlatMmiQuestionSet(
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  const databaseUrl = requireLocalProfileElevationTests(environment);
  await execFileAsync('psql', [
    '--no-psqlrc',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', databaseUrl,
    '--command',
    `WITH verified_batches AS (SELECT 1 WHERE EXISTS (SELECT 1 FROM public.question_import_batches WHERE source_namespace = '${VERIFIED_MMI_SOURCE_NAMESPACE}' AND source_manifest_sha256 = '${VERIFIED_MMI_SOURCE_MANIFEST_SHA256}' AND batch_id = 'questions-part-1' AND row_count = 500) AND EXISTS (SELECT 1 FROM public.question_import_batches WHERE source_namespace = '${VERIFIED_MMI_SOURCE_NAMESPACE}' AND source_manifest_sha256 = '${VERIFIED_MMI_SOURCE_MANIFEST_SHA256}' AND batch_id = 'questions-part-2' AND row_count = 285)), activated AS (UPDATE public.questions SET is_active = TRUE WHERE source_namespace = '${VERIFIED_MMI_SOURCE_NAMESPACE}' AND EXISTS (SELECT 1 FROM verified_batches) RETURNING id) SELECT 1 / CASE WHEN count(*) = 785 THEN 1 ELSE 0 END FROM activated;`,
  ], {
    windowsHide: true,
  });
}
