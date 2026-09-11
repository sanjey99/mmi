import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error Node's native TypeScript runner resolves explicit source extensions.
import { canRunLocalProfileElevationTests } from './mutationTestSafety.ts';
// @ts-expect-error Node's native TypeScript runner resolves explicit source extensions.
import { createCandidateMmiApi } from '../../src/features/candidateMmi/api.ts';

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
const suffix = randomUUID().replaceAll('-', '');
const stationId = `ADMIN_${suffix}`;
const duplicateStationId = `DUPLICATE_${suffix}`;
const incompleteStationId = `INCOMPLETE_${suffix}`;
const assessmentStationId = `ASSESS_${suffix}`;
const panelId = `PANEL_${suffix}`;
const adminEmail = `mmi-admin-${suffix}@example.test`;
const candidateEmail = `mmi-candidate-${suffix}@example.test`;
const password = `Local-only-${randomUUID()}!`;
let service: SupabaseClient;
let admin: SupabaseClient;
let candidate: SupabaseClient;
let adminId = '';
let candidateId = '';
let responseId = '';
let appConfigSnapshot: string | null = null;

function sql(statement: string): string {
  assert.ok(dbUrl);
  return execFileSync('psql', [
    '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
    '--set', 'ON_ERROR_STOP=1', '--dbname', dbUrl,
  ], { encoding: 'utf8', input: statement }).trim();
}

function completeStationPayload(id: string, expectedVersion: number | null) {
  return {
    stationId: id,
    expectedVersion,
    category: 'ethics',
    topic: 'Admin fixture',
    difficulty: 'intermediate',
    universityTags: ['final-high'],
    prepTimeSec: 60,
    imageUrl: null,
    scenarioText: 'A synthetic local-only scenario.',
    questions: [1, 2, 3, 4, 5].map((order) => ({
      subQuestionId: `${id}_Q${order}`,
      order,
      questionText: `Synthetic question ${order}`,
      timeLimitSec: 120,
      modelAnswerCached: null,
      criteria: [{ criterionId: `${id}_Q${order}_C1`, order: 1, bulletText: `Criterion ${order}`, domain: 'safety', sourceWeight: 1 }],
    })),
  };
}

function assertNoForbiddenKeys(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenKeys);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    assert.equal(/transcript|answertext|evidence|raw.*response|apikey/.test(normalized), false, `forbidden key: ${key}`);
    assertNoForbiddenKeys(nested);
  }
}

run('privacy-safe MMI admin operations (explicit disposable local database only)', () => {
  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    appConfigSnapshot = sql(`SELECT COALESCE(jsonb_agg(to_jsonb(config) ORDER BY config.key), '[]'::jsonb)::text
FROM public.app_config AS config
WHERE config.key IN ('ai_api_key','ai_provider','ai_model','ai_base_url','ai_input_rate_per_million','ai_cached_input_rate_per_million','ai_output_rate_per_million');`);
    const createdAdmin = await service.auth.admin.createUser({ email: adminEmail, password, email_confirm: true, user_metadata: { full_name: 'Admin Reviewer' } });
    const createdCandidate = await service.auth.admin.createUser({ email: candidateEmail, password, email_confirm: true, user_metadata: { full_name: 'Candidate A' } });
    assert.equal(createdAdmin.error, null, createdAdmin.error?.message);
    assert.equal(createdCandidate.error, null, createdCandidate.error?.message);
    adminId = createdAdmin.data.user!.id;
    candidateId = createdCandidate.data.user!.id;
    sql(`UPDATE public.profiles SET is_admin=TRUE WHERE id='${adminId}';
UPDATE public.profiles SET university_target='final-high' WHERE id='${candidateId}';
INSERT INTO public.mmi_stations(station_id,category,topic,difficulty,uni_tags,prep_time_sec,status,scenario_text,source_namespace,source_manifest_sha256,content_version)
VALUES ('${assessmentStationId}','ethics','Assessment fixture','intermediate',ARRAY['all'],60,'published','Synthetic assessment scenario','admin_test','${'a'.repeat(64)}',1);
INSERT INTO public.mmi_sub_questions(sub_q_id,station_id,order_num,question_text,time_limit_sec,source_namespace,source_manifest_sha256)
SELECT '${assessmentStationId}_Q' || n,'${assessmentStationId}',n,'Synthetic question ' || n,120,'admin_test','${'a'.repeat(64)}' FROM generate_series(1,5) AS n;
INSERT INTO public.mmi_marking_criteria(criterion_id,sub_q_id,order_num,bullet_text,source_weight,domain,source_namespace,source_manifest_sha256)
SELECT '${assessmentStationId}_Q' || n || '_C1','${assessmentStationId}_Q' || n,1,'Safe criterion ' || n,1,'safety','admin_test','${'a'.repeat(64)}' FROM generate_series(1,5) AS n;
INSERT INTO public.mmi_station_versions(station_id,version,content_snapshot)
VALUES ('${assessmentStationId}',1,jsonb_build_object('stationId','${assessmentStationId}','contentVersion',1,'category','ethics','topic','Assessment fixture','difficulty','intermediate','universityTags',jsonb_build_array('all'),'prepTimeSec',60,'imageUrl',NULL,'scenarioText','Synthetic assessment scenario','questions','[]'::jsonb));
INSERT INTO public.app_config(key,value) VALUES ('ai_api_key','local-secret-must-survive') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;`);
    admin = createClient(url!, anonKey!, { auth: { persistSession: false } });
    candidate = createClient(url!, anonKey!, { auth: { persistSession: false } });
    assert.equal((await admin.auth.signInWithPassword({ email: adminEmail, password })).error, null);
    assert.equal((await candidate.auth.signInWithPassword({ email: candidateEmail, password })).error, null);

    const sessionId = sql(`INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,practice_scope,scenario_text_snapshot,station_version_snapshot)
VALUES ('${candidateId}','${assessmentStationId}',clock_timestamp()-interval '12 minutes','all','Synthetic assessment scenario',1) RETURNING id;`);
    sql(`INSERT INTO public.candidate_mmi_station_prompt_snapshots(session_id,prompt_order,sub_question_id,prompt_text)
SELECT '${sessionId}',order_num,sub_q_id,question_text FROM public.mmi_sub_questions WHERE station_id='${assessmentStationId}' ORDER BY order_num;`);
    responseId = sql(`INSERT INTO public.candidate_mmi_station_responses(session_id,prompt_order,response_state,finalized_transcript,finalized_at,finalization_key,scoring_status,public_assessment,transcript_purged_at)
VALUES ('${sessionId}',1,'response',NULL,clock_timestamp()-interval '1 minute','${randomUUID()}','scored','{"schemaVersion":3,"questionScorePct":100,"criteria":[{"criterionId":"${assessmentStationId}_Q1_C1","achieved":true,"weightPct":100}]}'::jsonb,clock_timestamp()) RETURNING id;`);
    sql(`INSERT INTO public.mmi_ai_usage_events(user_id,session_id,response_id,lease_token,provider,model,input_tokens,cached_input_tokens,output_tokens,input_rate_per_million,cached_input_rate_per_million,output_rate_per_million,estimated_cost,latency_ms,outcome)
VALUES ('${candidateId}','${sessionId}','${responseId}','${randomUUID()}','anthropic','local-model',100,5,20,1,0.1,5,0.00020050,350,'scored');`);
  });

  afterAll(async () => {
    if (appConfigSnapshot !== null) {
      const snapshot = appConfigSnapshot.replaceAll("'", "''");
      sql(`DELETE FROM public.app_config
WHERE key IN ('ai_api_key','ai_provider','ai_model','ai_base_url','ai_input_rate_per_million','ai_cached_input_rate_per_million','ai_output_rate_per_million');
INSERT INTO public.app_config(key,value,updated_at)
SELECT restored.key,restored.value,restored.updated_at
FROM jsonb_to_recordset('${snapshot}'::jsonb) AS restored(key text,value text,updated_at timestamptz);`);
    }
    if (adminId || candidateId) {
      sql(`DELETE FROM public.mmi_admin_access_audit
WHERE admin_user_id='${adminId}' OR subject_user_id='${candidateId}';
DELETE FROM public.mmi_admin_change_audit
WHERE admin_user_id='${adminId}' OR target_id IN ('${stationId}','${panelId}','ai_config');`);
    }
    if (adminId) await service.auth.admin.deleteUser(adminId);
    if (candidateId) await service.auth.admin.deleteUser(candidateId);
    sql(`DELETE FROM public.mmi_panel_questions WHERE question_id='${panelId}';
BEGIN;
SET LOCAL session_replication_role=replica;
DELETE FROM public.mmi_station_versions WHERE station_id IN ('${stationId}','${duplicateStationId}','${incompleteStationId}','${assessmentStationId}');
COMMIT;
DELETE FROM public.mmi_marking_criteria WHERE sub_q_id LIKE '${stationId}_Q%' OR sub_q_id LIKE '${duplicateStationId}_Q%' OR sub_q_id LIKE '${incompleteStationId}_Q%' OR sub_q_id LIKE '${assessmentStationId}_Q%';
DELETE FROM public.mmi_sub_questions WHERE station_id IN ('${stationId}','${duplicateStationId}','${incompleteStationId}','${assessmentStationId}');
DELETE FROM public.mmi_stations WHERE station_id IN ('${stationId}','${duplicateStationId}','${incompleteStationId}','${assessmentStationId}');`);
  });

  it('requires an authenticated admin and keeps both audit tables private', async () => {
    const anonymous = createClient(url!, anonKey!, { auth: { persistSession: false } });
    assert.equal((await anonymous.rpc('get_admin_mmi_dashboard')).error?.code, '42501');
    assert.equal((await candidate.rpc('get_admin_mmi_dashboard')).error?.code, '42501');
    const dashboard = await admin.rpc('get_admin_mmi_dashboard');
    assert.equal(dashboard.error, null, dashboard.error?.message);
    assertNoForbiddenKeys(dashboard.data);
    assert.deepEqual(Object.keys(dashboard.data as object).sort(), ['ai', 'contentHealth', 'stationCounts', 'universityCounts', 'usage']);
    assert.ok((await candidate.from('mmi_admin_access_audit').select('*')).error);
    assert.ok((await admin.from('mmi_admin_change_audit').select('*')).error);
  });

  it('creates immutable versions, enforces optimistic concurrency, and exposes no hard-delete RPC', async () => {
    const created = await admin.rpc('save_admin_mmi_station', { p_station: completeStationPayload(stationId, null), p_expected_version: null });
    assert.equal(created.error, null, created.error?.message);
    assert.equal((created.data as { version: number }).version, 1);
    const updatedPayload = { ...completeStationPayload(stationId, 1), topic: 'Updated topic' };
    const updated = await admin.rpc('save_admin_mmi_station', { p_station: updatedPayload, p_expected_version: 1 });
    assert.equal(updated.error, null, updated.error?.message);
    assert.equal((updated.data as { version: number }).version, 2);
    assert.equal(sql(`SELECT content_snapshot->>'topic' FROM public.mmi_station_versions WHERE station_id='${stationId}' AND version=1;`), 'Admin fixture');
    const stale = await admin.rpc('save_admin_mmi_station', { p_station: updatedPayload, p_expected_version: 1 });
    assert.equal(stale.error?.code, '40001');
    const published = await admin.rpc('set_admin_mmi_station_status', { p_station_id: stationId, p_expected_version: 2, p_status: 'published' });
    assert.equal(published.error, null, published.error?.message);
    assert.equal((published.data as { version: number }).version, 3);
    assert.equal(sql(`SELECT status || '|' || content_version FROM public.mmi_stations WHERE station_id='${stationId}';`), 'published|3');
    sql(`UPDATE public.candidate_mmi_station_sessions SET abandoned_at=clock_timestamp() WHERE user_id='${candidateId}' AND abandoned_at IS NULL;`);
    const candidateApi = createCandidateMmiApi(candidate);
    const started = await candidateApi.start('target');
    assert.equal(started.stationId, stationId);
    assert.equal(started.phase, 'scenario');
    assert.equal(started.scenarioText, 'A synthetic local-only scenario.');
    assert.equal(sql(`SELECT practice_scope || '|' || target_university_snapshot FROM public.candidate_mmi_station_sessions WHERE id='${started.sessionId}';`), 'target|final-high');
    const publishedEdit = await admin.rpc('save_admin_mmi_station', {
      p_station: { ...completeStationPayload(stationId, 3), topic: 'Must unpublish first' },
      p_expected_version: 3,
    });
    assert.equal(publishedEdit.error?.code, '22023');
    assert.ok((await admin.rpc('delete_admin_mmi_station', { p_station_id: stationId })).error);
  });

  it('rejects criterion IDs reused across questions without persisting a station or version', async () => {
    const payload = completeStationPayload(duplicateStationId, null);
    const duplicated = {
      ...payload,
      questions: payload.questions.map((question, index) => index === 1
        ? {
            ...question,
            criteria: question.criteria.map((criterion) => ({
              ...criterion,
              criterionId: payload.questions[0]!.criteria[0]!.criterionId,
            })),
          }
        : question),
    };

    const result = await admin.rpc('save_admin_mmi_station', {
      p_station: duplicated,
      p_expected_version: null,
    });
    assert.equal(result.error?.code, '22023');
    assert.equal(sql(`SELECT count(*) FROM public.mmi_stations WHERE station_id='${duplicateStationId}';`), '0');
    assert.equal(sql(`SELECT count(*) FROM public.mmi_station_versions WHERE station_id='${duplicateStationId}';`), '0');
  });

  it('manages panels and non-secret AI settings without returning or changing the API key', async () => {
    const panel = await admin.rpc('save_admin_mmi_panel', { p_panel: { questionId: panelId, questionText: 'Why medicine?', stationType: 'panel', topic: 'motivation', difficulty: 'foundation', universityTags: ['all'], notes: 'Admin only note', modelAnswerCached: null, status: 'draft' } });
    assert.equal(panel.error, null, panel.error?.message);
    const bypass = await admin.from('app_config').update({ value: 'unaudited-bypass' }).eq('key', 'ai_provider');
    assert.equal(bypass.error?.code, '42501');
    const edgeKeyWrite = await service.rpc('mutate_admin_mmi_key_from_edge', {
      p_admin_user_id: adminId,
      p_action: 'ai_key_replaced',
      p_api_key: 'local-secret-must-survive',
    });
    assert.equal(edgeKeyWrite.error, null, edgeKeyWrite.error?.message);
    const auditsBefore = Number(sql("SELECT count(*) FROM public.mmi_admin_change_audit WHERE target_type='ai_config';"));
    const saved = await admin.rpc('save_admin_ai_config', { p_provider: 'anthropic', p_model: 'local-model-2', p_base_url: null, p_input_rate: 2, p_cached_input_rate: 0.2, p_output_rate: 10 });
    assert.equal(saved.error, null, saved.error?.message);
    const config = await admin.rpc('get_admin_ai_config');
    assert.equal(config.error, null, config.error?.message);
    assert.equal((config.data as { isConfigured: boolean }).isConfigured, true);
    assertNoForbiddenKeys(config.data);
    assert.equal(sql("SELECT value FROM public.app_config WHERE key='ai_api_key';"), 'local-secret-must-survive');
    assert.equal(Number(sql("SELECT count(*) FROM public.mmi_admin_change_audit WHERE target_type='ai_config';")), auditsBefore + 1);
    assert.equal(sql("SELECT count(*) FROM public.mmi_admin_change_audit WHERE target_type='ai_config' AND metadata::text ~* 'secret|key';"), '0');
  });

  it('audits an attributed confirmed service-only key clear without retaining a key value', async () => {
    const before = Number(sql(`SELECT count(*) FROM public.mmi_admin_change_audit WHERE admin_user_id='${adminId}' AND action='ai_key_cleared';`));
    const cleared = await service.rpc('mutate_admin_mmi_key_from_edge', {
      p_admin_user_id: adminId,
      p_action: 'ai_key_cleared',
      p_api_key: null,
    });
    assert.equal(cleared.error, null, cleared.error?.message);
    assert.deepEqual(cleared.data, { configured: false });
    assert.equal(sql("SELECT value IS NULL FROM public.app_config WHERE key='ai_api_key';"), 't');
    assert.equal(Number(sql(`SELECT count(*) FROM public.mmi_admin_change_audit WHERE admin_user_id='${adminId}' AND action='ai_key_cleared';`)), before + 1);
    assert.equal(sql(`SELECT count(*) FROM public.mmi_admin_change_audit WHERE admin_user_id='${adminId}' AND action LIKE 'ai_key_%' AND metadata::text ~* 'local-secret|api[_ -]?key';`), '0');
  });

  it('returns allowlisted usage and structured assessment data and audits every detail view first', async () => {
    const usage = await admin.rpc('get_admin_mmi_usage', { p_filters: { userId: candidateId, limit: 20, offset: 0 } });
    assert.equal(usage.error, null, usage.error?.message);
    assertNoForbiddenKeys(usage.data);
    assert.equal((usage.data as { summary: { callCount: number } }).summary.callCount, 1);
    const list = await admin.rpc('list_admin_mmi_assessments', { p_filters: { userId: candidateId, limit: 20, offset: 0 } });
    assert.equal(list.error, null, list.error?.message);
    assertNoForbiddenKeys(list.data);
    assert.equal((list.data as { items: Array<{ subQuestionId: string }> }).items[0]?.subQuestionId, `${assessmentStationId}_Q1`);
    const before = Number(sql(`SELECT count(*) FROM public.mmi_admin_access_audit WHERE response_id='${responseId}';`));
    const detail = await admin.rpc('get_admin_mmi_assessment', { p_response_id: responseId, p_purpose: 'quality_audit' });
    assert.equal(detail.error, null, detail.error?.message);
    assertNoForbiddenKeys(detail.data);
    assert.equal((detail.data as { subQuestionId: string }).subQuestionId, `${assessmentStationId}_Q1`);
    assert.equal((detail.data as { criteria: Array<{ achieved: boolean }> }).criteria[0]?.achieved, true);
    assert.equal(Number(sql(`SELECT count(*) FROM public.mmi_admin_access_audit WHERE response_id='${responseId}' AND purpose='quality_audit';`)), before + 1);
    assert.equal((detail.data as { accessAuditId: string }).accessAuditId, sql(`SELECT id FROM public.mmi_admin_access_audit WHERE response_id='${responseId}' ORDER BY viewed_at DESC LIMIT 1;`));
    assert.equal((await candidate.rpc('get_admin_mmi_assessment', { p_response_id: responseId, p_purpose: 'support' })).error?.code, '42501');
    const definition = sql("SELECT pg_get_functiondef('public.get_admin_mmi_assessment(uuid,text)'::regprocedure);");
    assert.doesNotMatch(definition, /finalized_transcript|SELECT\s+\*/i);
  });

  it('rejects invalid purpose, unsafe base URLs, widened filters, and malformed publication', async () => {
    assert.equal((await admin.rpc('get_admin_mmi_assessment', { p_response_id: responseId, p_purpose: 'curiosity' })).error?.code, '22023');
    assert.equal((await admin.rpc('save_admin_ai_config', { p_provider: 'openai_compatible', p_model: 'local', p_base_url: 'http://127.0.0.1:11434/v1', p_input_rate: 0, p_cached_input_rate: 0, p_output_rate: 0 })).error?.code, '22023');
    assert.equal((await admin.rpc('get_admin_mmi_usage', { p_filters: { limit: 20, offset: 0, unexpected: true } })).error?.code, '22023');
    const incomplete = completeStationPayload(incompleteStationId, null);
    const invalid = await admin.rpc('save_admin_mmi_station', { p_station: { ...incomplete, questions: incomplete.questions.slice(0, 4) }, p_expected_version: null });
    assert.equal(invalid.error, null, invalid.error?.message);
    const publish = await admin.rpc('set_admin_mmi_station_status', { p_station_id: incompleteStationId, p_expected_version: 1, p_status: 'published' });
    assert.equal(publish.error?.code, '22023');
  });
});
