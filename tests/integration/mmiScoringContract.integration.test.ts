import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error Node's native TypeScript test runner requires source extensions.
import { buildMmiPersistenceFixtures, createAuthenticatedTestClient, resolveMmiPrivacyNoticeVersion } from './mmiPersistenceFixtures.ts';

const configPath = fileURLToPath(new URL('../../supabase/config.toml', import.meta.url).href);
const migrationPath = fileURLToPath(new URL('../../supabase/migrations/20260817003000_mmi_submission_rpcs.sql', import.meta.url).href);
const scoringHandlerPath = fileURLToPath(new URL('../../supabase/functions/score-mmi-prompt/index.ts', import.meta.url).href);
const url = process.env.SUPABASE_TEST_URL;
const required = process.env.MMI_SCORING_INTEGRATION_REQUIRED === '1';
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const disposableLocal = url !== undefined && ['localhost', '127.0.0.1'].includes(new URL(url).hostname);

if (url && !disposableLocal) throw new Error('MMI scoring integration tests only run against a disposable local Supabase URL');
if (required && (!disposableLocal || !anonKey || !serviceRoleKey)) throw new Error('Required disposable local MMI scoring integration credentials are missing');

describe('MMI scoring deployment contracts', () => {
  it('reuses the active privacy notice before creating a scoring fixture notice', async () => {
    let createCalls = 0;
    const existingVersion = await resolveMmiPrivacyNoticeVersion({
      findActive: async () => 'existing-active-notice',
      create: async () => { createCalls += 1; return 'new-fixture-notice'; },
    });
    assert.equal(existingVersion, 'existing-active-notice');
    assert.equal(createCalls, 0);

    const createdVersion = await resolveMmiPrivacyNoticeVersion({
      findActive: async () => null,
      create: async () => { createCalls += 1; return 'new-fixture-notice'; },
    });
    assert.equal(createdVersion, 'new-fixture-notice');
    assert.equal(createCalls, 1);
  });

  it('JWT-verifies the scoring and continuation endpoints', () => {
    const config = readFileSync(configPath, 'utf8');
    for (const name of ['score-mmi-prompt', 'continue-mmi-attempt']) {
      const section = config.match(new RegExp(`\\[functions\\.${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'i'));
      assert.ok(section, `missing [functions.${name}]`);
      assert.match(section[1], /^verify_jwt\s*=\s*true\s*$/mi);
    }
  });

  it('closes every submission RPC to browser roles and grants only service role', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const signatures = [
      'claim_mmi_scoring_submission\\(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT\\)',
      'complete_mmi_scoring_submission\\(UUID, UUID, TEXT, JSONB, UUID, INTEGER\\)',
      'fail_mmi_scoring_submission\\(UUID, UUID, TEXT\\)',
      'advance_mmi_attempt_after_feedback\\(UUID, UUID\\)',
    ];
    for (const signature of signatures) {
      assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON FUNCTION public\\.${signature} FROM PUBLIC, anon, authenticated`, 'i'));
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role`, 'i'));
    }
    for (const name of ['claim_mmi_scoring_submission', 'complete_mmi_scoring_submission', 'fail_mmi_scoring_submission', 'advance_mmi_attempt_after_feedback']) {
      assert.match(sql, new RegExp(`FUNCTION public\\.${name}[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = public, pg_temp`, 'i'));
    }
  });

  it('stores complete claim identity, per-provider attempt events, and atomic completion reservations', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    for (const fragment of [
      'ADD COLUMN IF NOT EXISTS station_id TEXT',
      'ADD COLUMN IF NOT EXISTS prompt_order INTEGER',
      'ADD COLUMN IF NOT EXISTS completion_reservation_at TIMESTAMPTZ',
      'CREATE TABLE IF NOT EXISTS public.mmi_scoring_provider_attempts',
      'INSERT INTO public.mmi_scoring_provider_attempts',
      'completion_reservation_at = NULL',
      'completion_reservation_at = clock_timestamp()',
      "completed_at + INTERVAL '24 hours' AS release_at",
      'c.lease_expires_at > clock_timestamp()',
      "a.status = 'in_progress'",
      'pg_advisory_xact_lock(hashtextextended(v_claim_user::TEXT, 0))',
    ]) assert.match(sql, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    assert.match(
      sql,
      /standard_sub_q_id\s+IS\s+DISTINCT\s+FROM\s*\(\s*CASE\s+WHEN[\s\S]*?END\s*\)\s+THEN/i,
      'PL/pgSQL requires the CASE identity expression to be explicitly parenthesized',
    );
  });

  it('uses one advisory-to-claim-to-attempt lock order and exposes the ledger only for service reads/inserts', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    for (const name of ['claim_mmi_scoring_submission', 'complete_mmi_scoring_submission', 'fail_mmi_scoring_submission']) {
      const body = sql.match(new RegExp(`FUNCTION public\\.${name}[\\s\\S]*?\\$function\\$;`, 'i'))?.[0] ?? '';
      assert.match(body, /pg_advisory_xact_lock[\s\S]*?mmi_scoring_claims[\s\S]*?FOR UPDATE[\s\S]*?mmi_attempts[\s\S]*?FOR UPDATE/i);
    }
    assert.equal(
      (sql.match(/v_claim\.user_id\s+IS\s+DISTINCT\s+FROM\s+v_claim_user/gi) ?? []).length,
      2,
      'complete and fail must revalidate the locked claim owner used for the advisory lock',
    );
    assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.mmi_scoring_provider_attempts FROM PUBLIC, anon, authenticated/i);
    assert.match(sql, /GRANT SELECT, INSERT ON TABLE public\.mmi_scoring_provider_attempts TO service_role/i);
    assert.doesNotMatch(sql, /GRANT ALL PRIVILEGES ON TABLE public\.mmi_scoring_provider_attempts/i);
  });

  it('rebuilds completed replay metadata without querying mutable attempt state in the handler', () => {
    const handler = readFileSync(scoringHandlerPath, 'utf8');
    assert.match(handler, /reconstructCompletedMmiReplay\(\{[\s\S]*?promptOrder: claimData\.promptOrder[\s\S]*?expectedPromptCount: claimData\.expectedPromptCount/i);
    assert.doesNotMatch(handler, /select\('status,current_prompt_order,expected_prompt_count'\)/i);
  });
});

// This suite deliberately contains no fixture cleanup. A future authorized run may leave
// unique synthetic rows behind; it cannot run unless MMI_SCORING_INTEGRATION_REQUIRED=1
// and the target is localhost/127.0.0.1.

const run = required && disposableLocal && anonKey && serviceRoleKey ? describe : describe.skip;
const fixturePrefix = `mmi-scoring-${randomUUID().slice(0, 8)}`;
const { ids, promptSnapshotRow, safeContentSnapshot, weights, safetyItems } = buildMmiPersistenceFixtures(fixturePrefix);

run('MMI scoring RPCs (explicit disposable-local integration only)', () => {
  let service: SupabaseClient; let ownerId: string; let otherId: string; let rubricId: string;
  let privacyNoticeVersion: string | undefined;
  const digest = 'a'.repeat(64);
  const args = (attemptId: string, key = randomUUID(), requestDigest = digest) => ({
    p_user_id: ownerId, p_attempt_id: attemptId, p_idempotency_key: key, p_prompt_kind: 'standard',
    p_station_id: ids.standard, p_sub_question_id: ids.standardPrompt1, p_request_digest: requestDigest,
  });
  const argsForPrompt = (attemptId: string, subQuestionId: string, key = randomUUID(), requestDigest = digest) => ({
    p_user_id: ownerId, p_attempt_id: attemptId, p_idempotency_key: key, p_prompt_kind: 'standard',
    p_station_id: ids.standard, p_sub_question_id: subQuestionId, p_request_digest: requestDigest,
  });
  const assessment = {
    dimensions: Object.fromEntries(['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness'].map((key) => [key, { score: 4, applicable: true, evidence: 'Synthetic evidence', improvement: 'Synthetic improvement' }])),
    overallPct: 80, strengths: ['Synthetic strength'], improvements: ['Synthetic improvement'], improvementTip: 'Synthetic tip', rubricVersion: 1,
  };
  async function insert(table: string, row: Record<string, unknown> | Record<string, unknown>[]) {
    const { data, error } = await service.from(table).insert(row).select(); assert.equal(error, null, error?.message); return data ?? [];
  }
  function claimArgs(userId: string, attemptId: string) {
    return {
      p_user_id: userId, p_attempt_id: attemptId, p_idempotency_key: randomUUID(), p_prompt_kind: 'standard',
      p_station_id: ids.standard, p_sub_question_id: ids.standardPrompt1, p_request_digest: digest,
    };
  }
  async function createRateLimitUser(label: string) {
    const { userId } = await createAuthenticatedTestClient({
      service, url: url!, anonKey: anonKey!, password: `Local-only-${randomUUID()}!`, fixturePrefix,
      label: `rate-${label}-${randomUUID().slice(0, 8)}`,
    });
    return userId;
  }
  async function seedProviderAttemptClaims(userId: string, count: number) {
    const updatedAt = new Date(Date.now() - 60_000).toISOString();
    for (let index = 0; index < count; index += 1) {
      const attempt = await activeAttempt(`rate-provider-${index}`, userId);
      await insert('mmi_scoring_claims', {
        user_id: userId, attempt_id: attempt.id, idempotency_key: randomUUID(), station_kind: 'standard',
        standard_sub_q_id: ids.standardPrompt1, request_digest: digest, lease_token: randomUUID(),
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(), provider_attempt_count: 1,
        updated_at: updatedAt,
      });
      const { data: claim, error } = await service.from('mmi_scoring_claims').select('id')
        .eq('attempt_id', attempt.id).eq('user_id', userId).maybeSingle();
      assert.equal(error, null, error?.message);
      await insert('mmi_scoring_provider_attempts', {
        claim_id: (claim as { id: string }).id, user_id: userId, attempted_at: updatedAt,
      });
    }
    return updatedAt;
  }
  async function seedCompletedClaims(userId: string, count: number) {
    const completedAt = new Date(Date.now() - 60_000).toISOString();
    for (let index = 0; index < count; index += 1) {
      const attempt = await activeAttempt(`rate-completed-${index}`, userId);
      const [promptAttempt] = await insert('mmi_prompt_attempts', {
        attempt_id: attempt.id, station_kind: 'standard', standard_sub_q_id: ids.standardPrompt1,
        prompt_order: 1, reviewed_transcript: `Completed rate-limit transcript ${index}`,
        dimension_results: assessment.dimensions, strengths: assessment.strengths,
        improvements: assessment.improvements, improvement_tip: assessment.improvementTip,
        overall_pct: assessment.overallPct, rubric_id: rubricId, rubric_version: 1,
        scoring_contract_version: 'mmi-score-v1', submitted_at: completedAt,
      });
      await insert('mmi_scoring_claims', {
        user_id: userId, attempt_id: attempt.id, idempotency_key: randomUUID(), station_kind: 'standard',
        standard_sub_q_id: ids.standardPrompt1, request_digest: digest, status: 'completed',
        prompt_attempt_id: promptAttempt.id, lease_token: randomUUID(), lease_expires_at: completedAt,
        provider_attempt_count: 0, completed_at: completedAt, updated_at: completedAt,
      });
    }
    return completedAt;
  }
  async function activeAttempt(label: string, userId = ownerId, nullCachedAnswer = false) {
    const resolvedPrivacyNoticeVersion = privacyNoticeVersion;
    assert.ok(resolvedPrivacyNoticeVersion, 'privacy notice must be resolved before creating attempts');
    const [attempt] = await insert('mmi_attempts', { user_id: userId, station_kind: 'standard', standard_station_id: ids.standard,
      status: 'in_progress', phase: 'preparing', current_prompt_order: 1, expected_prompt_count: 2, content_snapshot: safeContentSnapshot(), privacy_notice_version: resolvedPrivacyNoticeVersion,
      privacy_notice_acknowledged_at: new Date().toISOString(), started_at: new Date().toISOString() });
    const firstSnapshot = promptSnapshotRow(attempt, 1, rubricId);
    if (nullCachedAnswer) (firstSnapshot as Record<string, unknown>).hidden_reference_answer = null;
    await insert('mmi_attempt_prompt_snapshots', [firstSnapshot, promptSnapshotRow(attempt, 2, rubricId)]);
    const { error } = await service.from('mmi_attempts').update({ phase: 'prompt_active' }).eq('id', attempt.id); assert.equal(error, null, error?.message);
    return attempt as { id: string };
  }
  before(async () => {
    service = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });
    privacyNoticeVersion = await resolveMmiPrivacyNoticeVersion({
      findActive: async () => {
        const { data, error } = await service.from('mmi_privacy_notices')
          .select('version').eq('is_active', true).maybeSingle();
        assert.equal(error, null, error?.message);
        return data?.version ?? null;
      },
      create: async () => {
        const [notice] = await insert('mmi_privacy_notices', {
          version: ids.noticeAccount, processor_name: 'Synthetic',
          notice_text: 'Synthetic local notice.', retention_mode: 'account_lifetime',
          published_at: new Date().toISOString(), is_active: true,
        });
        assert.equal(typeof notice?.version, 'string');
        return notice.version as string;
      },
    });
    const password = `Local-only-${randomUUID()}!`;
    ({ userId: ownerId } = await createAuthenticatedTestClient({ service, url: url!, anonKey: anonKey!, password, fixturePrefix, label: 'owner' }));
    ({ userId: otherId } = await createAuthenticatedTestClient({ service, url: url!, anonKey: anonKey!, password, fixturePrefix, label: 'other' }));
    await insert('mmi_stations', { station_id: ids.standard, category: 'ethics', topic: 'Synthetic', difficulty: 'intermediate', prep_time_sec: 1, status: 'draft', scenario_text: 'Synthetic.' });
    await insert('mmi_sub_questions', [{ sub_q_id: ids.standardPrompt1, station_id: ids.standard, order_num: 1, question_text: 'One?', time_limit_sec: 120 }, { sub_q_id: ids.standardPrompt2, station_id: ids.standard, order_num: 2, question_text: 'Two?', time_limit_sec: 120 }]);
    const [rubric] = await insert('mmi_scoring_rubrics', { standard_sub_q_id: ids.standardPrompt1, version: 1, status: 'active', criteria: { summary: 'Synthetic.' }, dimension_weights: weights, safety_critical_items: safetyItems, clinician_reviewed_at: new Date().toISOString(), clinician_reviewed_by: ownerId }); rubricId = rubric.id;
  });
  it('enforces identity, stale order, cross-user ownership, and pinned-rubric fencing', async () => {
    const attempt = await activeAttempt('identity');
    for (const mutation of [{ p_station_id: `${ids.standard}-wrong` }, { p_sub_question_id: ids.standardPrompt2 }, { p_user_id: otherId }]) {
      const { error } = await service.rpc('claim_mmi_scoring_submission', { ...args(attempt.id), ...mutation }); assert.ok(error);
    }
    const { error: unsafeAdvanceError } = await service.from('mmi_attempts')
      .update({ current_prompt_order: 2 }).eq('id', attempt.id);
    assert.ok(unsafeAdvanceError, 'attempt progression must reject a direct prompt-order jump');
    const { data: unchangedAttempt, error: unchangedAttemptError } = await service.from('mmi_attempts')
      .select('current_prompt_order,phase').eq('id', attempt.id).single();
    assert.equal(unchangedAttemptError, null, unchangedAttemptError?.message);
    assert.deepEqual(unchangedAttempt, { current_prompt_order: 1, phase: 'prompt_active' });
    const fresh = await activeAttempt('rubric'); const claimed = await service.rpc('claim_mmi_scoring_submission', args(fresh.id));
    assert.equal(claimed.error, null); assert.ok((await service.rpc('complete_mmi_scoring_submission', { p_claim_id: (claimed.data as any).claimId, p_lease_token: (claimed.data as any).leaseToken, p_transcript: 'A reviewed synthetic transcript long enough.', p_assessment: assessment, p_rubric_id: randomUUID(), p_rubric_version: 1 })).error);
  });
  it('accepts null cached answers and makes completed replay, duplicate lease, expiry fencing, digest conflicts, and retryable failure durable', async () => {
    const attempt = await activeAttempt('replay', ownerId, true);
    const key = randomUUID(); const first = await service.rpc('claim_mmi_scoring_submission', args(attempt.id, key)); assert.equal(first.error, null);
    const [sameA, sameB] = await Promise.all([service.rpc('claim_mmi_scoring_submission', args(attempt.id, key)), service.rpc('claim_mmi_scoring_submission', args(attempt.id, key))]);
    assert.equal((sameA.data as any).code, 'submission_in_progress'); assert.equal((sameB.data as any).code, 'submission_in_progress');
    await service.rpc('fail_mmi_scoring_submission', { p_claim_id: (first.data as any).claimId, p_lease_token: (first.data as any).leaseToken, p_safe_error_code: 'scoring_unavailable' });
    const retry = await service.rpc('claim_mmi_scoring_submission', args(attempt.id, key)); assert.equal((retry.data as any).code, 'claimed');
    assert.equal((await service.rpc('claim_mmi_scoring_submission', args(attempt.id, key, 'b'.repeat(64)))).data.code, 'idempotency_conflict');
    await service.from('mmi_scoring_claims').update({ lease_expires_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', (retry.data as any).claimId);
    const recovered = await service.rpc('claim_mmi_scoring_submission', args(attempt.id, key)); assert.notEqual((recovered.data as any).leaseToken, (retry.data as any).leaseToken);
    assert.ok((await service.rpc('fail_mmi_scoring_submission', { p_claim_id: (retry.data as any).claimId, p_lease_token: (retry.data as any).leaseToken, p_safe_error_code: 'scoring_unavailable' })).error);
  });

  it('creates exactly one result, restores a completed replay after Continue, and rejects continuation after final feedback', async () => {
    const attempt = await activeAttempt('progression');
    const firstKey = randomUUID();
    const first = await service.rpc('claim_mmi_scoring_submission', argsForPrompt(attempt.id, ids.standardPrompt1, firstKey, 'c'.repeat(64)));
    assert.equal(first.error, null, first.error?.message);
    const firstCompletion = await service.rpc('complete_mmi_scoring_submission', {
      p_claim_id: (first.data as any).claimId, p_lease_token: (first.data as any).leaseToken,
      p_transcript: 'A reviewed synthetic transcript with enough safe reasoning.', p_assessment: assessment,
      p_rubric_id: rubricId, p_rubric_version: 1,
    });
    assert.equal(firstCompletion.error, null, firstCompletion.error?.message);
    assert.equal((firstCompletion.data as any).attemptStatus, 'in_progress');
    assert.equal((firstCompletion.data as any).hasNextPrompt, true);
    const beforeContinue = await service.from('mmi_prompt_attempts').select('id').eq('attempt_id', attempt.id);
    assert.equal(beforeContinue.data?.length, 1);

    const advanced = await service.rpc('advance_mmi_attempt_after_feedback', { p_user_id: ownerId, p_attempt_id: attempt.id });
    assert.equal(advanced.error, null, advanced.error?.message);
    assert.equal((advanced.data as any).prompt.order, 2);
    const replay = await service.rpc('claim_mmi_scoring_submission', argsForPrompt(attempt.id, ids.standardPrompt1, firstKey, 'c'.repeat(64)));
    assert.equal(replay.error, null, replay.error?.message);
    assert.equal((replay.data as any).code, 'completed');
    const afterReplay = await service.from('mmi_prompt_attempts').select('id').eq('attempt_id', attempt.id);
    assert.equal(afterReplay.data?.length, 1);

    assert.equal((replay.data as any).promptOrder, 1);
    assert.equal((replay.data as any).expectedPromptCount, 2);
    const finalKey = randomUUID();
    const final = await service.rpc('claim_mmi_scoring_submission', argsForPrompt(attempt.id, ids.standardPrompt2, finalKey, 'd'.repeat(64)));
    assert.equal(final.error, null, final.error?.message);
    const finalCompletion = await service.rpc('complete_mmi_scoring_submission', {
      p_claim_id: (final.data as any).claimId, p_lease_token: (final.data as any).leaseToken,
      p_transcript: 'A final reviewed synthetic transcript with clear reasoning.', p_assessment: assessment,
      p_rubric_id: rubricId, p_rubric_version: 1,
    });
    assert.equal(finalCompletion.error, null, finalCompletion.error?.message);
    assert.equal((finalCompletion.data as any).attemptStatus, 'completed');
    const finalReplay = await service.rpc('claim_mmi_scoring_submission', argsForPrompt(attempt.id, ids.standardPrompt2, finalKey, 'd'.repeat(64)));
    assert.equal((finalReplay.data as any).code, 'completed');
    assert.equal((finalReplay.data as any).promptOrder, 2);
    assert.equal((finalReplay.data as any).expectedPromptCount, 2);
    assert.ok((await service.rpc('advance_mmi_attempt_after_feedback', { p_user_id: ownerId, p_attempt_id: attempt.id })).error);
  });

  it('keeps retry, failure, and re-claim operations lock-order compatible', async () => {
    const attempt = await activeAttempt('lock-order-race');
    const key = randomUUID();
    const first = await service.rpc('claim_mmi_scoring_submission', args(attempt.id, key));
    assert.equal(first.error, null, first.error?.message);
    const { error: expiryError } = await service.from('mmi_scoring_claims').update({ lease_expires_at: new Date(Date.now() - 1_000).toISOString() })
      .eq('id', (first.data as any).claimId);
    assert.equal(expiryError, null, expiryError?.message);
    const [failure, reclaimed] = await Promise.all([
      service.rpc('fail_mmi_scoring_submission', { p_claim_id: (first.data as any).claimId, p_lease_token: (first.data as any).leaseToken, p_safe_error_code: 'scoring_unavailable' }),
      service.rpc('claim_mmi_scoring_submission', args(attempt.id, key)),
    ]);
    assert.notEqual(failure.error?.code, '40P01', failure.error?.message);
    assert.notEqual(reclaimed.error?.code, '40P01', reclaimed.error?.message);
    assert.ok(failure.error === null || failure.error.code === 'P0001', failure.error?.message);
    assert.equal(reclaimed.error, null, reclaimed.error?.message);
    assert.equal((reclaimed.data as any).code, 'claimed');
    const { data: finalClaim, error: finalClaimError } = await service.from('mmi_scoring_claims')
      .select('status,lease_token,completion_reservation_at').eq('id', (first.data as any).claimId).single();
    assert.equal(finalClaimError, null, finalClaimError?.message);
    assert.equal(finalClaim.status, 'claimed');
    assert.equal(finalClaim.lease_token, (reclaimed.data as any).leaseToken);
    assert.ok(finalClaim.completion_reservation_at);
  });

  it('rejects an eligible claim after 20 real provider attempts in the rolling hour', async () => {
    const userId = await createRateLimitUser('hourly-cap');
    const seededAt = await seedProviderAttemptClaims(userId, 20);
    const attempt = await activeAttempt('hourly-cap-target', userId);

    const result = await service.rpc(
      'claim_mmi_scoring_submission', claimArgs(userId, attempt.id),
    );

    assert.equal(result.error, null, result.error?.message);
    assert.equal((result.data as any).code, 'rate_limited');
    const expected = Math.ceil((Date.parse(seededAt) + 60 * 60 * 1_000 - Date.now()) / 1_000);
    assert.ok((result.data as any).retryAfter >= expected - 2 && (result.data as any).retryAfter <= expected + 2);
  });

  it('rejects an eligible claim after 60 completed submissions in the rolling day', async () => {
    const userId = await createRateLimitUser('daily-cap');
    const seededAt = await seedCompletedClaims(userId, 60);
    const attempt = await activeAttempt('daily-cap-target', userId);

    const result = await service.rpc(
      'claim_mmi_scoring_submission', claimArgs(userId, attempt.id),
    );

    assert.equal(result.error, null, result.error?.message);
    assert.equal((result.data as any).code, 'rate_limited');
    const expected = Math.ceil((Date.parse(seededAt) + 24 * 60 * 60 * 1_000 - Date.now()) / 1_000);
    assert.ok((result.data as any).retryAfter >= expected - 2 && (result.data as any).retryAfter <= expected + 2);
  });

  it('serializes different attempts so only one claim receives the twentieth hourly allowance', async () => {
    const userId = await createRateLimitUser('hourly-boundary');
    const seededAt = await seedProviderAttemptClaims(userId, 19);
    const firstAttempt = await activeAttempt('hourly-boundary-first', userId);
    const secondAttempt = await activeAttempt('hourly-boundary-second', userId);

    const [first, second] = await Promise.all([
      service.rpc('claim_mmi_scoring_submission', claimArgs(userId, firstAttempt.id)),
      service.rpc('claim_mmi_scoring_submission', claimArgs(userId, secondAttempt.id)),
    ]);

    assert.equal(first.error, null, first.error?.message);
    assert.equal(second.error, null, second.error?.message);
    assert.deepEqual(
      [(first.data as any).code, (second.data as any).code].sort(),
      ['claimed', 'rate_limited'],
    );
    const rateLimited = [first.data, second.data].find((result: any) => result.code === 'rate_limited') as any;
    const expected = Math.ceil((Date.parse(seededAt) + 60 * 60 * 1_000 - Date.now()) / 1_000);
    assert.ok(rateLimited.retryAfter >= expected - 2 && rateLimited.retryAfter <= expected + 2);
    const { data, error } = await service.from('mmi_scoring_provider_attempts')
      .select('id').eq('user_id', userId);
    assert.equal(error, null, error?.message);
    assert.equal(
      data?.length,
      20,
    );
  });
});
