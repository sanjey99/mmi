import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { requireLocalProfileElevationTests } from './mutationTestSafety.ts';

const execFileAsync = promisify(execFile);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERIFIED_MMI_SOURCE_NAMESPACE = 'med_interview_question_bank';
const VERIFIED_MMI_SOURCE_MANIFEST_SHA256 = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71';

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
