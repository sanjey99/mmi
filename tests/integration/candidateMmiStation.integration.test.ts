import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { parseMmiRubric } from '../../supabase/functions/_shared/mmiContracts';
import {
  activateVerifiedFlatMmiQuestionSet,
  elevateLocalProfileToAdmin,
  setCandidateSessionStartedAt,
} from './localDatabaseFixture';
import { canRunLocalProfileElevationTests } from './mutationTestSafety';

const root = process.cwd();
const migrationPath = `${root}/supabase/migrations/20260826000000_normalized_mmi_station_orchestration.sql`;
const browserSpeechMigrationPath = `${root}/supabase/migrations/20260831000000_candidate_mmi_browser_speech.sql`;
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
const normalizedManifestSha256 = 'd5410fe8b21130737b80fb02be8de024889c33065303cbafd104f332e7f31edb';
const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const run = describe.runIf(canRunLocalProfileElevationTests(process.env));
const fixturePrefix = `candidate-mmi-${randomUUID().slice(0, 8)}`;
const password = `Local-only-${randomUUID()}!`;
const scoringContractModulePath = '../../supabase/functions/_shared/mmiScoringContract';
const loadCurrentScoringContract = async (): Promise<unknown> => {
  const contractModule = await import(scoringContractModulePath) as {
    CURRENT_MMI_SCORING_CONTRACT_VERSION: string;
    createMmiScoringContractSnapshot: (version: string) => unknown;
  };
  return contractModule.createMmiScoringContractSnapshot(contractModule.CURRENT_MMI_SCORING_CONTRACT_VERSION);
};
const validRubric = {
  version: 1,
  criteria: {
    'clear-priorities': {
      dimension: 'structure', kind: 'strength',
      assessorCriterion: 'Sets out priorities in a clear order.', studentFeedback: 'clear-priorities',
    },
    'explicit-safety-netting': {
      dimension: 'ethics', kind: 'improvement',
      assessorCriterion: 'Explains when to escalate safety concerns.', studentFeedback: 'explicit-safety-netting',
    },
  },
  dimensionWeights: { structure: 0.2, ethics: 0.2, communication: 0.2, reflection: 0.2, nhs_awareness: 0.2 },
  safetyCriticalItems: [],
} as const;
const validAssessment = {
  dimensions: {
    structure: { score: 4, applicable: true, evidence: null, improvement: null },
    ethics: { score: 3, applicable: true, evidence: null, improvement: null },
    communication: { score: null, applicable: false, evidence: null, improvement: null },
    reflection: { score: null, applicable: false, evidence: null, improvement: null },
    nhs_awareness: { score: null, applicable: false, evidence: null, improvement: null },
  },
  overallPct: 70,
  strengths: ['clear-priorities'],
  improvements: ['explicit-safety-netting'],
  improvementTip: 'Make the safety-netting steps explicit, including when and how you would escalate.',
  rubricVersion: 1,
} as const;

type CandidatePayload = {
  artifact_version: number;
  source_namespace: string;
  source_manifest_sha256: string;
  stations: Array<{
    station_id: string;
    sub_questions: Array<{ sub_q_id: string; order_num: number; source_flat_id: string; question_text: string }>;
  }>;
};

type FinalizationProof = {
  candidateStationCount: number;
  candidateSubQuestionCount: number;
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

let parseQuestionCsv: (csvText: string) => ParsedFlatCsv;
let importQuestionRows: (client: SupabaseClient, rows: readonly Record<string, unknown>[]) => Promise<ImportedQuestionBatch>;

function readMigration(): string {
  assert.ok(existsSync(migrationPath), `expected normalized candidate station migration: ${migrationPath}`);
  return readFileSync(migrationPath, 'utf8');
}

function readBrowserSpeechMigration(): string {
  assert.ok(existsSync(browserSpeechMigrationPath), `expected browser-speech candidate station migration: ${browserSpeechMigrationPath}`);
  return readFileSync(browserSpeechMigrationPath, 'utf8');
}

function readFlatImportBatches() {
  return flatCsvPaths.map(csvPath => {
    assert.ok(existsSync(csvPath), `expected ignored local flat import artifact: ${csvPath}`);
    const parsed = parseQuestionCsv(readFileSync(csvPath, 'utf8'));
    assert.equal(parsed.errors.length, 0, 'expected verified flat CSV parse to succeed');
    return parsed.rows.map(row => row.value);
  });
}

function readNormalizedPayloads(): CandidatePayload[] {
  return normalizedPayloadPaths.map(payloadPath => {
    assert.ok(existsSync(payloadPath), `expected ignored local normalized payload: ${payloadPath}`);
    return JSON.parse(readFileSync(payloadPath, 'utf8')) as CandidatePayload;
  });
}

function readNormalizedManifest(): NormalizedManifest {
  assert.ok(existsSync(normalizedManifestPath), `expected tracked normalized manifest: ${normalizedManifestPath}`);
  const rawManifest = readFileSync(normalizedManifestPath);
  assert.equal(createHash('sha256').update(rawManifest).digest('hex'), normalizedManifestSha256);
  return JSON.parse(rawManifest.toString('utf8')) as NormalizedManifest;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertResponseProjection(
  value: unknown,
  expectedPromptOrder: number,
  expectedPromptHash: string,
  otherPromptHashes: readonly string[],
): void {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const projection = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(projection).sort(), [
    'draftRevision', 'draftTranscript', 'phase', 'phaseEndsAt', 'phaseStartedAt', 'promptOrder', 'promptText',
    'responseStatus', 'serverNow', 'sessionId', 'stationId',
  ].sort());
  assert.equal(projection.phase, 'response');
  assert.equal(projection.promptOrder, expectedPromptOrder);
  assert.equal(typeof projection.promptText, 'string');
  const currentPromptHash = sha256(projection.promptText as string);
  assert.equal(currentPromptHash, expectedPromptHash);
  assert.equal(otherPromptHashes.includes(currentPromptHash), false);
  assert.equal(projection.responseStatus, 'open');
  assert.equal(typeof projection.draftTranscript, 'string');
  assert.equal(typeof projection.draftRevision, 'number');
}

function assertCompletedProjection(value: unknown): void {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const projection = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(projection).sort(), [
    'phase', 'phaseEndsAt', 'phaseStartedAt', 'serverNow', 'sessionId', 'stationId',
  ].sort());
  assert.equal(projection.phase, 'completed');
  assert.equal(projection.phaseEndsAt, null);
}

async function createAuthenticatedClient(service: SupabaseClient, label: string, isAdmin = false) {
  const email = `${fixturePrefix}-${label}@example.test`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(error, null, error?.message);
  assert.ok(data.user);
  if (isAdmin) {
    await elevateLocalProfileToAdmin(data.user.id);
  }
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  assert.equal(signInError, null, signInError?.message);
  return { client, userId: data.user.id };
}

describe('normalized candidate station migration contract', () => {
  it('requires the additive migration before any local database behavior can be trusted', () => {
    const sql = readMigration();
    assert.match(sql, /candidate_mmi_station_sessions/i);
    assert.match(sql, /current_phase_only/i);
    assert.match(sql, /start_candidate_mmi_station_session\s*\(\s*\)/i);
    assert.doesNotMatch(sql, /start_candidate_mmi_station_session\s*\(\s*p_station_id/i);
  });

  it('requires the browser-speech forward migration before transcript persistence behavior can be trusted', () => {
    const sql = readBrowserSpeechMigration();
    assert.match(sql, /checkpoint_candidate_mmi_station_response/i);
    assert.match(sql, /candidate_mmi_station_response_drafts/i);
  });
});

run('normalized candidate MMI station orchestration (disposable local Supabase only)', () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let other: SupabaseClient;
  const authUserIds: string[] = [];
  let promptHashesByStation: Record<string, readonly string[]>;
  let promptIdsByStation: Record<string, readonly string[]>;
  let finalizationProof: FinalizationProof;
  let artifactSha256ByBatch: Record<string, string>;
  const fixtureNoticeVersion = `${fixturePrefix}-fixed-days`;
  const approvedRubricSubQuestionIds: string[] = [];

  async function createApprovedCandidateRubrics() {
    const rows = Object.values(promptIdsByStation).flatMap(promptIds => promptIds.map((subQuestionId) => ({
      standard_sub_q_id: subQuestionId,
      version: 1,
      status: 'active',
      criteria: validRubric.criteria,
      dimension_weights: validRubric.dimensionWeights,
      safety_critical_items: validRubric.safetyCriticalItems,
      clinician_reviewed_at: new Date().toISOString(),
      clinician_reviewed_by: authUserIds[1],
    })));
    approvedRubricSubQuestionIds.push(...rows.map(row => row.standard_sub_q_id));
    const { error } = await service.from('mmi_scoring_rubrics').insert(rows);
    assert.equal(error, null, error?.message);
  }

  async function setFeatureFlag(value: 'true' | 'false') {
    const { error } = await admin
      .from('app_config')
      .upsert({ key: 'normalized_mmi_station_enabled', value });
    assert.equal(error, null, error?.message);
  }

  beforeAll(async () => {
    ({ parseQuestionCsv } = await import('../../src/features/questions/csv' + '.ts') as {
      parseQuestionCsv: (csvText: string) => ParsedFlatCsv;
    });
    ({ importQuestionRows } = await import('../../src/features/questions/api' + '.ts') as {
      importQuestionRows: (client: SupabaseClient, rows: readonly Record<string, unknown>[]) => Promise<ImportedQuestionBatch>;
    });
    service = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });
    const createdAdmin = await createAuthenticatedClient(service, 'admin', true);
    const createdOwner = await createAuthenticatedClient(service, 'owner');
    const createdOther = await createAuthenticatedClient(service, 'other');
    admin = createdAdmin.client;
    owner = createdOwner.client;
    other = createdOther.client;
    authUserIds.push(createdAdmin.userId, createdOwner.userId, createdOther.userId);

    const flatImportBatches = readFlatImportBatches();
    const importedFlatBatches = await Promise.all(flatImportBatches.map(rows => importQuestionRows(admin, rows)));
    assert.equal(importedFlatBatches.reduce((count, result) => count + result.ids.length, 0), 785);
    await activateVerifiedFlatMmiQuestionSet();

    const normalizedManifest = readNormalizedManifest();
    for (const payloadPath of normalizedPayloadPaths) {
      const artifactName = payloadPath.split('/').at(-1) ?? '';
      const artifact = normalizedManifest.private_artifacts[artifactName];
      assert.ok(artifact, `expected manifest entry for normalized payload artifact: ${artifactName}`);
      assert.equal(
        createHash('sha256').update(readFileSync(payloadPath)).digest('hex'),
        artifact.sha256,
        `expected normalized payload file hash to match its manifest entry: ${artifactName}`,
      );
      assert.match(artifact.canonical_jsonb_payload_sha256, /^[a-f0-9]{64}$/);
    }
    artifactSha256ByBatch = Object.fromEntries(
      normalizedPayloadPaths.map((payloadPath, index) => [
        `normalized-stations-part-${index + 1}`,
        normalizedManifest.private_artifacts[payloadPath.split('/').at(-1) ?? '']?.sha256,
      ]),
    );
    assert.equal(Object.values(artifactSha256ByBatch).every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)), true);
    const payloads = readNormalizedPayloads();
    const stationCount = payloads.reduce((count, payload) => count + payload.stations.length, 0);
    const promptCount = payloads.reduce(
      (count, payload) => count + payload.stations.reduce((total, station) => total + station.sub_questions.length, 0),
      0,
    );
    assert.equal(stationCount, 155);
    assert.equal(promptCount, 775);
    assert.equal(payloads.every(payload => payload.source_namespace === sourceNamespace), true);
    assert.equal(payloads.every(payload => payload.source_manifest_sha256 === sourceManifestSha256), true);
    assert.equal(payloads.every(payload => payload.stations.every(station => station.sub_questions.map(question => question.order_num).join(',') === '1,2,3,4,5')), true);
    promptHashesByStation = Object.fromEntries(payloads.flatMap(payload => payload.stations.map(station => [
      station.station_id,
      station.sub_questions.map(question => sha256(question.question_text)),
    ])));
    promptIdsByStation = Object.fromEntries(payloads.flatMap(payload => payload.stations.map(station => [
      station.station_id,
      station.sub_questions.map(question => question.sub_q_id),
    ])));
    assert.equal(Object.keys(promptHashesByStation).length, 155);
    assert.equal(Object.values(promptHashesByStation).every(promptHashes => promptHashes.length === 5), true);
    assert.equal(Object.values(promptIdsByStation).every(promptIds => promptIds.length === 5), true);

    const { error: deactivateNoticeError } = await service
      .from('mmi_privacy_notices')
      .update({ is_active: false })
      .eq('is_active', true);
    assert.equal(deactivateNoticeError, null, deactivateNoticeError?.message);
    const { error: noticeError } = await service.from('mmi_privacy_notices').insert({
      version: fixtureNoticeVersion,
      processor_name: 'Synthetic local browser-speech processor',
      notice_text: 'Synthetic local browser-speech fixed-retention notice.',
      retention_mode: 'fixed_days',
      retention_days: 1,
      published_at: new Date().toISOString(),
      is_active: true,
    });
    assert.equal(noticeError, null, noticeError?.message);

    const alteredPartOne = JSON.parse(JSON.stringify(payloads[0])) as CandidatePayload;
    const alteredQuestion = alteredPartOne.stations[0]?.sub_questions[0];
    assert.ok(alteredQuestion, 'expected the verified first payload to contain a first sub-question');
    alteredQuestion.question_text = 'Synthetic altered candidate payload content.';
    assert.equal(alteredPartOne.stations.length, payloads[0]!.stations.length);
    assert.equal(
      alteredPartOne.stations.reduce((count, station) => count + station.sub_questions.length, 0),
      payloads[0]!.stations.reduce((count, station) => count + station.sub_questions.length, 0),
    );
    const { error: alteredPayloadError } = await service.rpc('import_normalized_mmi_station_batch', {
      p_batch_id: 'normalized-stations-part-1',
      p_normalized_manifest_sha256: normalizedManifestSha256,
      p_artifact_sha256: artifactSha256ByBatch['normalized-stations-part-1'],
      p_payload: alteredPartOne,
    });
    assert.ok(alteredPayloadError, 'expected a payload clone with the genuine artifact label to be rejected before import');

    for (const [index, payload] of payloads.entries()) {
      const batchId = `normalized-stations-part-${index + 1}`;
      const { error } = await service.rpc('import_normalized_mmi_station_batch', {
        p_batch_id: batchId,
        p_normalized_manifest_sha256: normalizedManifestSha256,
        p_artifact_sha256: artifactSha256ByBatch[batchId],
        p_payload: payload,
      });
      assert.equal(error, null, error?.message);
    }
    const { data, error: finalizeError } = await service.rpc('finalize_normalized_mmi_station_import', {
      p_source_namespace: sourceNamespace,
      p_source_manifest_sha256: sourceManifestSha256,
      p_normalized_manifest_sha256: normalizedManifestSha256,
    });
    assert.equal(finalizeError, null, finalizeError?.message);
    finalizationProof = data as FinalizationProof;
  });

  afterAll(async () => {
    if (!service) return;
    if (admin) await setFeatureFlag('false');
    if (approvedRubricSubQuestionIds.length) {
      for (let index = 0; index < approvedRubricSubQuestionIds.length; index += 100) {
        const { error } = await service
          .from('mmi_scoring_rubrics')
          .delete()
          .in('standard_sub_q_id', approvedRubricSubQuestionIds.slice(index, index + 100));
        assert.equal(error, null, error?.message);
      }
    }
    for (const userId of authUserIds) {
      const { error } = await service.auth.admin.deleteUser(userId);
      assert.equal(error, null, error?.message);
    }
    const { error: noticeError } = await service
      .from('mmi_privacy_notices')
      .delete()
      .eq('version', fixtureNoticeVersion);
    assert.equal(noticeError, null, noticeError?.message);
  });

  it('returns only the fixed metadata proof for 155/775/10 normalization and 785 active flat rows', async () => {
    assert.deepEqual(finalizationProof, {
      candidateStationCount: 155,
      candidateSubQuestionCount: 775,
      validStationCount: 155,
      invalidStationCount: 0,
      excludedPanelQuestionCount: 10,
      panelSubQuestionCount: 0,
      preservedActiveFlatQuestionCount: 785,
    });

  });

  it('fails closed for invalid provenance, hashes, batch identity, prompt ordering, timing, panels, and flat-row links', async () => {
    const invalidCases = [
      { p_batch_id: 'missing-provenance', p_payload: {} },
      { p_batch_id: 'bad-normalized-manifest', p_normalized_manifest_sha256: '0'.repeat(64), p_artifact_sha256: artifactSha256ByBatch['normalized-stations-part-1'], p_payload: { source_namespace: sourceNamespace, source_manifest_sha256: sourceManifestSha256, stations: [] } },
      { p_batch_id: 'bad-artifact-hash', p_normalized_manifest_sha256: normalizedManifestSha256, p_artifact_sha256: '0'.repeat(64), p_payload: { source_namespace: sourceNamespace, source_manifest_sha256: sourceManifestSha256, stations: [] } },
      { p_batch_id: 'unverified-batch', p_normalized_manifest_sha256: normalizedManifestSha256, p_artifact_sha256: artifactSha256ByBatch['normalized-stations-part-1'], p_payload: { source_namespace: sourceNamespace, source_manifest_sha256: sourceManifestSha256, stations: [] } },
      { p_batch_id: 'bad-hash', p_normalized_manifest_sha256: normalizedManifestSha256, p_artifact_sha256: artifactSha256ByBatch['normalized-stations-part-1'], p_payload: { source_namespace: sourceNamespace, source_manifest_sha256: '0'.repeat(64), stations: [] } },
      { p_batch_id: 'panel', p_normalized_manifest_sha256: normalizedManifestSha256, p_artifact_sha256: artifactSha256ByBatch['normalized-stations-part-1'], p_payload: { source_namespace: sourceNamespace, source_manifest_sha256: sourceManifestSha256, stations: [{ station_id: 'PANEL_999', sub_questions: [] }] } },
      { p_batch_id: 'bad-order', p_normalized_manifest_sha256: normalizedManifestSha256, p_artifact_sha256: artifactSha256ByBatch['normalized-stations-part-1'], p_payload: { source_namespace: sourceNamespace, source_manifest_sha256: sourceManifestSha256, stations: [{ station_id: 'MMI_999', prep_time_sec: 60, sub_questions: [{ order_num: 2, time_limit_sec: 120, source_flat_id: 'MMI_999/MMI_999_Q2' }] }] } },
      { p_batch_id: 'bad-timing', p_normalized_manifest_sha256: normalizedManifestSha256, p_artifact_sha256: artifactSha256ByBatch['normalized-stations-part-1'], p_payload: { source_namespace: sourceNamespace, source_manifest_sha256: sourceManifestSha256, stations: [{ station_id: 'MMI_998', prep_time_sec: 61, sub_questions: [{ order_num: 1, time_limit_sec: 119, source_flat_id: 'MMI_998/MMI_998_Q1' }] }] } },
      { p_batch_id: 'bad-flat-link', p_normalized_manifest_sha256: normalizedManifestSha256, p_artifact_sha256: artifactSha256ByBatch['normalized-stations-part-1'], p_payload: { source_namespace: sourceNamespace, source_manifest_sha256: sourceManifestSha256, stations: [{ station_id: 'MMI_997', prep_time_sec: 60, sub_questions: [{ order_num: 1, time_limit_sec: 120, source_flat_id: 'MMI_997/MMI_996_Q1' }] }] } },
    ];
    for (const input of invalidCases) {
      const { error } = await service.rpc('import_normalized_mmi_station_batch', input);
      assert.ok(error, `expected import rejection for ${input.p_batch_id}`);
    }
  });

  it('fails closed while disabled, resumes immutable state, and exposes only each current response prompt', async () => {
    const { data: disabled, error: disabledError } = await owner.rpc('start_candidate_mmi_station_session');
    assert.equal(disabled, null);
    assert.ok(disabledError, 'expected feature-disabled start to fail closed');
    await setFeatureFlag('true');

    const { data: started, error: startError } = await owner.rpc('start_candidate_mmi_station_session');
    assert.equal(startError, null, startError?.message);
    assert.ok(started);
    const sessionId = (started as { sessionId: string }).sessionId;
    const { data: refreshed, error: refreshError } = await owner.rpc('get_candidate_mmi_station_session', { p_session_id: sessionId });
    assert.equal(refreshError, null, refreshError?.message);
    assert.ok(refreshed);
    assert.equal((refreshed as { sessionId: string }).sessionId, sessionId);
    assert.equal((refreshed as { phaseStartedAt: string }).phaseStartedAt, (started as { phaseStartedAt: string }).phaseStartedAt);

    const startedStationId = (started as { stationId: string }).stationId;
    const expectedPromptHashes = promptHashesByStation[startedStationId];
    assert.ok(expectedPromptHashes, 'server-selected station must be present in the private in-memory payload map');
    for (const [index, elapsedSeconds] of [60, 180, 300, 420, 540].entries()) {
      await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - elapsedSeconds * 1_000));
      const { data: response, error: responseError } = await owner.rpc('get_candidate_mmi_station_session', { p_session_id: sessionId });
      assert.equal(responseError, null, responseError?.message);
      assertResponseProjection(
        response,
        index + 1,
        expectedPromptHashes[index]!,
        expectedPromptHashes.filter((_hash, promptIndex) => promptIndex !== index),
      );
    }

    const { data: resumed, error: resumeError } = await owner.rpc('start_candidate_mmi_station_session');
    assert.equal(resumeError, null, resumeError?.message);
    assert.equal((resumed as { sessionId: string }).sessionId, sessionId);
    assertResponseProjection(resumed, 5, expectedPromptHashes[4]!, expectedPromptHashes.slice(0, 4));

    const { data: otherRead, error: otherReadError } = await other.rpc('get_candidate_mmi_station_session', { p_session_id: sessionId });
    assert.equal(otherRead, null);
    assert.ok(otherReadError, 'expected non-owner session read to be denied');
  });

  it('denies direct student table reads, projects completion safely, and makes leave idempotent', async () => {
    const { data: directStations, error: directStationError } = await owner.from('mmi_stations').select('station_id').limit(1);
    assert.equal(directStations, null);
    assert.equal(directStationError?.code, '42501');
    const { data: directSessions, error: directSessionError } = await owner.from('candidate_mmi_station_sessions').select('id').limit(1);
    assert.equal(directSessions, null);
    assert.equal(directSessionError?.code, '42501');

    const { data: started, error: startError } = await owner.rpc('start_candidate_mmi_station_session');
    assert.equal(startError, null, startError?.message);
    const sessionId = (started as { sessionId: string }).sessionId;
    await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - 660_000));
    const { data: completed, error: completedError } = await owner.rpc('get_candidate_mmi_station_session', { p_session_id: sessionId });
    assert.equal(completedError, null, completedError?.message);
    assertCompletedProjection(completed);

    const { data: leaveSession, error: leaveStartError } = await owner.rpc('start_candidate_mmi_station_session');
    assert.equal(leaveStartError, null, leaveStartError?.message);
    const leaveSessionId = (leaveSession as { sessionId: string }).sessionId;
    assert.notEqual((leaveSession as { stationId: string }).stationId, (started as { stationId: string }).stationId);
    const { error: firstLeaveError } = await owner.rpc('abandon_candidate_mmi_station_session', { p_session_id: leaveSessionId });
    const { error: secondLeaveError } = await owner.rpc('abandon_candidate_mmi_station_session', { p_session_id: leaveSessionId });
    assert.equal(firstLeaveError, null, firstLeaveError?.message);
    assert.equal(secondLeaveError, null, secondLeaveError?.message);
  });

  it('persists only deadline-safe transcript drafts, leases scoring, and purges text by the snapped privacy notice', async () => {
    await setFeatureFlag('true');

    const { data: missingRubricStarted, error: missingRubricStartError } = await owner.rpc('start_candidate_mmi_station_session');
    assert.equal(missingRubricStartError, null, missingRubricStartError?.message);
    const missingRubricSessionId = (missingRubricStarted as { sessionId: string }).sessionId;
    await setCandidateSessionStartedAt(missingRubricSessionId, new Date(Date.now() - 60_000));
    const { error: missingRubricDraftError } = await owner.rpc('checkpoint_candidate_mmi_station_response', {
      p_session_id: missingRubricSessionId,
      p_prompt_order: 1,
      p_transcript: 'Synthetic transcript without an approved rubric.',
      p_client_revision: 1,
    });
    assert.equal(missingRubricDraftError, null, missingRubricDraftError?.message);
    await setCandidateSessionStartedAt(missingRubricSessionId, new Date(Date.now() - 660_000));
    const { error: missingRubricCompletionError } = await owner.rpc('get_candidate_mmi_station_session', {
      p_session_id: missingRubricSessionId,
    });
    assert.equal(missingRubricCompletionError, null, missingRubricCompletionError?.message);
    const { data: missingRubricFeedback, error: missingRubricFeedbackError } = await owner.rpc('get_candidate_mmi_station_feedback', {
      p_session_id: missingRubricSessionId,
    });
    assert.equal(missingRubricFeedbackError, null, missingRubricFeedbackError?.message);
    assert.deepEqual((missingRubricFeedback as Array<Record<string, unknown>>)[0], {
      promptOrder: 1,
      status: 'feedback_unavailable',
      assessment: null,
    });

    await createApprovedCandidateRubrics();

    const { data: started, error: startError } = await owner.rpc('start_candidate_mmi_station_session');
    assert.equal(startError, null, startError?.message);
    const sessionId = (started as { sessionId: string }).sessionId;
    await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - 60_000));
    const { data: currentResponse, error: currentResponseError } = await owner.rpc('get_candidate_mmi_station_session', {
      p_session_id: sessionId,
    });
    assert.equal(currentResponseError, null, currentResponseError?.message);
    assertResponseProjection(currentResponse, 1,
      promptHashesByStation[(started as { stationId: string }).stationId]![0]!,
      promptHashesByStation[(started as { stationId: string }).stationId]!.slice(1));

    const transcript = 'Synthetic manual transcript with preserved line breaks.\nSecond line.';
    const { data: otherCheckpoint, error: otherCheckpointError } = await other.rpc('checkpoint_candidate_mmi_station_response', {
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_transcript: transcript,
      p_client_revision: 1,
    });
    assert.equal(otherCheckpoint, null);
    assert.ok(otherCheckpointError, 'expected non-owner checkpoint denial');

    const { data: checkpoint, error: checkpointError } = await owner.rpc('checkpoint_candidate_mmi_station_response', {
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_transcript: transcript,
      p_client_revision: 2,
    });
    assert.equal(checkpointError, null, checkpointError?.message);
    assert.deepEqual(Object.keys(checkpoint as Record<string, unknown>).sort(), [
      'acceptedAt', 'draftRevision', 'promptOrder', 'sessionId',
    ]);
    assert.equal((checkpoint as { draftRevision: number }).draftRevision, 2);
    for (const p_client_revision of [1, 2]) {
      const { data, error } = await owner.rpc('checkpoint_candidate_mmi_station_response', {
        p_session_id: sessionId,
        p_prompt_order: 1,
        p_transcript: `stale revision ${p_client_revision}`,
        p_client_revision,
      });
      assert.equal(data, null);
      assert.ok(error, `expected stale/equal revision ${p_client_revision} rejection`);
    }
    for (const p_prompt_order of [2, 6]) {
      const { data, error } = await owner.rpc('checkpoint_candidate_mmi_station_response', {
        p_session_id: sessionId,
        p_prompt_order,
        p_transcript: 'wrong prompt',
        p_client_revision: 3,
      });
      assert.equal(data, null);
      assert.ok(error, `expected non-current prompt ${p_prompt_order} rejection`);
    }
    const { data: tooLongDraft, error: tooLongDraftError } = await owner.rpc('checkpoint_candidate_mmi_station_response', {
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_transcript: '𐐷'.repeat(12_001),
      p_client_revision: 3,
    });
    assert.equal(tooLongDraft, null);
    assert.ok(tooLongDraftError, 'expected 12,001 Unicode code points to be rejected');

    const finalizationKey = randomUUID();
    const { data: earlyFinalize, error: earlyFinalizeError } = await owner.rpc('finalize_candidate_mmi_station_response', {
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_finalization_key: finalizationKey,
    });
    assert.equal(earlyFinalize, null);
    assert.ok(earlyFinalizeError, 'expected pre-deadline finalization rejection');
    const { data: otherFinalize, error: otherFinalizeError } = await other.rpc('finalize_candidate_mmi_station_response', {
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_finalization_key: randomUUID(),
    });
    assert.equal(otherFinalize, null);
    assert.ok(otherFinalizeError, 'expected non-owner finalization denial');

    await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - 180_000));
    const { data: finalized, error: finalizeError } = await owner.rpc('finalize_candidate_mmi_station_response', {
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_finalization_key: finalizationKey,
    });
    assert.equal(finalizeError, null, finalizeError?.message);
    assert.deepEqual(Object.keys(finalized as Record<string, unknown>).sort(), [
      'finalizedAt', 'promptOrder', 'responseState', 'scoringStatus', 'sessionId',
    ]);
    assert.equal((finalized as { responseState: string }).responseState, 'response');
    assert.equal((finalized as { scoringStatus: string }).scoringStatus, 'pending');
    const { data: retryFinalized, error: retryFinalizeError } = await owner.rpc('finalize_candidate_mmi_station_response', {
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_finalization_key: randomUUID(),
    });
    assert.equal(retryFinalizeError, null, retryFinalizeError?.message);
    assert.deepEqual(retryFinalized, finalized);
    const { data: lateCheckpoint, error: lateCheckpointError } = await owner.rpc('checkpoint_candidate_mmi_station_response', {
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_transcript: 'late replacement',
      p_client_revision: 3,
    });
    assert.equal(lateCheckpoint, null);
    assert.ok(lateCheckpointError, 'expected post-deadline checkpoint rejection');
    const { data: directDraft, error: directDraftError } = await owner
      .from('candidate_mmi_station_response_drafts')
      .select('transcript')
      .eq('session_id', sessionId);
    assert.equal(directDraft, null);
    assert.equal(directDraftError?.code, '42501');
    const { data: nextResponse, error: nextResponseError } = await owner.rpc('get_candidate_mmi_station_session', {
      p_session_id: sessionId,
    });
    assert.equal(nextResponseError, null, nextResponseError?.message);
    assert.equal((nextResponse as { promptOrder: number }).promptOrder, 2);
    assert.equal((nextResponse as { draftTranscript: string }).draftTranscript, '');
    assert.equal(JSON.stringify(nextResponse).includes(transcript), false);

    const leaseToken = randomUUID();
    const { data: wrongUserClaim, error: wrongUserClaimError } = await service.rpc('claim_candidate_mmi_response_scoring', {
      p_user_id: authUserIds[2],
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_lease_token: leaseToken,
    });
    assert.equal(wrongUserClaim, null);
    assert.ok(wrongUserClaimError, 'expected a different user UUID to be unable to claim this response');
    const { data: claim, error: claimError } = await service.rpc('claim_candidate_mmi_response_scoring', {
      p_user_id: authUserIds[1],
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_lease_token: leaseToken,
    });
    assert.equal(claimError, null, claimError?.message);
    assert.deepEqual(Object.keys(claim as Record<string, unknown>).sort(), [
      'promptOrder', 'promptText', 'responseId', 'rubric', 'scoringContract', 'sessionId', 'status', 'transcript',
    ]);
    assert.equal((claim as { status: string }).status, 'claimed');
    assert.equal((claim as { sessionId: string }).sessionId, sessionId);
    assert.equal((claim as { promptOrder: number }).promptOrder, 1);
    assert.equal((claim as { transcript: string }).transcript, transcript);
    assert.deepEqual(parseMmiRubric((claim as { rubric: unknown }).rubric), validRubric);
    assert.deepEqual(
      (claim as { scoringContract: unknown }).scoringContract,
      await loadCurrentScoringContract(),
    );
    const responseId = (claim as { responseId: string }).responseId;
    const { data: duplicateClaim, error: duplicateClaimError } = await service.rpc('claim_candidate_mmi_response_scoring', {
      p_user_id: authUserIds[1],
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_lease_token: randomUUID(),
    });
    assert.equal(duplicateClaimError, null, duplicateClaimError?.message);
    assert.equal((duplicateClaim as { status: string }).status, 'in_progress');
    const { error: expireLeaseError } = await service
      .from('candidate_mmi_response_scoring_claims')
      .update({ lease_expires_at: new Date(Date.now() - 1_000).toISOString() })
      .eq('response_id', responseId);
    assert.equal(expireLeaseError, null, expireLeaseError?.message);
    const reclaimedLeaseToken = randomUUID();
    const { data: reclaimedClaim, error: reclaimedClaimError } = await service.rpc('claim_candidate_mmi_response_scoring', {
      p_user_id: authUserIds[1],
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_lease_token: reclaimedLeaseToken,
    });
    assert.equal(reclaimedClaimError, null, reclaimedClaimError?.message);
    assert.equal((reclaimedClaim as { status: string }).status, 'claimed');
    const { data: staleCompletion, error: staleCompletionError } = await service.rpc('complete_candidate_mmi_response_scoring', {
      p_response_id: responseId,
      p_session_id: sessionId,
      p_lease_token: leaseToken,
      p_public_assessment: validAssessment,
    });
    assert.equal(staleCompletion, null);
    assert.ok(staleCompletionError, 'expected stale lease completion denial');
    const { error: staleFailureError } = await service.rpc('fail_candidate_mmi_response_scoring', {
      p_response_id: responseId,
      p_session_id: sessionId,
      p_lease_token: leaseToken,
      p_error_code: 'synthetic_stale_failure',
    });
    assert.ok(staleFailureError, 'expected stale lease failure denial');
    const { data: invalidCompletion, error: invalidCompletionError } = await service.rpc('complete_candidate_mmi_response_scoring', {
      p_response_id: responseId,
      p_session_id: sessionId,
      p_lease_token: reclaimedLeaseToken,
      p_public_assessment: { result: 'Synthetic provider prose must be rejected.' },
    });
    assert.equal(invalidCompletion, null);
    assert.ok(invalidCompletionError, 'expected invalid public assessment keys to be rejected');
    const assessment = validAssessment;
    const { data: completedClaim, error: completedClaimError } = await service.rpc('complete_candidate_mmi_response_scoring', {
      p_response_id: responseId,
      p_session_id: sessionId,
      p_lease_token: reclaimedLeaseToken,
      p_public_assessment: assessment,
    });
    assert.equal(completedClaimError, null, completedClaimError?.message);
    assert.equal((completedClaim as { status: string }).status, 'scored');

    const { error: whitespaceDraftError } = await owner.rpc('checkpoint_candidate_mmi_station_response', {
      p_session_id: sessionId,
      p_prompt_order: 2,
      p_transcript: ' \n\t ',
      p_client_revision: 1,
    });
    assert.equal(whitespaceDraftError, null, whitespaceDraftError?.message);
    await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - 300_000));
    const { data: whitespaceFinalized, error: whitespaceFinalizeError } = await owner.rpc('finalize_candidate_mmi_station_response', {
      p_session_id: sessionId,
      p_prompt_order: 2,
      p_finalization_key: randomUUID(),
    });
    assert.equal(whitespaceFinalizeError, null, whitespaceFinalizeError?.message);
    assert.equal((whitespaceFinalized as { responseState: string }).responseState, 'no_response');

    await setCandidateSessionStartedAt(sessionId, new Date(Date.now() - 660_000));
    const { error: completionError } = await owner.rpc('get_candidate_mmi_station_session', { p_session_id: sessionId });
    assert.equal(completionError, null, completionError?.message);
    const { data: feedback, error: feedbackError } = await owner.rpc('get_candidate_mmi_station_feedback', { p_session_id: sessionId });
    assert.equal(feedbackError, null, feedbackError?.message);
    assert.deepEqual(feedback, [
      { promptOrder: 1, status: 'scored', assessment },
      { promptOrder: 2, status: 'no_response', assessment: null },
      { promptOrder: 3, status: 'no_response', assessment: null },
      { promptOrder: 4, status: 'no_response', assessment: null },
      { promptOrder: 5, status: 'no_response', assessment: null },
    ]);
    const { data: otherFeedback, error: otherFeedbackError } = await other.rpc('get_candidate_mmi_station_feedback', {
      p_session_id: sessionId,
    });
    assert.equal(otherFeedback, null);
    assert.ok(otherFeedbackError, 'expected non-owner feedback denial');
    const { data: noResponseRows, error: noResponseRowsError } = await service
      .from('candidate_mmi_station_responses')
      .select('id')
      .eq('session_id', sessionId)
      .eq('prompt_order', 2);
    assert.equal(noResponseRowsError, null, noResponseRowsError?.message);
    assert.equal(noResponseRows?.length, 1);
    const { data: noResponseClaim, error: noResponseClaimError } = await service.rpc('claim_candidate_mmi_response_scoring', {
      p_user_id: authUserIds[1],
      p_session_id: sessionId,
      p_prompt_order: 2,
      p_lease_token: randomUUID(),
    });
    assert.equal(noResponseClaim, null);
    assert.ok(noResponseClaimError, 'expected no-response claim rejection');

    const { data: purgeResult, error: purgeError } = await service.rpc('purge_expired_candidate_mmi_free_text', {
      p_now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000).toISOString(),
    });
    assert.equal(purgeError, null, purgeError?.message);
    assert.equal((purgeResult as { purged: number }).purged >= 1, true);
    const { data: purgedResponse, error: purgedResponseError } = await service
      .from('candidate_mmi_station_responses')
      .select('finalized_transcript,public_assessment,transcript_purged_at')
      .eq('id', responseId)
      .single();
    assert.equal(purgedResponseError, null, purgedResponseError?.message);
    assert.equal(purgedResponse?.finalized_transcript, null);
    assert.deepEqual(purgedResponse?.public_assessment, assessment);
    assert.ok(purgedResponse?.transcript_purged_at);

    const { data: abandonStarted, error: abandonStartError } = await owner.rpc('start_candidate_mmi_station_session');
    assert.equal(abandonStartError, null, abandonStartError?.message);
    const abandonSessionId = (abandonStarted as { sessionId: string }).sessionId;
    await setCandidateSessionStartedAt(abandonSessionId, new Date(Date.now() - 60_000));
    const { error: abandonDraftError } = await owner.rpc('checkpoint_candidate_mmi_station_response', {
      p_session_id: abandonSessionId,
      p_prompt_order: 1,
      p_transcript: 'Synthetic draft that must be deleted on abandonment.',
      p_client_revision: 1,
    });
    assert.equal(abandonDraftError, null, abandonDraftError?.message);
    const { error: otherAbandonError } = await other.rpc('abandon_candidate_mmi_station_session', {
      p_session_id: abandonSessionId,
    });
    assert.ok(otherAbandonError, 'expected non-owner abandonment denial');
    const { error: abandonError } = await owner.rpc('abandon_candidate_mmi_station_session', {
      p_session_id: abandonSessionId,
    });
    assert.equal(abandonError, null, abandonError?.message);
    const { data: abandoned, error: abandonedError } = await owner.rpc('get_candidate_mmi_station_session', {
      p_session_id: abandonSessionId,
    });
    assert.equal(abandonedError, null, abandonedError?.message);
    assert.equal((abandoned as { phase: string }).phase, 'abandoned');
    const { data: abandonedDraft, error: abandonedDraftError } = await service
      .from('candidate_mmi_station_response_drafts')
      .select('session_id')
      .eq('session_id', abandonSessionId);
    assert.equal(abandonedDraftError, null, abandonedDraftError?.message);
    assert.deepEqual(abandonedDraft, []);
  });
});
