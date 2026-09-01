import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { buildMmiPersistenceFixtures, createAuthenticatedTestClient, expectDbCode } from './mmiPersistenceFixtures.ts';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { canRunLocalMutationTests } from './mutationTestSafety.ts';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { deleteLocalAssessorContentByPrefix, insertLocalAssessorContentRows, isLocalAssessorContentTable } from './localDatabaseFixture.ts';
const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const enabled = canRunLocalMutationTests(process.env);
const run = enabled ? describe : describe.skip;
const fixturePrefix = `mmi-persistence-${randomUUID().slice(0, 8)}`;
const password = `Local-only-${randomUUID()}!`;
const authUserIds: string[] = [];
const fixtureDigest = 'a'.repeat(64);
const oldFixtureDigest = 'b'.repeat(64);
const { dimensionResults, ids, promptResultRow, promptSnapshotRow, safetyItems, safeContentSnapshot, weights } = buildMmiPersistenceFixtures(fixturePrefix);
let service: SupabaseClient;
let anonymous: SupabaseClient;
let owner: SupabaseClient;
let otherUser: SupabaseClient;
let ownerId: string;
let otherUserId: string;
let standardRubricId: string;
let roleplayRubricId: string;
async function mustInsert(table: string,
  row: Record<string, unknown> | Record<string, unknown>[]) {
  if (isLocalAssessorContentTable(table)) {
    return insertLocalAssessorContentRows(table, row);
  }
  const { data, error } = await service.from(table).insert(row).select();
  assert.equal(error, null, error?.message);
  assert.ok(data);
  return data;
}
async function expectInsertCode(table: string, row: Record<string, unknown>,
  expectedCode: string) {
  await expectDbCode(service.from(table).insert(row), expectedCode);
}
async function expectAttemptUpdateCode(
  attemptId: string,
  values: Record<string, unknown>,
) {
  await expectDbCode(
    service.from('mmi_attempts').update(values).eq('id', attemptId),
    'P0001',
  );
}
async function createAuthenticatedClient(label: string) {
  const authenticated = await createAuthenticatedTestClient({
    service, url: url!, anonKey: anonKey!, password, fixturePrefix, label,
  });
  authUserIds.push(authenticated.userId);
  return authenticated;
}
async function createAttempt(label: string,
  overrides: Record<string, unknown> = {}) {
  const rows = await mustInsert('mmi_attempts', {
    user_id: ownerId,
    station_kind: 'standard',
    standard_station_id: ids.standard,
    status: 'in_progress',
    phase: 'preparing',
    current_prompt_order: 1,
    expected_prompt_count: 2,
    content_snapshot: safeContentSnapshot(),
    privacy_notice_version: ids.noticeAccount,
    privacy_notice_acknowledged_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ...overrides,
  });
  assert.ok(rows[0]?.id, `${label} attempt was not returned`);
  return rows[0];
}
async function activatePrompt(attempt: Record<string, unknown>, promptOrder: number) {
  const { error } = await service.from('mmi_attempts')
    .update({ phase: 'prompt_active' }).eq('id', attempt.id)
    .eq('current_prompt_order', promptOrder);
  assert.equal(error, null, error?.message);
}
async function createPromptResult(
  attempt: Record<string, unknown>,
  promptOrder: number,
  overrides: Record<string, unknown> = {},
) {
  await activatePrompt(attempt, promptOrder);
  await mustInsert('mmi_attempt_prompt_snapshots',
    promptSnapshotRow(attempt, promptOrder, standardRubricId));
  const rows = await mustInsert('mmi_prompt_attempts',
    promptResultRow(attempt, promptOrder, standardRubricId, overrides));
  return rows[0];
}
async function createTranscriptionUser(label: string) {
  return createAuthenticatedClient(`transcription-${label}-${randomUUID().slice(0, 6)}`);
}
run('MMI practice persistence (disposable local Supabase only)', () => {
  before(async () => {
    service = createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
    anonymous = createClient(url!, anonKey!, {
      auth: { persistSession: false },
    });
    ({ client: owner, userId: ownerId } =
      await createAuthenticatedClient('owner'));
    ({ client: otherUser, userId: otherUserId } =
      await createAuthenticatedClient('other'));
    await mustInsert('mmi_stations', {
      station_id: ids.standard,
      category: 'ethics',
      topic: 'Consent',
      difficulty: 'intermediate',
      prep_time_sec: 60,
      status: 'draft',
      scenario_text: 'A student-facing scenario.',
    });
    await mustInsert('mmi_sub_questions', [
      {
        sub_q_id: ids.standardPrompt1,
        station_id: ids.standard,
        order_num: 1,
        question_text: 'First prompt',
        time_limit_sec: 120,
      },
      {
        sub_q_id: ids.standardPrompt2,
        station_id: ids.standard,
        order_num: 2,
        question_text: 'Second prompt',
        time_limit_sec: 120,
      },
    ]);
    await mustInsert('roleplay_stations', {
      station_id: ids.roleplay,
      title: 'Role-play fixture',
      topic: 'Communication',
      category: 'scenarios',
      difficulty: 'intermediate',
      prep_time_sec: 120,
      time_limit_sec: 300,
      actor_persona: 'Hidden persona',
      background_info: 'Hidden context',
      opening_line: 'Student-facing opening',
      status: 'draft',
    });
    await mustInsert('mmi_privacy_notices', [
      {
        version: ids.noticeAccount,
        processor_name: 'Synthetic local processor',
        notice_text: 'Local-only account-lifetime fixture notice.',
        retention_mode: 'account_lifetime',
        published_at: new Date().toISOString(),
        is_active: true,
      },
      {
        version: ids.noticeFixed,
        processor_name: 'Synthetic local processor',
        notice_text: 'Local-only fixed-retention fixture notice.',
        retention_mode: 'fixed_days',
        retention_days: 7,
        published_at: new Date().toISOString(),
        is_active: false,
      },
    ]);
    const standardRubric = await mustInsert('mmi_scoring_rubrics', {
      standard_sub_q_id: ids.standardPrompt1,
      version: 1,
      status: 'active',
      criteria: { summary: 'Synthetic clinician-reviewed criteria.' },
      dimension_weights: weights,
      safety_critical_items: safetyItems,
      clinician_reviewed_at: new Date().toISOString(),
      clinician_reviewed_by: ownerId,
    });
    const roleplayRubric = await mustInsert('mmi_scoring_rubrics', {
      roleplay_station_id: ids.roleplay,
      version: 1,
      status: 'active',
      criteria: { summary: 'Synthetic clinician-reviewed role-play criteria.' },
      dimension_weights: weights,
      safety_critical_items: safetyItems,
      clinician_reviewed_at: new Date().toISOString(),
      clinician_reviewed_by: ownerId,
    });
    standardRubricId = standardRubric[0].id;
    roleplayRubricId = roleplayRubric[0].id;
  });
  after(async () => {
    if (!service) return;
    const cleanupErrors: Array<{ message?: string } | null> = [];
    if (authUserIds.length) {
      const { error } = await service
        .from('mmi_attempts').delete().in('user_id', authUserIds);
      cleanupErrors.push(error);
    }
    const { error: rubricError } = await service
      .from('mmi_scoring_rubrics').delete()
      .or(`standard_sub_q_id.like.${fixturePrefix}%,roleplay_station_id.like.${fixturePrefix}%`);
    cleanupErrors.push(rubricError);
    const noticeCleanup = await service.from('mmi_privacy_notices').delete()
      .like('version', `${fixturePrefix}%`);
    cleanupErrors.push(noticeCleanup.error);
    try {
      await deleteLocalAssessorContentByPrefix(fixturePrefix);
    } catch (error) {
      cleanupErrors.push(error as Error);
    }
    for (const userId of authUserIds) {
      const { error } = await service.auth.admin.deleteUser(userId);
      cleanupErrors.push(error);
    }
    for (const error of cleanupErrors) {
      assert.equal(error, null, error?.message);
    }
  });
  it('enforces rubric targets, versions, five weights, review, and immutability', async () => {
    const base = {
      version: 1,
      status: 'draft',
      criteria: { summary: 'Invalid fixture candidate.' },
      dimension_weights: weights,
      safety_critical_items: safetyItems,
    };
    await expectInsertCode('mmi_scoring_rubrics', base, '23514');
    await expectInsertCode('mmi_scoring_rubrics', {
        ...base,
        standard_sub_q_id: ids.standardPrompt2,
        roleplay_station_id: ids.roleplay,
      }, '23514');
    await expectInsertCode('mmi_scoring_rubrics', {
        ...base,
        standard_sub_q_id: ids.standardPrompt2,
        dimension_weights: { ...weights, unexpected: 0 },
      }, '23514');
    await expectInsertCode('mmi_scoring_rubrics', {
        ...base,
        standard_sub_q_id: ids.standardPrompt2,
        dimension_weights: { ...weights, structure: 0.3 },
      }, '23514');
    await expectInsertCode('mmi_scoring_rubrics', {
        ...base,
        standard_sub_q_id: ids.standardPrompt2,
        safety_critical_items: [{ id: 'unsafe', assessor_criterion: 'Hidden' }],
      }, '23514');
    await expectInsertCode('mmi_scoring_rubrics', {
        ...base,
        standard_sub_q_id: ids.standardPrompt2,
        status: 'active',
      }, '23514');
    await expectInsertCode('mmi_scoring_rubrics', {
        ...base,
        standard_sub_q_id: ids.standardPrompt1,
      }, '23505');
    await expectInsertCode('mmi_scoring_rubrics', {
        ...base,
        standard_sub_q_id: ids.standardPrompt1,
        version: 2,
        status: 'active',
        clinician_reviewed_at: new Date().toISOString(),
        clinician_reviewed_by: ownerId,
      }, '23505');
    await expectDbCode(
      service
        .from('mmi_scoring_rubrics')
        .update({ criteria: { summary: 'Mutated active criteria.' } })
        .eq('id', standardRubricId),
      'P0001',
    );
  });
  it('enforces attempt, safe snapshot, prompt-result, and claim identities', async () => {
    const attemptBase = {
      user_id: ownerId,
      station_kind: 'standard',
      status: 'in_progress',
      phase: 'preparing',
      current_prompt_order: 1,
      expected_prompt_count: 2,
      content_snapshot: safeContentSnapshot(),
      privacy_notice_version: ids.noticeAccount,
      privacy_notice_acknowledged_at: new Date().toISOString(),
    };
    await expectInsertCode('mmi_attempts', attemptBase, 'P0001');
    await expectInsertCode('mmi_attempts', {
        ...attemptBase,
        standard_station_id: ids.standard,
        roleplay_station_id: ids.roleplay,
      }, '23514');
    await expectInsertCode('mmi_attempts', {
        ...attemptBase,
        station_kind: 'roleplay',
        standard_station_id: ids.standard,
      }, 'P0001');
    await expectInsertCode('mmi_attempts', {
        ...attemptBase,
        standard_station_id: ids.standard,
        content_snapshot: {
          ...safeContentSnapshot(),
          nested: { actor_persona: 'must never be client-readable' },
        },
      }, 'P0001');
    await expectInsertCode('mmi_attempts', {
        ...attemptBase,
        standard_station_id: ids.standard,
        content_snapshot: { ...safeContentSnapshot(), station_kind: null },
      }, 'P0001');
    await expectInsertCode('mmi_attempts', {
        ...attemptBase,
        standard_station_id: ids.standard,
        status: 'completed',
        phase: 'final_feedback',
        current_prompt_order: 2,
        completed_at: new Date().toISOString(),
        overall_pct: 100,
      }, 'P0001');
    const attempt = await createAttempt('identity');
    await activatePrompt(attempt, 1);
    await expectInsertCode('mmi_prompt_attempts', {
        attempt_id: attempt.id,
        station_kind: 'roleplay',
        prompt_order: 1,
        reviewed_transcript: 'Wrong discriminated prompt identity.',
        dimension_results: dimensionResults(),
        strengths: [],
        improvements: [],
        improvement_tip: 'Tip',
        overall_pct: 80,
        rubric_id: roleplayRubricId,
        rubric_version: 1,
        scoring_contract_version: 'mmi-score-v1',
      }, 'P0001');
    const result = await createPromptResult(attempt, 1);
    await expectDbCode(service.from('mmi_prompt_attempts')
      .update({ submitted_at: '2099-01-01T00:00:00.000Z' })
      .eq('id', result.id), 'P0001');
    await expectInsertCode('mmi_prompt_attempts', {
        attempt_id: attempt.id,
        station_kind: 'standard',
        standard_sub_q_id: ids.standardPrompt1,
        prompt_order: 1,
        dimension_results: dimensionResults(),
        strengths: [],
        improvements: [],
        overall_pct: 70,
        rubric_id: standardRubricId,
        rubric_version: 1,
        scoring_contract_version: 'mmi-score-v1',
      }, '23505');
    const forgedAttempt = await createAttempt('forged-provenance');
    await activatePrompt(forgedAttempt, 1);
    await mustInsert('mmi_attempt_prompt_snapshots',
      promptSnapshotRow(forgedAttempt, 1, standardRubricId));
    const forgedResult = promptResultRow(forgedAttempt, 1, standardRubricId);
    await expectInsertCode('mmi_prompt_attempts', {
      ...forgedResult, strengths: [{ hidden: 'not student-safe text' }],
    }, '23514');
    await expectInsertCode('mmi_prompt_attempts', {
      ...forgedResult, rubric_id: roleplayRubricId,
    }, 'P0001');
    await expectDbCode(service.from('mmi_attempt_prompt_snapshots').delete()
      .eq('attempt_id', forgedAttempt.id), 'P0001');
    const futureAttempt = await createAttempt('future-retention');
    await activatePrompt(futureAttempt, 1);
    await mustInsert('mmi_attempt_prompt_snapshots',
      promptSnapshotRow(futureAttempt, 1, standardRubricId));
    const futureResult = await mustInsert('mmi_prompt_attempts', promptResultRow(
      futureAttempt, 1, standardRubricId,
      { submitted_at: '2099-01-01T00:00:00.000Z' },
    ));
    assert.ok(Date.parse(futureResult[0].submitted_at) <= Date.now());
    const prePurgedAttempt = await createAttempt('pre-purged');
    await activatePrompt(prePurgedAttempt, 1);
    await mustInsert('mmi_attempt_prompt_snapshots',
      promptSnapshotRow(prePurgedAttempt, 1, standardRubricId));
    await expectInsertCode('mmi_prompt_attempts', promptResultRow(
      prePurgedAttempt, 1, standardRubricId, {
        reviewed_transcript: null, dimension_results: dimensionResults(null),
        strengths: null, improvements: null, improvement_tip: null,
        free_text_purged_at: new Date().toISOString(),
      },
    ), 'P0001');
    const nonContiguous = await createAttempt('non-contiguous');
    await activatePrompt(nonContiguous, 1);
    await mustInsert('mmi_attempt_prompt_snapshots',
      promptSnapshotRow(nonContiguous, 99, standardRubricId));
    await expectInsertCode('mmi_prompt_attempts',
      promptResultRow(nonContiguous, 99, standardRubricId), 'P0001');
    const idempotencyKey = randomUUID();
    const claim = {
      user_id: ownerId,
      attempt_id: attempt.id,
      idempotency_key: idempotencyKey,
      station_kind: 'standard',
      standard_sub_q_id: ids.standardPrompt2,
      request_digest: fixtureDigest,
      status: 'claimed',
      lease_token: randomUUID(),
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    await mustInsert('mmi_scoring_claims', claim);
    const duplicateAttempt = await createAttempt('duplicate-claim');
    await expectInsertCode('mmi_scoring_claims', {
        ...claim,
        attempt_id: duplicateAttempt.id,
      }, '23505');
    await expectInsertCode('mmi_scoring_claims', {
        ...claim,
        attempt_id: duplicateAttempt.id,
        idempotency_key: randomUUID(),
        prompt_attempt_id: result.id,
        status: 'completed',
        completed_at: new Date().toISOString(),
      }, '23503');
  });
  it('allows only explicit forward progression and requires every result before completion', async () => {
    const attempt = await createAttempt('progression');
    const { error: startError } = await service.from('mmi_attempts')
      .update({ phase: 'prompt_active' }).eq('id', attempt.id);
    assert.equal(startError, null, startError?.message);
    await expectAttemptUpdateCode(attempt.id, { phase: 'preparing' });
    await expectAttemptUpdateCode(attempt.id, { current_prompt_order: 2 });
    await expectAttemptUpdateCode(attempt.id, {
      status: 'completed',
      phase: 'final_feedback',
      completed_at: new Date().toISOString(),
    });
    await createPromptResult(attempt, 1);
    const { error: feedbackError } = await service
      .from('mmi_attempts')
      .update({ phase: 'awaiting_continue' })
      .eq('id', attempt.id);
    assert.equal(feedbackError, null, feedbackError?.message);
    const { error: continueError } = await service
      .from('mmi_attempts')
      .update({ phase: 'prompt_active', current_prompt_order: 2 })
      .eq('id', attempt.id);
    assert.equal(continueError, null, continueError?.message);
    await expectAttemptUpdateCode(attempt.id, { current_prompt_order: 1 });
    await expectAttemptUpdateCode(attempt.id, {
      status: 'completed',
      phase: 'final_feedback',
      completed_at: new Date().toISOString(),
    });
    await createPromptResult(attempt, 2);
    const { error: completeError } = await service
      .from('mmi_attempts')
      .update({
        status: 'completed',
        phase: 'final_feedback',
        completed_at: new Date().toISOString(),
      })
      .eq('id', attempt.id);
    assert.equal(completeError, null, completeError?.message);
    const { data: aggregate, error: aggregateError } = await service.rpc(
      'calculate_mmi_attempt_aggregate',
      { p_attempt_id: attempt.id },
    );
    assert.equal(aggregateError, null, aggregateError?.message);
    assert.deepEqual(aggregate?.[0], {
      dimension_averages: {
        communication: 3,
        ethics: 3,
        nhs_awareness: 3,
        reflection: 3,
        structure: 3,
      },
      overall_pct: 60,
      prompt_count: 2,
    });
    await expectDbCode(
      service.from('mmi_prompt_attempts')
        .update({ overall_pct: 99 }).eq('attempt_id', attempt.id),
      'P0001',
    );
  });
  it('pins immutable privacy semantics and exposes only the active fixed projection', async () => {
    await expectInsertCode('mmi_privacy_notices', {
        version: `${fixturePrefix}-invalid-fixed`,
        processor_name: 'Synthetic',
        notice_text: 'Invalid fixed notice.',
        retention_mode: 'fixed_days',
        published_at: new Date().toISOString(),
      }, '23514');
    await expectInsertCode('mmi_privacy_notices', {
        version: `${fixturePrefix}-invalid-account`,
        processor_name: 'Synthetic',
        notice_text: 'Invalid account notice.',
        retention_mode: 'account_lifetime',
        retention_days: 7,
        published_at: new Date().toISOString(),
      }, '23514');
    await expectInsertCode('mmi_privacy_notices', {
        version: `${fixturePrefix}-invalid-active`,
        processor_name: 'Synthetic',
        notice_text: 'Unpublished active notice.',
        retention_mode: 'account_lifetime',
        is_active: true,
      }, '23514');
    await expectInsertCode('mmi_privacy_notices', {
        version: `${fixturePrefix}-second-active`,
        processor_name: 'Synthetic',
        notice_text: 'Second active notice.',
        retention_mode: 'account_lifetime',
        published_at: new Date().toISOString(),
        is_active: true,
      }, '23505');
    await expectDbCode(
      service
        .from('mmi_privacy_notices')
        .update({ notice_text: 'Mutated notice text.' })
        .eq('version', ids.noticeAccount),
      'P0001',
    );
    const { data, error } = await owner.rpc('get_active_mmi_privacy_notice');
    assert.equal(error, null, error?.message);
    assert.deepEqual(Object.keys(data?.[0] ?? {}).sort(), [
      'notice_text',
      'processor_name',
      'retention_days',
      'retention_mode',
      'version',
    ]);
    assert.equal(data?.[0]?.version, ids.noticeAccount);
    const { data: anonymousData, error: anonymousError } = await anonymous.rpc(
      'get_active_mmi_privacy_notice',
    );
    assert.equal(anonymousData, null);
    assert.equal(anonymousError?.code, '42501');
  });
  it('allows owner reads only and denies every direct client write or private-table read', async () => {
    const ownAttempt = await createAttempt('owner-visible');
    await createPromptResult(ownAttempt, 1);
    const otherAttempt = await createAttempt('other-hidden', {
      user_id: otherUserId,
    });
    await createPromptResult(otherAttempt, 1);
    const { data: ownerAttempts, error: ownerAttemptsError } = await owner
      .from('mmi_attempts')
      .select('id,user_id');
    assert.equal(ownerAttemptsError, null, ownerAttemptsError?.message);
    assert.ok(ownerAttempts?.length);
    assert.ok(ownerAttempts?.every((row) => row.user_id === ownerId));
    assert.ok(ownerAttempts?.some((row) => row.id === ownAttempt.id));
    assert.ok(!ownerAttempts?.some((row) => row.id === otherAttempt.id));
    const { data: ownerResults, error: ownerResultsError } = await owner
      .from('mmi_prompt_attempts')
      .select('attempt_id,reviewed_transcript');
    assert.equal(ownerResultsError, null, ownerResultsError?.message);
    assert.ok(ownerResults?.some((row) => row.attempt_id === ownAttempt.id));
    assert.ok(!ownerResults?.some((row) => row.attempt_id === otherAttempt.id));
    for (const request of [
      owner.from('mmi_attempts').insert({
        user_id: ownerId,
        station_kind: 'standard',
        standard_station_id: ids.standard,
        content_snapshot: safeContentSnapshot(),
        privacy_notice_version: ids.noticeAccount,
        privacy_notice_acknowledged_at: new Date().toISOString(),
      }),
      owner
        .from('mmi_attempts')
        .update({ phase: 'awaiting_continue' })
        .eq('id', ownAttempt.id),
      owner.from('mmi_attempts').delete().eq('id', ownAttempt.id),
    ]) {
      await expectDbCode(request, '42501');
    }
    for (const table of [
      'mmi_scoring_rubrics',
      'mmi_privacy_notices',
      'mmi_attempt_prompt_snapshots',
      'mmi_scoring_claims',
      'mmi_transcription_events',
    ]) {
      await expectDbCode(owner.from(table).select('*'), '42501');
    }
    for (const [name, args] of [
      ['claim_mmi_transcription_attempt', {
        p_attempt_id: ownAttempt.id,
        p_byte_count: 1,
        p_mime_type: 'audio/webm',
        p_user_id: ownerId,
      }],
      ['complete_mmi_transcription_attempt', {
        p_event_id: randomUUID(),
        p_safe_outcome_code: 'completed',
      }],
      ['calculate_mmi_attempt_aggregate', { p_attempt_id: ownAttempt.id }],
      ['purge_expired_mmi_private_text', {}],
    ] as const) {
      await expectDbCode(owner.rpc(name, args), '42501');
    }
  });
  it('purges fixed-day private text while retaining numeric history and account-lifetime text', async () => {
    const oldTimestamp = '2020-01-01T00:00:00.000Z';
    const fixedAttempt = await createAttempt('fixed-retention', {
      privacy_notice_version: ids.noticeFixed,
      started_at: oldTimestamp,
    });
    const accountAttempt = await createAttempt('account-retention', {
      started_at: oldTimestamp,
    });
    const fixedResult = await createPromptResult(fixedAttempt, 1, {
      created_at: oldTimestamp,
      submitted_at: oldTimestamp,
    });
    const accountResult = await createPromptResult(accountAttempt, 1, {
      created_at: oldTimestamp,
      submitted_at: oldTimestamp,
    });
    await expectDbCode(
      service.from('mmi_prompt_attempts')
        .update({
          reviewed_transcript: null,
          dimension_results: dimensionResults(null),
          strengths: null,
          improvements: null,
          improvement_tip: null,
          free_text_purged_at: new Date().toISOString(),
        })
        .eq('id', fixedResult.id),
      'P0001',
    );
    await mustInsert('mmi_scoring_claims', {
      user_id: ownerId,
      attempt_id: fixedAttempt.id,
      idempotency_key: randomUUID(),
      station_kind: 'standard',
      standard_sub_q_id: ids.standardPrompt1,
      request_digest: oldFixtureDigest,
      status: 'completed',
      prompt_attempt_id: fixedResult.id,
      lease_token: randomUUID(),
      lease_expires_at: oldTimestamp,
      created_at: oldTimestamp,
      updated_at: oldTimestamp,
      completed_at: oldTimestamp,
    });
    const oldEvent = await mustInsert('mmi_transcription_events', {
      user_id: ownerId,
      attempt_id: fixedAttempt.id,
      byte_count: 1024,
      mime_type: 'audio/webm',
      safe_outcome_code: 'completed',
      created_at: oldTimestamp,
    });
    assert.deepEqual(Object.keys(oldEvent[0]).sort(), [
      'attempt_id',
      'byte_count',
      'created_at',
      'id',
      'mime_type',
      'safe_outcome_code',
      'user_id',
    ]);
    const { error: purgeError } = await service.rpc(
      'purge_expired_mmi_private_text',
    );
    assert.equal(purgeError, null, purgeError?.message);
    const { data: fixed, error: fixedError } = await service
      .from('mmi_prompt_attempts')
      .select('*')
      .eq('id', fixedResult.id)
      .single();
    assert.equal(fixedError, null, fixedError?.message);
    assert.equal(fixed.reviewed_transcript, null);
    assert.equal(fixed.strengths, null);
    assert.equal(fixed.improvements, null);
    assert.equal(fixed.improvement_tip, null);
    assert.ok(fixed.free_text_purged_at);
    assert.equal(fixed.overall_pct, 80);
    for (const result of Object.values(fixed.dimension_results)) {
      const dimension = result as Record<string, unknown>;
      assert.equal(dimension.evidence, null);
      assert.equal(dimension.improvement, null);
      assert.equal(dimension.score, 4);
    }
    await expectDbCode(
      service.from('mmi_prompt_attempts')
        .update({ reviewed_transcript: 'Retention bypass.' })
        .eq('id', fixedResult.id),
      'P0001',
    );
    const { data: account, error: accountError } = await service
      .from('mmi_prompt_attempts')
      .select('*')
      .eq('id', accountResult.id)
      .single();
    assert.equal(accountError, null, accountError?.message);
    assert.match(account.reviewed_transcript, /Reviewed fixture transcript/);
    assert.equal(account.free_text_purged_at, null);
    const { count: oldClaimCount, error: oldClaimError } = await service
      .from('mmi_scoring_claims')
      .select('*', { count: 'exact', head: true })
      .eq('request_digest', oldFixtureDigest);
    const { count: oldEventCount, error: oldEventError } = await service
      .from('mmi_transcription_events')
      .select('*', { count: 'exact', head: true })
      .eq('id', oldEvent[0].id);
    assert.equal(oldClaimError, null, oldClaimError?.message);
    assert.equal(oldEventError, null, oldEventError?.message);
    assert.equal(oldClaimCount, 0);
    assert.equal(oldEventCount, 0);
  });
  it('serializes cross-attempt transcription claims at the hourly limit', async () => {
    const { userId } = await createTranscriptionUser('concurrency');
    const firstAttempt = await createAttempt('concurrency-one', { user_id: userId });
    const secondAttempt = await createAttempt('concurrency-two', { user_id: userId });
    await mustInsert(
      'mmi_transcription_events',
      Array.from({ length: 29 }, () => ({
        user_id: userId,
        attempt_id: firstAttempt.id,
        byte_count: 1,
        mime_type: 'audio/webm',
      })),
    );
    const results = await Promise.all([
      service.rpc('claim_mmi_transcription_attempt', {
        p_user_id: userId,
        p_attempt_id: firstAttempt.id,
        p_byte_count: 1,
        p_mime_type: 'audio/webm',
      }),
      service.rpc('claim_mmi_transcription_attempt', {
        p_user_id: userId,
        p_attempt_id: secondAttempt.id,
        p_byte_count: 1,
        p_mime_type: 'audio/webm',
      }),
    ]);
    assert.equal(results.filter((result) => result.error === null).length, 1);
    assert.equal(results.filter((result) => result.error?.code === 'P0001').length, 1);
    const { count, error } = await service
      .from('mmi_transcription_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    assert.equal(error, null, error?.message);
    assert.equal(count, 30);
  });
  it('enforces the rolling 24-hour byte budget and records only a safe outcome', async () => {
    const { userId } = await createTranscriptionUser('bytes');
    const attempt = await createAttempt('byte-limit', { user_id: userId });
    await mustInsert(
      'mmi_transcription_events',
      Array.from({ length: 25 }, () => ({
        user_id: userId,
        attempt_id: attempt.id,
        byte_count: 12 * 1024 * 1024,
        mime_type: 'audio/webm',
      })),
    );
    await expectDbCode(
      service.rpc('claim_mmi_transcription_attempt', {
        p_user_id: userId,
        p_attempt_id: attempt.id,
        p_byte_count: 1,
        p_mime_type: 'audio/webm',
      }),
      'P0001',
    );
    const freshUser = await createTranscriptionUser('complete');
    const freshAttempt = await createAttempt('complete-event', {
      user_id: freshUser.userId,
    });
    const { data: claimed, error: claimError } = await service.rpc(
      'claim_mmi_transcription_attempt',
      {
        p_user_id: freshUser.userId,
        p_attempt_id: freshAttempt.id,
        p_byte_count: 1024,
        p_mime_type: 'audio/webm',
      },
    );
    assert.equal(claimError, null, claimError?.message);
    assert.ok(claimed);
    const { error: completeError } = await service.rpc(
      'complete_mmi_transcription_attempt',
      { p_event_id: claimed, p_safe_outcome_code: 'completed' },
    );
    assert.equal(completeError, null, completeError?.message);
    const { data: event, error: eventError } = await service
      .from('mmi_transcription_events')
      .select('*')
      .eq('id', claimed)
      .single();
    assert.equal(eventError, null, eventError?.message);
    assert.equal(event.safe_outcome_code, 'completed');
    assert.doesNotMatch(
      JSON.stringify(event),
      /audio_(?:uri|url|bytes|blob|path)|transcript|provider_response/i,
    );
  });
});
