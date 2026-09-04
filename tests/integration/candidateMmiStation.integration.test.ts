import assert from 'node:assert/strict';
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
const normalizedManifestSha256 = 'd5410fe8b21130737b80fb02be8de024889c33065303cbafd104f332e7f31edb';
const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const run = describe.runIf(canRunLocalProfileElevationTests(process.env));
const fixturePrefix = `single-mmi-${randomUUID().slice(0, 8)}`;
const password = `Local-only-${randomUUID()}!`;

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
    scenario_text: string;
    sub_questions: Array<{
      sub_q_id: string;
      order_num: number;
      source_flat_id: string;
      question_text: string;
    }>;
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
type AuthenticatedClient = { client: SupabaseClient; userId: string };

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

    const { data, error } = await service.rpc('finalize_normalized_mmi_station_import', {
      p_source_namespace: sourceNamespace,
      p_source_manifest_sha256: sourceManifestSha256,
      p_normalized_manifest_sha256: normalizedManifestSha256,
    });
    assert.equal(error, null, error?.message);
    finalizationProof = data as FinalizationProof;

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

  it('imports exactly 155 stations and 775 ordered prompts', () => {
    assert.deepEqual(finalizationProof, {
      candidateStationCount: 155,
      candidateSubQuestionCount: 775,
      validStationCount: 155,
      invalidStationCount: 0,
      excludedPanelQuestionCount: 10,
      panelSubQuestionCount: 0,
      preservedActiveFlatQuestionCount: 785,
    });
    assert.equal(Object.keys(promptHashesByStation).length, 155);
    assert.equal(Object.values(promptHashesByStation).every(prompts => prompts.length === 5), true);
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
        'promptOrder',
        'promptText',
        'responseId',
        'sessionId',
        'status',
        'transcript',
      ].sort());
      assert.equal((claim as { status: string }).status, 'claimed');
      assert.equal((claim as { transcript: string }).transcript, transcript);
      assert.equal(sha256((claim as { promptText: string }).promptText), promptHashes[0]);

      const responseId = (claim as { responseId: string }).responseId;
      const { data: scored, error: scoreError } = await service.rpc(
        'complete_candidate_mmi_response_scoring',
        {
          p_response_id: responseId,
          p_session_id: sessionId,
          p_lease_token: leaseToken,
          p_public_assessment: validAssessment,
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
        { promptOrder: 1, status: 'scored', assessment: validAssessment },
        { promptOrder: 2, status: 'no_response', assessment: null },
        { promptOrder: 3, status: 'no_response', assessment: null },
        { promptOrder: 4, status: 'no_response', assessment: null },
        { promptOrder: 5, status: 'no_response', assessment: null },
      ]);

      const { data: otherFeedback, error: otherFeedbackError } = await other.client.rpc(
        'get_candidate_mmi_station_feedback',
        { p_session_id: sessionId },
      );
      assert.equal(otherFeedback, null);
      assert.ok(otherFeedbackError);

      const { data: purgeResult, error: purgeError } = await service.rpc(
        'purge_expired_candidate_mmi_free_text',
        { p_now: new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000).toISOString() },
      );
      assert.equal(purgeError, null, purgeError?.message);
      assert.equal((purgeResult as { purged: number }).purged >= 1, true);
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
  });
});
