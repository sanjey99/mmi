import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error Node's native TypeScript test runner requires source extensions.
import { buildMmiPersistenceFixtures, createAuthenticatedTestClient } from './mmiPersistenceFixtures.ts';

const configPath = fileURLToPath(new URL('../../supabase/config.toml', import.meta.url).href);
const migrationPath = fileURLToPath(new URL('../../supabase/migrations/20260817003000_mmi_submission_rpcs.sql', import.meta.url).href);
const url = process.env.SUPABASE_TEST_URL;
const required = process.env.MMI_SCORING_INTEGRATION_REQUIRED === '1';
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const disposableLocal = url !== undefined && ['localhost', '127.0.0.1'].includes(new URL(url).hostname);

if (url && !disposableLocal) throw new Error('MMI scoring integration tests only run against a disposable local Supabase URL');
if (required && (!disposableLocal || !anonKey || !serviceRoleKey)) throw new Error('Required disposable local MMI scoring integration credentials are missing');

describe('MMI scoring deployment contracts', () => {
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
});

// This suite deliberately contains no fixture cleanup. A future authorized run may leave
// unique synthetic rows behind; it cannot run unless MMI_SCORING_INTEGRATION_REQUIRED=1
// and the target is localhost/127.0.0.1.

const run = required && disposableLocal && anonKey && serviceRoleKey ? describe : describe.skip;
const fixturePrefix = `mmi-scoring-${randomUUID().slice(0, 8)}`;
const { ids, promptSnapshotRow, safeContentSnapshot, weights, safetyItems } = buildMmiPersistenceFixtures(fixturePrefix);

run('MMI scoring RPCs (explicit disposable-local integration only)', () => {
  let service: SupabaseClient; let ownerId: string; let otherId: string; let rubricId: string;
  const digest = 'a'.repeat(64);
  const args = (attemptId: string, key = randomUUID(), requestDigest = digest) => ({
    p_user_id: ownerId, p_attempt_id: attemptId, p_idempotency_key: key, p_prompt_kind: 'standard',
    p_station_id: ids.standard, p_sub_question_id: ids.standardPrompt1, p_request_digest: requestDigest,
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
    }
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
  }
  async function activeAttempt(label: string, userId = ownerId, nullCachedAnswer = false) {
    const [attempt] = await insert('mmi_attempts', { user_id: userId, station_kind: 'standard', standard_station_id: ids.standard,
      status: 'in_progress', phase: 'preparing', current_prompt_order: 1, expected_prompt_count: 2, content_snapshot: safeContentSnapshot(), privacy_notice_version: ids.noticeAccount,
      privacy_notice_acknowledged_at: new Date().toISOString(), started_at: new Date().toISOString() });
    const firstSnapshot = promptSnapshotRow(attempt, 1, rubricId);
    if (nullCachedAnswer) (firstSnapshot as Record<string, unknown>).hidden_reference_answer = null;
    await insert('mmi_attempt_prompt_snapshots', [firstSnapshot, promptSnapshotRow(attempt, 2, rubricId)]);
    const { error } = await service.from('mmi_attempts').update({ phase: 'prompt_active' }).eq('id', attempt.id); assert.equal(error, null, error?.message);
    return attempt as { id: string };
  }
  before(async () => {
    service = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });
    const password = `Local-only-${randomUUID()}!`;
    ({ userId: ownerId } = await createAuthenticatedTestClient({ service, url: url!, anonKey: anonKey!, password, fixturePrefix, label: 'owner' }));
    ({ userId: otherId } = await createAuthenticatedTestClient({ service, url: url!, anonKey: anonKey!, password, fixturePrefix, label: 'other' }));
    await insert('mmi_stations', { station_id: ids.standard, category: 'ethics', topic: 'Synthetic', difficulty: 'intermediate', prep_time_sec: 1, status: 'draft', scenario_text: 'Synthetic.' });
    await insert('mmi_sub_questions', [{ sub_q_id: ids.standardPrompt1, station_id: ids.standard, order_num: 1, question_text: 'One?', time_limit_sec: 120 }, { sub_q_id: ids.standardPrompt2, station_id: ids.standard, order_num: 2, question_text: 'Two?', time_limit_sec: 120 }]);
    await insert('mmi_privacy_notices', { version: ids.noticeAccount, processor_name: 'Synthetic', notice_text: 'Synthetic local notice.', retention_mode: 'account_lifetime', published_at: new Date().toISOString(), is_active: true });
    const [rubric] = await insert('mmi_scoring_rubrics', { standard_sub_q_id: ids.standardPrompt1, version: 1, status: 'active', criteria: { summary: 'Synthetic.' }, dimension_weights: weights, safety_critical_items: safetyItems, clinician_reviewed_at: new Date().toISOString(), clinician_reviewed_by: ownerId }); rubricId = rubric.id;
  });
  it('enforces identity, stale order, cross-user ownership, and pinned-rubric fencing', async () => {
    const attempt = await activeAttempt('identity');
    for (const mutation of [{ p_station_id: `${ids.standard}-wrong` }, { p_sub_question_id: ids.standardPrompt2 }, { p_user_id: otherId }]) {
      const { error } = await service.rpc('claim_mmi_scoring_submission', { ...args(attempt.id), ...mutation }); assert.ok(error);
    }
    await service.from('mmi_attempts').update({ current_prompt_order: 2 }).eq('id', attempt.id);
    assert.ok((await service.rpc('claim_mmi_scoring_submission', args(attempt.id))).error);
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

  it('rejects an eligible claim after 20 real provider attempts in the rolling hour', async () => {
    const userId = await createRateLimitUser('hourly-cap');
    await seedProviderAttemptClaims(userId, 20);
    const attempt = await activeAttempt('hourly-cap-target', userId);

    const result = await service.rpc(
      'claim_mmi_scoring_submission', claimArgs(userId, attempt.id),
    );

    assert.equal(result.error, null, result.error?.message);
    assert.equal((result.data as any).code, 'rate_limited');
    assert.equal((result.data as any).retryAfter, 60);
  });

  it('rejects an eligible claim after 60 completed submissions in the rolling day', async () => {
    const userId = await createRateLimitUser('daily-cap');
    await seedCompletedClaims(userId, 60);
    const attempt = await activeAttempt('daily-cap-target', userId);

    const result = await service.rpc(
      'claim_mmi_scoring_submission', claimArgs(userId, attempt.id),
    );

    assert.equal(result.error, null, result.error?.message);
    assert.equal((result.data as any).code, 'rate_limited');
    assert.equal((result.data as any).retryAfter, 300);
  });

  it('serializes different attempts so only one claim receives the twentieth hourly allowance', async () => {
    const userId = await createRateLimitUser('hourly-boundary');
    await seedProviderAttemptClaims(userId, 19);
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
    assert.equal(rateLimited.retryAfter, 60);
    const { data, error } = await service.from('mmi_scoring_claims')
      .select('provider_attempt_count').eq('user_id', userId);
    assert.equal(error, null, error?.message);
    assert.equal(
      (data ?? []).reduce((total, claim) => total + claim.provider_attempt_count, 0),
      20,
    );
  });
});
