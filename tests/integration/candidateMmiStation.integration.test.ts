import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  activateVerifiedFlatMmiQuestionSet,
  elevateLocalProfileToAdmin,
  setCandidateSessionStartedAt,
} from './localDatabaseFixture';
import { canRunLocalProfileElevationTests } from './mutationTestSafety';

const root = process.cwd();
const migrations = {
  orchestration: `${root}/supabase/migrations/20260826000000_normalized_mmi_station_orchestration.sql`,
  browserSpeech: `${root}/supabase/migrations/20260831000000_candidate_mmi_browser_speech.sql`,
  hardening: `${root}/supabase/migrations/20260901000000_candidate_mmi_browser_speech_hardening.sql`,
  retention: `${root}/supabase/migrations/20260901001000_candidate_mmi_retention_schedule.sql`,
  singleStation: `${root}/supabase/migrations/20260904000000_single_mmi_station.sql`,
  responseControls: `${root}/supabase/migrations/20260905000000_candidate_mmi_response_controls.sql`,
} as const;
const importDirectory = `${root}/supabase/imports/20260825_med_interview_question_bank`;
const flatCsvPaths = [
  `${importDirectory}/questions-part-1.csv`,
  `${importDirectory}/questions-part-2.csv`,
] as const;
const normalizedPayloadPaths = [
  `${importDirectory}/normalized-stations-part-1.json`,
  `${importDirectory}/normalized-stations-part-2.json`,
] as const;
const normalizedManifestPath = `${importDirectory}/normalized-station-manifest.json`;
const sourceNamespace = 'med_interview_question_bank';
const sourceManifestSha256 = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71';
const normalizedManifestSha256 = 'add7cf932a60e4573e3aca54c0cdecafd3c46c4421d245e2b3e71d8cbe8fa101';
const expectedServerPayloadFingerprints = [
  '950e52261c043a819dab92183b423a15e43be1ac20e02c4e47927a7b10a0424e',
  '31ba173facd961ef14a9258a41f101c3cebe087b581c481133db88ff9602832c',
] as const;
const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const run = describe.runIf(canRunLocalProfileElevationTests(process.env));
const fixturePrefix = `single-mmi-${randomUUID().slice(0, 8)}`;
const password = `Local-only-${randomUUID()}!`;

type CandidatePayload = {
  artifact_version: number;
  source_namespace: string;
  source_manifest_sha256: string;
  panel_questions: Array<{
    question_id: string;
  }>;
  stations: Array<{
    station_id: string;
    scenario_text: string;
    sub_questions: Array<{
      sub_q_id: string;
      order_num: number;
      question_text: string;
      time_limit_sec: number;
      marking_criteria: Array<{
        criterion_id: string;
      }>;
    }>;
  }>;
};

type FinalizationProof = {
  candidateStationCount: number;
  candidateSubQuestionCount: number;
  candidateCriterionCount: number;
  panelQuestionCount: number;
  stationVersionCount: number;
  source120SecondQuestionCount: number;
  source90SecondQuestionCount: number;
  otherSourceDurationCount: number;
  validStationCount: number;
  invalidStationCount: number;
  excludedPanelQuestionCount: number;
  panelSubQuestionCount: number;
  preservedActiveFlatQuestionCount: number;
};

type NormalizedManifest = {
  private_artifacts: Record<string, { sha256: string; canonical_jsonb_payload_sha256: string }>;
};

type ParsedFlatCsv = {
  errors: Array<{ row: number; message: string }>;
  rows: Array<{ value: Record<string, unknown> }>;
};

type ImportedQuestionBatch = { ids: string[] };
type AuthenticatedClient = { client: SupabaseClient; userId: string };
type StationVersionFingerprint = {
  stationId: string;
  version: number;
  contentSha256: string;
  createdBy: string | null;
  createdAt: string;
};

let parseQuestionCsv: (csvText: string) => ParsedFlatCsv;
let importQuestionRows: (
  client: SupabaseClient,
  rows: readonly Record<string, unknown>[],
) => Promise<ImportedQuestionBatch>;

function readMigration(path: string): string {
  assert.ok(existsSync(path), `expected migration: ${path}`);
  return readFileSync(path, 'utf8');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function readNormalizedManifest(): NormalizedManifest {
  assert.ok(existsSync(normalizedManifestPath), `expected tracked manifest: ${normalizedManifestPath}`);
  const raw = readFileSync(normalizedManifestPath);
  assert.equal(createHash('sha256').update(raw).digest('hex'), normalizedManifestSha256);
  return JSON.parse(raw.toString('utf8')) as NormalizedManifest;
}

function readNormalizedPayloads(): CandidatePayload[] {
  return normalizedPayloadPaths.map(path => {
    assert.ok(existsSync(path), `expected ignored local normalized payload: ${path}`);
    return JSON.parse(readFileSync(path, 'utf8')) as CandidatePayload;
  });
}

function serverJsonbPayloadSha256(payload: CandidatePayload): string {
  assert.ok(process.env.SUPABASE_TEST_DB_URL);
  const sqlLiteral = JSON.stringify(payload).replaceAll("'", "''");
  const result = execFileSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_TEST_DB_URL,
  ], {
    encoding: 'utf8',
    input: `SELECT encode(sha256(convert_to(('${sqlLiteral}')::jsonb::text, 'UTF8')), 'hex');\n`,
  }).trim();
  assert.match(result, /^[a-f0-9]{64}$/);
  return result;
}

async function countRows(client: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true });
  assert.equal(error, null, error?.message);
  return count ?? 0;
}

function assertLegacyCriteriaCompatibility(): void {
  assert.ok(process.env.SUPABASE_TEST_DB_URL);
  const archiveState = execFileSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_TEST_DB_URL,
    '--command',
    "SELECT CASE WHEN to_regclass('public.mmi_marking_criteria_legacy_20260910') IS NULL THEN 'absent' ELSE 'present' END;",
  ], { encoding: 'utf8' }).trim();
  assert.match(archiveState, /^(absent|present)$/);
  if (archiveState === 'absent') return;

  const proof = execFileSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_TEST_DB_URL,
    '--command',
    "SELECT (SELECT count(*) FROM public.mmi_marking_criteria_legacy_20260910), c.relkind, c.relrowsecurity, NOT (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') OR has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') OR has_any_column_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')), primary_key_proof.conname, primary_key_proof.index_name FROM pg_class AS c CROSS JOIN LATERAL (SELECT constraint_row.conname, index_relation.relname AS index_name FROM pg_constraint AS constraint_row JOIN pg_index AS index_row ON index_row.indexrelid = constraint_row.conindid AND index_row.indrelid = c.oid JOIN pg_class AS index_relation ON index_relation.oid = index_row.indexrelid WHERE constraint_row.conrelid = c.oid AND constraint_row.contype = 'p') AS primary_key_proof WHERE c.oid = 'public.mmi_marking_criteria_legacy_20260910'::regclass;",
  ], { encoding: 'utf8' }).trim();
  const [rowCount, relationKind, rlsEnabled, aclClosed, primaryKeyName, primaryKeyIndexName] = proof.split('|');
  assert.ok(Number(rowCount) > 0, 'expected the hosted-compatibility fixture row to survive archival');
  assert.equal(relationKind, 'r', 'expected the archived hosted relation to remain an ordinary table');
  assert.equal(rlsEnabled, 't');
  assert.equal(aclClosed, 't');
  assert.ok(primaryKeyName, 'expected the archived hosted primary-key constraint to survive');
  assert.ok(primaryKeyIndexName, 'expected the archived hosted primary-key index to survive');
}

function groupCounts(rows: readonly { sub_q_id: string }[]): number[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.sub_q_id, (counts.get(row.sub_q_id) ?? 0) + 1);
  return [...counts.values()];
}

function setStationPublicationState(stationId: string, status: 'published' | 'archived'): void {
  assert.match(stationId, /^MMI_[0-9]{3}$/);
  assert.ok(process.env.SUPABASE_TEST_DB_URL);
  execFileSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_TEST_DB_URL,
    '--command',
    `UPDATE public.mmi_stations SET status = '${status}', archived_at = ${status === 'archived' ? 'clock_timestamp()' : 'NULL'} WHERE station_id = '${stationId}';`,
  ]);
}

function corruptFlatPanelIdentity(panelId: string, replacementSourceId: string): string {
  assert.match(panelId, /^PANEL_[0-9]{3}$/);
  assert.match(replacementSourceId, /^PANEL_[0-9]{3}$/);
  assert.ok(process.env.SUPABASE_TEST_DB_URL);
  const rowId = execFileSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_TEST_DB_URL,
    '--command',
    `WITH changed AS (UPDATE public.questions SET source_id = '${replacementSourceId}' WHERE source_namespace = '${sourceNamespace}' AND source_id = '${panelId}' RETURNING id) SELECT id FROM changed;`,
  ], { encoding: 'utf8' }).trim();
  assert.match(rowId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  return rowId;
}

function restoreFlatPanelIdentity(rowId: string, panelId: string, corruptedSourceId: string): void {
  assert.match(rowId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(panelId, /^PANEL_[0-9]{3}$/);
  assert.match(corruptedSourceId, /^PANEL_[0-9]{3}$/);
  assert.ok(process.env.SUPABASE_TEST_DB_URL);
  execFileSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_TEST_DB_URL,
    '--command',
    `WITH restored AS (UPDATE public.questions SET source_id = '${panelId}' WHERE id = '${rowId}'::uuid AND source_id = '${corruptedSourceId}' RETURNING id) SELECT 1 / CASE WHEN count(*) = 1 THEN 1 ELSE 0 END FROM restored;`,
  ]);
}

function assertStationVersionMutationsRejected(stationId: string, version = 1): void {
  assert.match(stationId, /^MMI_[0-9]{3}$/);
  assert.ok(Number.isSafeInteger(version) && version > 0);
  assert.ok(process.env.SUPABASE_TEST_DB_URL);
  execFileSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_TEST_DB_URL,
    '--command',
    `DO $immutability$ BEGIN BEGIN UPDATE public.mmi_station_versions SET station_id = station_id WHERE station_id = '${stationId}' AND version = ${version}; RAISE EXCEPTION 'station identity update was accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END; BEGIN UPDATE public.mmi_station_versions SET version = version WHERE station_id = '${stationId}' AND version = ${version}; RAISE EXCEPTION 'station version update was accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END; BEGIN UPDATE public.mmi_station_versions SET content_snapshot = content_snapshot WHERE station_id = '${stationId}' AND version = ${version}; RAISE EXCEPTION 'station content update was accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END; BEGIN UPDATE public.mmi_station_versions SET created_by = created_by WHERE station_id = '${stationId}' AND version = ${version}; RAISE EXCEPTION 'station author update was accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END; BEGIN UPDATE public.mmi_station_versions SET created_at = created_at WHERE station_id = '${stationId}' AND version = ${version}; RAISE EXCEPTION 'station timestamp update was accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END; BEGIN DELETE FROM public.mmi_station_versions WHERE station_id = '${stationId}' AND version = ${version}; RAISE EXCEPTION 'station version delete was accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END; END; $immutability$;`,
  ]);
}

function stationVersionFingerprint(stationId: string, version: number): StationVersionFingerprint {
  assert.match(stationId, /^MMI_[0-9]{3}$/);
  assert.ok(Number.isSafeInteger(version) && version > 0);
  assert.ok(process.env.SUPABASE_TEST_DB_URL);
  const value = execFileSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_TEST_DB_URL,
    '--command',
    `SELECT json_build_object('stationId', station_id, 'version', version, 'contentSha256', encode(sha256(convert_to(content_snapshot::text, 'UTF8')), 'hex'), 'createdBy', created_by, 'createdAt', created_at::text) FROM public.mmi_station_versions WHERE station_id = '${stationId}' AND version = ${version};`,
  ], { encoding: 'utf8' }).trim();
  assert.ok(value, 'expected station version fingerprint');
  return JSON.parse(value) as StationVersionFingerprint;
}

function createStationVersionWithAuthor(stationId: string, version: number, authorId: string): StationVersionFingerprint {
  assert.match(stationId, /^MMI_[0-9]{3}$/);
  assert.ok(Number.isSafeInteger(version) && version > 1);
  assert.match(authorId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.ok(process.env.SUPABASE_TEST_DB_URL);
  execFileSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_TEST_DB_URL,
    '--command',
    `INSERT INTO public.mmi_station_versions (station_id, version, content_snapshot, created_by, created_at) SELECT station_id, ${version}, content_snapshot, '${authorId}'::uuid, created_at FROM public.mmi_station_versions WHERE station_id = '${stationId}' AND version = 1;`,
  ]);
  return stationVersionFingerprint(stationId, version);
}

function assertDirectStationVersionAuthorNullingRejected(stationId: string, version: number): void {
  assert.match(stationId, /^MMI_[0-9]{3}$/);
  assert.ok(Number.isSafeInteger(version) && version > 0);
  assert.ok(process.env.SUPABASE_TEST_DB_URL);
  execFileSync('psql', [
    '--no-psqlrc',
    '--quiet',
    '--set', 'ON_ERROR_STOP=1',
    '--dbname', process.env.SUPABASE_TEST_DB_URL,
    '--command',
    `DO $immutability$ BEGIN BEGIN UPDATE public.mmi_station_versions SET created_by = NULL WHERE station_id = '${stationId}' AND version = ${version} AND created_by IS NOT NULL; RAISE EXCEPTION 'direct station author nulling was accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END; END; $immutability$;`,
  ]);
}

function assertResponseProjection(
  value: unknown,
  expectedOrder: number,
  expectedPromptHash: string,
): void {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const projection = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(projection).sort(), [
    'draftRevision',
    'draftTranscript',
    'phase',
    'phaseEndsAt',
    'phaseStartedAt',
    'promptOrder',
    'promptText',
    'responseStatus',
    'serverNow',
    'sessionId',
    'stationId',
  ].sort());
  assert.equal(projection.phase, 'response');
  assert.equal(projection.promptOrder, expectedOrder);
  assert.equal(sha256(projection.promptText as string), expectedPromptHash);
  assert.equal('scenarioText' in projection, false);
}

async function createAuthenticatedClient(
  service: SupabaseClient,
  label: string,
  isAdmin = false,
): Promise<AuthenticatedClient> {
  const email = `${fixturePrefix}-${label}@example.test`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(error, null, error?.message);
  assert.ok(data.user);
  if (isAdmin) await elevateLocalProfileToAdmin(data.user.id);
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  assert.equal(signInError, null, signInError?.message);
  return { client, userId: data.user.id };
}

describe('single MMI station migration contract', () => {
  it('keeps the additive orchestration, browser speech, hardening, and retention chain', () => {
    assert.match(readMigration(migrations.orchestration), /start_candidate_mmi_station_session\s*\(\s*\)/i);
    assert.match(readMigration(migrations.browserSpeech), /candidate_mmi_station_response_drafts/i);
    assert.match(readMigration(migrations.hardening), /candidate_checkpoint_rate_limited/i);
    assert.match(readMigration(migrations.retention), /candidate-mmi-purge-expired-free-text/i);
  });

  it('removes product and approval gates only in a forward migration', () => {
    const sql = readMigration(migrations.singleStation);
    assert.match(sql, /DELETE FROM public\.app_config\s+WHERE key = 'normalized_mmi_station_enabled'/i);
    assert.doesNotMatch(sql, /feature_disabled|clinician_reviewed|JOIN public\.mmi_scoring_rubrics/i);
    assert.match(sql, /question\.question_text/i);
    assert.match(sql, /question\.order_num/i);
    assert.match(sql, /interval '7 days'/i);
  });

  it('allows only the current response to finish early and advances the server timeline', () => {
    const sql = readMigration(migrations.responseControls);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.finalize_candidate_mmi_station_response/i);
    assert.match(sql, /p_prompt_order\s*<>\s*v_current_prompt/i);
    assert.match(sql, /UPDATE public\.candidate_mmi_station_sessions/i);
    assert.doesNotMatch(sql, /candidate_response_deadline_not_reached/i);
  });
});

run('single MMI station orchestration (disposable local Supabase only)', () => {
  let service: SupabaseClient;
  let owner: AuthenticatedClient;
  let other: AuthenticatedClient;
  const authUserIds: string[] = [];
  let finalizationProof: FinalizationProof;
  let promptHashesByStation: Record<string, readonly string[]>;
  let scenarioHashesByStation: Record<string, string>;
  let canonicalizedSourceDurationCount: number;

  async function deleteSession(sessionId: string): Promise<void> {
    const { error } = await service
      .from('candidate_mmi_station_sessions')
      .delete()
      .eq('id', sessionId);
    assert.equal(error, null, error?.message);
  }

  beforeAll(async () => {
    ({ parseQuestionCsv } = await import('../../src/features/questions/csv' + '.ts') as {
      parseQuestionCsv: (csvText: string) => ParsedFlatCsv;
    });
    ({ importQuestionRows } = await import('../../src/features/questions/api' + '.ts') as {
      importQuestionRows: (
        client: SupabaseClient,
        rows: readonly Record<string, unknown>[],
      ) => Promise<ImportedQuestionBatch>;
    });

    service = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });
    assertLegacyCriteriaCompatibility();
    const admin = await createAuthenticatedClient(service, 'admin', true);
    owner = await createAuthenticatedClient(service, 'owner');
    other = await createAuthenticatedClient(service, 'other');
    authUserIds.push(admin.userId, owner.userId, other.userId);

    let importedCount = 0;
    for (const path of flatCsvPaths) {
      assert.ok(existsSync(path), `expected ignored local flat import artifact: ${path}`);
      const parsed = parseQuestionCsv(readFileSync(path, 'utf8'));
      assert.deepEqual(parsed.errors, []);
      importedCount += (await importQuestionRows(
        admin.client,
        parsed.rows.map(row => row.value),
      )).ids.length;
    }
    assert.equal(importedCount, 785);
    await activateVerifiedFlatMmiQuestionSet();

    const manifest = readNormalizedManifest();
    const payloads = readNormalizedPayloads();
    assert.deepEqual(payloads.map(serverJsonbPayloadSha256), expectedServerPayloadFingerprints);
    const sourceDurations = payloads
      .flatMap(payload => payload.stations)
      .flatMap(station => station.sub_questions)
      .map(question => question.time_limit_sec);
    assert.equal(sourceDurations.filter(duration => duration === 120).length, 772);
    assert.equal(sourceDurations.filter(duration => duration === 90).length, 3);
    assert.equal(sourceDurations.filter(duration => ![90, 120].includes(duration)).length, 0);
    canonicalizedSourceDurationCount = sourceDurations.filter(duration => duration !== 120).length;
    const malformedPayload = structuredClone(payloads[0]!);
    malformedPayload.stations[0]!.sub_questions[0]!.marking_criteria[0]!.criterion_id = 'MMI_999_Q1_C1';
    const countsBeforeMalformedImport = await Promise.all([
      countRows(service, 'mmi_stations'),
      countRows(service, 'mmi_sub_questions'),
      countRows(service, 'mmi_marking_criteria'),
      countRows(service, 'mmi_panel_questions'),
    ]);
    const firstArtifact = manifest.private_artifacts['normalized-stations-part-1.json'];
    assert.ok(firstArtifact);
    const { error: malformedImportError } = await service.rpc('import_normalized_mmi_station_batch', {
      p_batch_id: 'normalized-stations-part-1',
      p_normalized_manifest_sha256: normalizedManifestSha256,
      p_artifact_sha256: firstArtifact.sha256,
      p_payload: malformedPayload,
    });
    assert.ok(malformedImportError, 'expected orphaned criterion import rejection');
    assert.deepEqual(await Promise.all([
      countRows(service, 'mmi_stations'),
      countRows(service, 'mmi_sub_questions'),
      countRows(service, 'mmi_marking_criteria'),
      countRows(service, 'mmi_panel_questions'),
    ]), countsBeforeMalformedImport);

    for (const [index, payload] of payloads.entries()) {
      const artifactName = `normalized-stations-part-${index + 1}.json`;
      const artifact = manifest.private_artifacts[artifactName];
      assert.ok(artifact);
      assert.equal(
        createHash('sha256').update(readFileSync(normalizedPayloadPaths[index]!)).digest('hex'),
        artifact.sha256,
      );
      const { error } = await service.rpc('import_normalized_mmi_station_batch', {
        p_batch_id: `normalized-stations-part-${index + 1}`,
        p_normalized_manifest_sha256: normalizedManifestSha256,
        p_artifact_sha256: artifact.sha256,
        p_payload: payload,
      });
      assert.equal(error, null, error?.message);
    }

    const panelId = payloads[0]!.panel_questions[0]!.question_id;
    const corruptedSourceId = 'PANEL_999';
    const versionCountBeforeCorruption = await countRows(service, 'mmi_station_versions');
    const corruptedRowId = corruptFlatPanelIdentity(panelId, corruptedSourceId);
    try {
      const { data: corruptFinalization, error: corruptFinalizationError } = await service.rpc(
        'finalize_normalized_mmi_station_import',
        {
          p_source_namespace: sourceNamespace,
          p_source_manifest_sha256: sourceManifestSha256,
          p_normalized_manifest_sha256: normalizedManifestSha256,
        },
      );
      assert.equal(corruptFinalization, null);
      assert.match(corruptFinalizationError?.message ?? '', /normalized finalization checks failed/i);
      assert.equal(await countRows(service, 'mmi_station_versions'), versionCountBeforeCorruption);
    } finally {
      restoreFlatPanelIdentity(corruptedRowId, panelId, corruptedSourceId);
    }

    const { data, error } = await service.rpc('finalize_normalized_mmi_station_import', {
      p_source_namespace: sourceNamespace,
      p_source_manifest_sha256: sourceManifestSha256,
      p_normalized_manifest_sha256: normalizedManifestSha256,
    });
    assert.equal(error, null, error?.message);
    finalizationProof = data as FinalizationProof;

    const preservedStationId = payloads[0]!.stations[0]!.station_id;
    setStationPublicationState(preservedStationId, 'archived');
    const { error: reimportError } = await service.rpc('import_normalized_mmi_station_batch', {
      p_batch_id: 'normalized-stations-part-1',
      p_normalized_manifest_sha256: normalizedManifestSha256,
      p_artifact_sha256: firstArtifact.sha256,
      p_payload: payloads[0],
    });
    assert.equal(reimportError, null, reimportError?.message);
    const { data: preservedStation, error: preservedStationError } = await service
      .from('mmi_stations')
      .select('status,archived_at')
      .eq('station_id', preservedStationId)
      .single();
    assert.equal(preservedStationError, null, preservedStationError?.message);
    assert.equal(preservedStation?.status, 'archived');
    assert.ok(preservedStation?.archived_at);
    setStationPublicationState(preservedStationId, 'published');

    promptHashesByStation = Object.fromEntries(payloads.flatMap(payload => payload.stations.map(station => [
      station.station_id,
      station.sub_questions.map(question => sha256(question.question_text)),
    ])));
    scenarioHashesByStation = Object.fromEntries(payloads.flatMap(payload => payload.stations.map(station => [
      station.station_id,
      sha256(station.scenario_text),
    ])));

    const { error: noticeError } = await service.from('mmi_privacy_notices').delete().neq('version', '');
    assert.equal(noticeError, null, noticeError?.message);
    const { error: rubricError } = await service.from('mmi_scoring_rubrics').delete().not('id', 'is', null);
    assert.equal(rubricError, null, rubricError?.message);
  }, 30_000);

  afterAll(async () => {
    if (!service) return;
    for (const userId of authUserIds) {
      const { error } = await service.auth.admin.deleteUser(userId);
      assert.equal(error, null, error?.message);
    }
  });

  it('imports exact station, prompt, criterion, panel, and version counts', async () => {
    assert.deepEqual(finalizationProof, {
      candidateStationCount: 155,
      candidateSubQuestionCount: 775,
      candidateCriterionCount: 3100,
      panelQuestionCount: 10,
      stationVersionCount: 155,
      source120SecondQuestionCount: 772,
      source90SecondQuestionCount: 3,
      otherSourceDurationCount: 0,
      validStationCount: 155,
      invalidStationCount: 0,
      excludedPanelQuestionCount: 10,
      panelSubQuestionCount: 0,
      preservedActiveFlatQuestionCount: 785,
    });
    assert.equal(await countRows(service, 'mmi_stations'), 155);
    assert.equal(await countRows(service, 'mmi_sub_questions'), 775);
    assert.equal(await countRows(service, 'mmi_marking_criteria'), 3100);
    assert.equal(await countRows(service, 'mmi_panel_questions'), 10);
    assert.equal(await countRows(service, 'mmi_station_versions'), 155);
    assert.equal(canonicalizedSourceDurationCount, 3);

    const { data: durationRows, error: durationError } = await service
      .from('mmi_sub_questions')
      .select('time_limit_sec,source_time_limit_sec')
      .order('sub_q_id')
      .range(0, 774);
    assert.equal(durationError, null, durationError?.message);
    assert.equal(durationRows?.length, 775);
    assert.equal(durationRows?.every(row => row.time_limit_sec === 120), true);
    assert.equal(durationRows?.filter(row => row.source_time_limit_sec === 120).length, 772);
    assert.equal(durationRows?.filter(row => row.source_time_limit_sec === 90).length, 3);
    assert.equal(durationRows?.filter(row => ![90, 120].includes(row.source_time_limit_sec)).length, 0);

    const criterionOwners: Array<{ sub_q_id: string }> = [];
    for (let start = 0; start < 3100; start += 1000) {
      const { data, error } = await service
        .from('mmi_marking_criteria')
        .select('sub_q_id')
        .order('sub_q_id')
        .range(start, Math.min(start + 999, 3099));
      assert.equal(error, null, error?.message);
      criterionOwners.push(...(data ?? []));
    }
    const criterionCounts = groupCounts(criterionOwners);
    assert.equal(criterionCounts.length, 775);
    assert.equal(criterionCounts.every(count => count === 4), true);

    const { data: version, error: versionError } = await service
      .from('mmi_station_versions')
      .select('station_id,version,content_snapshot')
      .limit(1)
      .single();
    assert.equal(versionError, null, versionError?.message);
    assert.equal(version?.version, 1);
    const snapshot = version?.content_snapshot as Record<string, unknown>;
    assert.deepEqual(Object.keys(snapshot).sort(), [
      'category',
      'contentVersion',
      'difficulty',
      'imageUrl',
      'prepTimeSec',
      'questions',
      'scenarioText',
      'stationId',
      'topic',
      'universityTags',
    ].sort());
    const snapshotQuestions = snapshot.questions as Array<{
      criteria: unknown[];
      sourceTimeLimitSec: number;
      timeLimitSec: number;
    }>;
    assert.equal(snapshotQuestions.length, 5);
    assert.equal(snapshotQuestions.every(question => question.criteria.length === 4), true);
    assert.equal(snapshotQuestions.every(question => question.timeLimitSec === 120), true);
    assert.equal(snapshotQuestions.every(question => [90, 120].includes(question.sourceTimeLimitSec)), true);
    assert.equal('panelNotes' in snapshot, false);
    assertStationVersionMutationsRejected(version!.station_id);
    assert.equal(Object.keys(promptHashesByStation).length, 155);
    assert.equal(Object.values(promptHashesByStation).every(prompts => prompts.length === 5), true);
  });

  it('allows only the foreign-key author cleanup while preserving immutable version bytes', async () => {
    const { data: stationVersion, error: stationVersionError } = await service
      .from('mmi_station_versions')
      .select('station_id')
      .eq('version', 1)
      .limit(1)
      .single();
    assert.equal(stationVersionError, null, stationVersionError?.message);
    assert.ok(stationVersion);

    const email = `${fixturePrefix}-version-author@example.test`;
    const { data: authorData, error: authorError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert.equal(authorError, null, authorError?.message);
    assert.ok(authorData.user);

    const before = createStationVersionWithAuthor(stationVersion.station_id, 2, authorData.user.id);
    assert.equal(before.createdBy, authorData.user.id);
    assertDirectStationVersionAuthorNullingRejected(stationVersion.station_id, 2);
    assert.deepEqual(stationVersionFingerprint(stationVersion.station_id, 2), before);

    const { error: deleteAuthorError } = await service.auth.admin.deleteUser(authorData.user.id);
    assert.equal(deleteAuthorError, null, deleteAuthorError?.message);

    const after = stationVersionFingerprint(stationVersion.station_id, 2);
    assert.deepEqual(after, { ...before, createdBy: null });
    assertStationVersionMutationsRejected(stationVersion.station_id, 2);
  });

  it('opens the exact scenario without a flag, notice, or rubric and denies every cross-account action', async () => {
    const { data: started, error } = await owner.client.rpc('start_candidate_mmi_station_session');
    assert.equal(error, null, error?.message);
    assert.ok(started && typeof started === 'object' && !Array.isArray(started));
    const projection = started as Record<string, unknown>;
    const sessionId = projection.sessionId as string;
    const stationId = projection.stationId as string;

    try {
      assert.equal(projection.phase, 'scenario');
      assert.equal(sha256(projection.scenarioText as string), scenarioHashesByStation[stationId]);
      assert.equal('promptText' in projection, false);
      assert.equal(
        (Date.parse(projection.phaseEndsAt as string) - Date.parse(projection.phaseStartedAt as string)) / 1_000,
        60,
      );

      const { data: restored, error: restoreError } = await owner.client.rpc(
        'get_candidate_mmi_station_session',
        { p_session_id: sessionId },
      );
      assert.equal(restoreError, null, restoreError?.message);
      assert.equal((restored as { sessionId: string }).sessionId, sessionId);

      await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - 60_000));
      const deniedCalls = [
        other.client.rpc('get_candidate_mmi_station_session', { p_session_id: sessionId }),
        other.client.rpc('checkpoint_candidate_mmi_station_response', {
          p_session_id: sessionId,
          p_prompt_order: 1,
          p_transcript: 'Cross-account text must be rejected.',
          p_client_revision: 1,
        }),
        other.client.rpc('finalize_candidate_mmi_station_response', {
          p_session_id: sessionId,
          p_prompt_order: 1,
          p_finalization_key: randomUUID(),
        }),
        other.client.rpc('abandon_candidate_mmi_station_session', { p_session_id: sessionId }),
        other.client.rpc('get_candidate_mmi_station_feedback', { p_session_id: sessionId }),
      ];
      for (const denied of await Promise.all(deniedCalls)) {
        assert.ok(denied.error, 'expected cross-account RPC denial');
      }
    } finally {
      await deleteSession(sessionId);
    }
  });

  it('runs 60 + five 120-second phases and permits AI scoring only after completion', async () => {
    const { data: started, error } = await owner.client.rpc('start_candidate_mmi_station_session');
    assert.equal(error, null, error?.message);
    const sessionId = (started as { sessionId: string }).sessionId;
    const stationId = (started as { stationId: string }).stationId;
    const promptHashes = promptHashesByStation[stationId]!;
    const transcript = 'Synthetic transcript stored as editable text, never raw microphone audio.';

    try {
      await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - 60_000));
      const { data: firstPrompt, error: firstPromptError } = await owner.client.rpc(
        'get_candidate_mmi_station_session',
        { p_session_id: sessionId },
      );
      assert.equal(firstPromptError, null, firstPromptError?.message);
      assertResponseProjection(firstPrompt, 1, promptHashes[0]!);
      const { error: checkpointError } = await owner.client.rpc(
        'checkpoint_candidate_mmi_station_response',
        {
          p_session_id: sessionId,
          p_prompt_order: 1,
          p_transcript: transcript,
          p_client_revision: 1,
        },
      );
      assert.equal(checkpointError, null, checkpointError?.message);
      const { data: earlyFinalization, error: earlyFinalizationError } = await owner.client.rpc(
        'finalize_candidate_mmi_station_response',
        {
          p_session_id: sessionId,
          p_prompt_order: 1,
          p_finalization_key: randomUUID(),
        },
      );
      assert.equal(earlyFinalizationError, null, earlyFinalizationError?.message);
      assert.equal((earlyFinalization as { scoringStatus: string }).scoringStatus, 'pending');
      const { data: afterEarlySubmit, error: afterEarlySubmitError } = await owner.client.rpc(
        'get_candidate_mmi_station_session',
        { p_session_id: sessionId },
      );
      assert.equal(afterEarlySubmitError, null, afterEarlySubmitError?.message);
      assertResponseProjection(afterEarlySubmit, 2, promptHashes[1]!);

      await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - 180_000));
      const finalizationKey = randomUUID();
      const { data: finalized, error: finalizeError } = await owner.client.rpc(
        'finalize_candidate_mmi_station_response',
        {
          p_session_id: sessionId,
          p_prompt_order: 1,
          p_finalization_key: finalizationKey,
        },
      );
      assert.equal(finalizeError, null, finalizeError?.message);
      assert.equal((finalized as { scoringStatus: string }).scoringStatus, 'pending');
      assert.deepEqual(finalized, earlyFinalization);

      const { data: repeated, error: repeatedError } = await owner.client.rpc(
        'finalize_candidate_mmi_station_response',
        {
          p_session_id: sessionId,
          p_prompt_order: 1,
          p_finalization_key: randomUUID(),
        },
      );
      assert.equal(repeatedError, null, repeatedError?.message);
      assert.deepEqual(repeated, finalized);

      const { data: earlyClaim, error: earlyClaimError } = await service.rpc(
        'claim_candidate_mmi_response_scoring',
        {
          p_user_id: owner.userId,
          p_session_id: sessionId,
          p_prompt_order: 1,
          p_lease_token: randomUUID(),
        },
      );
      assert.equal(earlyClaimError, null, earlyClaimError?.message);
      assert.deepEqual(earlyClaim, { status: 'not_ready' });

      for (const [index, elapsed] of [180, 300, 420, 540].entries()) {
        await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - elapsed * 1_000));
        const { data, error: phaseError } = await owner.client.rpc(
          'get_candidate_mmi_station_session',
          { p_session_id: sessionId },
        );
        assert.equal(phaseError, null, phaseError?.message);
        assertResponseProjection(data, index + 2, promptHashes[index + 1]!);
      }

      await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - 660_000));
      const { data: completed, error: completionError } = await owner.client.rpc(
        'get_candidate_mmi_station_session',
        { p_session_id: sessionId },
      );
      assert.equal(completionError, null, completionError?.message);
      assert.equal((completed as { phase: string }).phase, 'completed');

      const leaseToken = randomUUID();
      const { data: claim, error: claimError } = await service.rpc(
        'claim_candidate_mmi_response_scoring',
        {
          p_user_id: owner.userId,
          p_session_id: sessionId,
          p_prompt_order: 1,
          p_lease_token: leaseToken,
        },
      );
      assert.equal(claimError, null, claimError?.message);
      assert.deepEqual(Object.keys(claim as Record<string, unknown>).sort(), [
        'criteria',
        'promptOrder',
        'promptText',
        'responseId',
        'scenarioText',
        'scoringContractVersion',
        'sessionId',
        'status',
        'transcript',
      ].sort());
      assert.equal((claim as { status: string }).status, 'claimed');
      assert.equal((claim as { transcript: string }).transcript, transcript);
      assert.equal(sha256((claim as { promptText: string }).promptText), promptHashes[0]);
      assert.equal((claim as { scoringContractVersion: string }).scoringContractVersion, '2026-09-10.1');
      assert.equal(typeof (claim as { scenarioText: unknown }).scenarioText, 'string');
      const criteria = (claim as { criteria: Array<{ criterionId: string; bulletText: string; domain: string | null }> }).criteria;
      assert.ok(criteria.length > 0);
      const validAssessment = {
        schemaVersion: 3,
        questionScorePct: 0,
        criteria: criteria.map((criterion) => ({
          criterionId: criterion.criterionId,
          achieved: false,
          weightPct: Number((100 / criteria.length).toFixed(2)),
        })),
      };
      const usage = {
        provider: 'anthropic', model: 'local-contract-test', inputTokens: 1,
        cachedInputTokens: 0, outputTokens: 1, inputRatePerMillion: 0,
        cachedInputRatePerMillion: 0, outputRatePerMillion: 0, currency: 'USD',
        estimatedCost: '0.00000000', latencyMs: 1, outcome: 'scored',
      } as const;

      const responseId = (claim as { responseId: string }).responseId;
      const { data: scored, error: scoreError } = await service.rpc(
        'complete_candidate_mmi_response_scoring',
        {
          p_response_id: responseId,
          p_session_id: sessionId,
          p_lease_token: leaseToken,
          p_public_assessment: validAssessment,
          p_usage: usage,
        },
      );
      assert.equal(scoreError, null, scoreError?.message);
      assert.deepEqual(scored, { status: 'scored' });

      const { data: feedback, error: feedbackError } = await owner.client.rpc(
        'get_candidate_mmi_station_feedback',
        { p_session_id: sessionId },
      );
      assert.equal(feedbackError, null, feedbackError?.message);
      assert.deepEqual(feedback, [
        { promptOrder: 1, status: 'scored', legacy: false, assessment: {
          schemaVersion: 3, questionScorePct: 0,
          criteria: criteria.map((criterion) => ({
            criterionId: criterion.criterionId, achieved: false,
            weightPct: Number((100 / criteria.length).toFixed(2)),
            bulletText: criterion.bulletText, domain: criterion.domain,
          })),
        } },
        { promptOrder: 2, status: 'no_response', legacy: false, assessment: null },
        { promptOrder: 3, status: 'no_response', legacy: false, assessment: null },
        { promptOrder: 4, status: 'no_response', legacy: false, assessment: null },
        { promptOrder: 5, status: 'no_response', legacy: false, assessment: null },
      ]);

      const { data: otherFeedback, error: otherFeedbackError } = await other.client.rpc(
        'get_candidate_mmi_station_feedback',
        { p_session_id: sessionId },
      );
      assert.equal(otherFeedback, null);
      assert.ok(otherFeedbackError);

      const { data: immediatelyErased, error: immediateReadError } = await service
        .from('candidate_mmi_station_responses')
        .select('finalized_transcript,public_assessment,transcript_purged_at')
        .eq('id', responseId)
        .single();
      assert.equal(immediateReadError, null, immediateReadError?.message);
      assert.equal(immediatelyErased?.finalized_transcript, null);
      assert.deepEqual(immediatelyErased?.public_assessment, validAssessment);
      assert.ok(immediatelyErased?.transcript_purged_at);

      const { data: purgeResult, error: purgeError } = await service.rpc(
        'purge_expired_candidate_mmi_free_text',
        { p_now: new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000).toISOString() },
      );
      assert.equal(purgeError, null, purgeError?.message);
      assert.equal((purgeResult as { purged: number }).purged, 0);
      const { data: purged, error: purgeReadError } = await service
        .from('candidate_mmi_station_responses')
        .select('finalized_transcript,public_assessment,transcript_purged_at')
        .eq('id', responseId)
        .single();
      assert.equal(purgeReadError, null, purgeReadError?.message);
      assert.equal(purged?.finalized_transcript, null);
      assert.deepEqual(purged?.public_assessment, validAssessment);
      assert.ok(purged?.transcript_purged_at);
    } finally {
      await deleteSession(sessionId);
    }
  });

  it('throttles transcript checkpoints and keeps abandonment owner-only and idempotent', async () => {
    const { data: started, error } = await owner.client.rpc('start_candidate_mmi_station_session');
    assert.equal(error, null, error?.message);
    const sessionId = (started as { sessionId: string }).sessionId;

    try {
      await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - 60_000));
      for (let revision = 1; revision <= 5; revision += 1) {
        const { error: checkpointError } = await owner.client.rpc(
          'checkpoint_candidate_mmi_station_response',
          {
            p_session_id: sessionId,
            p_prompt_order: 1,
            p_transcript: `Checkpoint ${revision}`,
            p_client_revision: revision,
          },
        );
        assert.equal(checkpointError, null, checkpointError?.message);
      }
      const { data: throttled, error: throttledError } = await owner.client.rpc(
        'checkpoint_candidate_mmi_station_response',
        {
          p_session_id: sessionId,
          p_prompt_order: 1,
          p_transcript: 'Checkpoint 6',
          p_client_revision: 6,
        },
      );
      assert.equal(throttled, null);
      assert.match(throttledError?.message ?? '', /candidate_checkpoint_rate_limited/i);

      await new Promise(resolve => setTimeout(resolve, 1_100));
      const { error: recoveredError } = await owner.client.rpc(
        'checkpoint_candidate_mmi_station_response',
        {
          p_session_id: sessionId,
          p_prompt_order: 1,
          p_transcript: 'Checkpoint after the quota window.',
          p_client_revision: 7,
        },
      );
      assert.equal(recoveredError, null, recoveredError?.message);

      const { error: otherAbandonError } = await other.client.rpc(
        'abandon_candidate_mmi_station_session',
        { p_session_id: sessionId },
      );
      assert.ok(otherAbandonError);
      const { error: firstAbandonError } = await owner.client.rpc(
        'abandon_candidate_mmi_station_session',
        { p_session_id: sessionId },
      );
      const { error: secondAbandonError } = await owner.client.rpc(
        'abandon_candidate_mmi_station_session',
        { p_session_id: sessionId },
      );
      assert.equal(firstAbandonError, null, firstAbandonError?.message);
      assert.equal(secondAbandonError, null, secondAbandonError?.message);
    } finally {
      await deleteSession(sessionId);
    }
  });

  it('denies direct browser reads of private station and transcript tables', async () => {
    for (const table of [
      'mmi_stations',
      'mmi_sub_questions',
      'mmi_marking_criteria',
      'mmi_panel_questions',
      'mmi_station_versions',
      'candidate_mmi_station_sessions',
      'candidate_mmi_station_prompt_snapshots',
      'candidate_mmi_station_response_drafts',
      'candidate_mmi_station_responses',
      'candidate_mmi_response_scoring_claims',
    ]) {
      const { data, error } = await owner.client.from(table).select('*').limit(1);
      assert.equal(data, null, `expected no direct rows from ${table}`);
      assert.equal(error?.code, '42501', `expected direct access denial for ${table}`);
    }

    const anonymous = createClient(url!, anonKey!, { auth: { persistSession: false } });
    for (const table of ['mmi_marking_criteria', 'mmi_panel_questions', 'mmi_station_versions']) {
      const { data, error } = await anonymous.from(table).select('*').limit(1);
      assert.equal(data, null, `expected no anonymous rows from ${table}`);
      assert.equal(error?.code, '42501', `expected anonymous access denial for ${table}`);
    }
  });
});
