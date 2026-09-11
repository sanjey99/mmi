import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error Node's native TypeScript runner resolves explicit source extensions.
import { canRunLocalProfileElevationTests } from './mutationTestSafety.ts';

// The mutating runner executes this filename once under Vitest and once under
// node:test. Only Vitest owns the real suite; node:test records it as skipped.
const testFramework = (process.env.VITEST
  ? await import('vitest')
  : await import('node:test')) as typeof import('vitest');
const { afterAll, beforeAll, describe, it } = testFramework;

const run = process.env.VITEST
  ? describe.runIf(canRunLocalProfileElevationTests(process.env))
  : describe.skip;
const dbUrl = process.env.SUPABASE_TEST_DB_URL;
const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const userEmail = `rubric-retention-${randomUUID()}@example.test`;
let service: SupabaseClient;
let userId = '';
let sessionId = '';
let responseId = '';
const fixtureStationId = `RETENTION_${randomUUID().replaceAll('-', '')}`;
const leaseToken = randomUUID();

function sql(statement: string): string {
  assert.ok(dbUrl);
  return execFileSync('psql', ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--dbname', dbUrl], { encoding: 'utf8', input: statement }).trim();
}

function createResponseFixture(
  transcript: string,
  finalizedAt = "clock_timestamp()",
  scoringStatus = 'pending',
): { sessionId: string; responseId: string } {
  const fixtureSessionId = sql(`INSERT INTO public.candidate_mmi_station_sessions (user_id, station_id, started_at) VALUES ('${userId}', '${fixtureStationId}', clock_timestamp() - interval '12 minutes') RETURNING id;`);
  sql(`INSERT INTO public.candidate_mmi_station_prompt_snapshots(session_id,prompt_order,sub_question_id,prompt_text) SELECT '${fixtureSessionId}', question.order_num, question.sub_q_id, question.question_text FROM public.mmi_sub_questions question WHERE question.station_id='${fixtureStationId}' ORDER BY question.order_num;`);
  const fixtureResponseId = sql(`INSERT INTO public.candidate_mmi_station_responses (session_id,prompt_order,response_state,finalized_transcript,finalized_at,finalization_key,scoring_status) VALUES ('${fixtureSessionId}',1,'response','${transcript}',${finalizedAt},'${randomUUID()}','${scoringStatus}') RETURNING id;`);
  return { sessionId: fixtureSessionId, responseId: fixtureResponseId };
}

function assessmentFor(criteria: Array<{ criterionId: string }>) {
  return {
    schemaVersion: 3,
    questionScorePct: 0,
    criteria: criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      achieved: false,
      weightPct: Number((100 / criteria.length).toFixed(2)),
    })),
  };
}

function scoredUsage(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'anthropic', model: 'local-test', inputTokens: 1, cachedInputTokens: 0,
    outputTokens: 1, inputRatePerMillion: 0, cachedInputRatePerMillion: 0,
    outputRatePerMillion: 0, currency: 'USD', estimatedCost: 0, latencyMs: 1,
    outcome: 'scored', ...overrides,
  };
}

run('MMI rubric scoring retention (explicit disposable local database only)', () => {
  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    const created = await service.auth.admin.createUser({ email: userEmail, password: `Local-only-${randomUUID()}!`, email_confirm: true });
    assert.equal(created.error, null, created.error?.message);
    userId = created.data.user!.id;
    sql(`INSERT INTO public.mmi_stations(station_id,category,topic,difficulty,uni_tags,prep_time_sec,status,scenario_text,source_namespace,source_manifest_sha256) VALUES ('${fixtureStationId}','ethics','Retention fixture','intermediate','{}',60,'published','A safe local fixture scenario.','retention_test','${'a'.repeat(64)}');
INSERT INTO public.mmi_sub_questions(sub_q_id,station_id,order_num,question_text,time_limit_sec,source_namespace,source_manifest_sha256) SELECT '${fixtureStationId}_Q' || order_num, '${fixtureStationId}', order_num, 'Fixture question ' || order_num, 120, 'retention_test', '${'a'.repeat(64)}' FROM generate_series(1,5) AS order_num;
INSERT INTO public.mmi_marking_criteria(criterion_id,sub_q_id,order_num,bullet_text,source_weight,domain,source_namespace,source_manifest_sha256) SELECT '${fixtureStationId}_C' || question_order, '${fixtureStationId}_Q' || question_order, 1, 'Fixture criterion ' || question_order, 1, 'safety', 'retention_test', '${'a'.repeat(64)}' FROM generate_series(1,5) AS question_order;`);
    sessionId = sql(`INSERT INTO public.candidate_mmi_station_sessions (user_id, station_id, started_at) VALUES ('${userId}', '${fixtureStationId}', clock_timestamp() - interval '12 minutes') RETURNING id;`);
    sql(`INSERT INTO public.candidate_mmi_station_prompt_snapshots(session_id,prompt_order,sub_question_id,prompt_text) SELECT '${sessionId}', question.order_num, question.sub_q_id, question.question_text FROM public.mmi_sub_questions question WHERE question.station_id='${fixtureStationId}' ORDER BY question.order_num;`);
    const promptOrder = sql(`SELECT prompt_order FROM public.candidate_mmi_station_prompt_snapshots WHERE session_id='${sessionId}' ORDER BY prompt_order LIMIT 1;`);
    assert.equal(promptOrder, '1');
    responseId = sql(`INSERT INTO public.candidate_mmi_station_responses (session_id,prompt_order,response_state,finalized_transcript,finalized_at,finalization_key,scoring_status) VALUES ('${sessionId}',1,'response','local fixture answer',clock_timestamp(), '${randomUUID()}','pending') RETURNING id;`);
  });

  afterAll(async () => {
    if (userId) await service.auth.admin.deleteUser(userId);
    sql(`DELETE FROM public.mmi_marking_criteria WHERE source_namespace='retention_test' AND sub_q_id LIKE '${fixtureStationId}%'; DELETE FROM public.mmi_sub_questions WHERE station_id='${fixtureStationId}'; DELETE FROM public.mmi_stations WHERE station_id='${fixtureStationId}';`);
  });

  it('stores decisions and metered usage then erases the finalized transcript in the same completion RPC', async () => {
    const claim = await service.rpc('claim_candidate_mmi_response_scoring', { p_user_id: userId, p_session_id: sessionId, p_prompt_order: 1, p_lease_token: leaseToken });
    assert.equal(claim.error, null, claim.error?.message);
    const criteria = (claim.data as { criteria: Array<{ criterionId: string }> }).criteria;
    const assessment = assessmentFor(criteria);
    const usage = scoredUsage();
    const complete = await service.rpc('complete_candidate_mmi_response_scoring', { p_response_id: responseId, p_session_id: sessionId, p_lease_token: leaseToken, p_public_assessment: assessment, p_usage: usage });
    assert.equal(complete.error, null, complete.error?.message);
    assert.deepEqual(complete.data, { status: 'scored' });
    const persisted = sql(`SELECT scoring_status || '|' || coalesce(finalized_transcript,'<null>') || '|' || (SELECT count(*) FROM public.mmi_ai_usage_events WHERE response_id='${responseId}') FROM public.candidate_mmi_station_responses WHERE id='${responseId}';`);
    assert.equal(persisted, 'scored|<null>|1');
  });

  it('rolls back completion when inserting its usage event fails, leaving an unscored retryable transcript', async () => {
    const fixture = createResponseFixture('retryable transcript');
    const failedLease = randomUUID();
    const claim = await service.rpc('claim_candidate_mmi_response_scoring', { p_user_id: userId, p_session_id: fixture.sessionId, p_prompt_order: 1, p_lease_token: failedLease });
    assert.equal(claim.error, null, claim.error?.message);
    const criteria = (claim.data as { criteria: Array<{ criterionId: string }> }).criteria;
    const completion = await service.rpc('complete_candidate_mmi_response_scoring', {
      p_response_id: fixture.responseId, p_session_id: fixture.sessionId, p_lease_token: failedLease,
      p_public_assessment: assessmentFor(criteria),
      // This satisfies the RPC envelope but violates the usage-event check,
      // forcing the insert transaction to roll back.
      p_usage: scoredUsage({ inputRatePerMillion: -1 }),
    });
    assert.equal(completion.data, null);
    assert.ok(completion.error);
    assert.equal(sql(`SELECT scoring_status || '|' || finalized_transcript FROM public.candidate_mmi_station_responses WHERE id='${fixture.responseId}';`), 'in_progress|retryable transcript');
    assert.equal(sql(`SELECT count(*) FROM public.mmi_ai_usage_events WHERE response_id='${fixture.responseId}';`), '0');
  });

  it('purges pending text and drafts at 24 hours while marking feedback unavailable', async () => {
    const fixture = createResponseFixture('expired transcript', "clock_timestamp() - interval '24 hours 1 second'");
    sql(`INSERT INTO public.candidate_mmi_station_response_drafts(session_id,prompt_order,transcript,client_revision,accepted_at) VALUES ('${fixture.sessionId}',1,'expired draft',1,clock_timestamp()-interval '24 hours 1 second');`);
    const purge = await service.rpc('purge_expired_candidate_mmi_free_text', { p_now: new Date().toISOString() });
    assert.equal(purge.error, null, purge.error?.message);
    assert.equal(sql(`SELECT scoring_status || '|' || coalesce(finalized_transcript,'<null>') FROM public.candidate_mmi_station_responses WHERE id='${fixture.responseId}';`), 'feedback_unavailable|<null>');
    assert.equal(sql(`SELECT count(*) FROM public.candidate_mmi_station_response_drafts WHERE session_id='${fixture.sessionId}' AND prompt_order=1;`), '0');
  });

  it('uses the 24-hour purge cutoff without deleting a live leased transcript', async () => {
    const liveSession = sql(`INSERT INTO public.candidate_mmi_station_sessions (user_id,station_id,started_at) VALUES ('${userId}','${fixtureStationId}',clock_timestamp()-interval '12 minutes') RETURNING id;`);
    const promptId = sql(`SELECT sub_q_id FROM public.mmi_sub_questions WHERE station_id='${fixtureStationId}' ORDER BY order_num LIMIT 1;`);
    sql(`INSERT INTO public.candidate_mmi_station_prompt_snapshots(session_id,prompt_order,sub_question_id,prompt_text) VALUES ('${liveSession}',1,'${promptId}','local prompt');`);
    const liveResponse = sql(`INSERT INTO public.candidate_mmi_station_responses (session_id,prompt_order,response_state,finalized_transcript,finalized_at,finalization_key,scoring_status) VALUES ('${liveSession}',1,'response','live transcript',clock_timestamp()-interval '25 hours','${randomUUID()}','in_progress') RETURNING id;`);
    sql(`INSERT INTO public.candidate_mmi_response_scoring_claims(response_id,lease_token,lease_expires_at) VALUES ('${liveResponse}','${randomUUID()}',clock_timestamp()+interval '5 minutes');`);
    const purge = await service.rpc('purge_expired_candidate_mmi_free_text', { p_now: new Date().toISOString() });
    assert.equal(purge.error, null, purge.error?.message);
    assert.equal(sql(`SELECT finalized_transcript FROM public.candidate_mmi_station_responses WHERE id='${liveResponse}';`), 'live transcript');
  });

  it('keeps usage events service-only', async () => {
    const anonymous = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { data, error } = await anonymous.from('mmi_ai_usage_events').select('*').limit(1);
    assert.equal(data, null);
    assert.equal(error?.code, '42501');
  });
});
