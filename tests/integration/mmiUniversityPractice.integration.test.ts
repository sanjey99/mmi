import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error Node's native TypeScript runner resolves explicit source extensions.
import { canRunLocalProfileElevationTests } from './mutationTestSafety.ts';

const framework = (process.env.VITEST ? await import('vitest') : await import('node:test')) as typeof import('vitest');
const { afterAll, beforeAll, describe, it } = framework;
const run = process.env.VITEST ? describe.runIf(canRunLocalProfileElevationTests(process.env)) : describe.skip;
const dbUrl = process.env.SUPABASE_TEST_DB_URL;
const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const prefix = `university-${randomUUID().replaceAll('-', '')}`;
const stationId = `MMI_000_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const archivedStationId = `${stationId}_ARCHIVED`;
const wrongTimingStationId = `${stationId}_WRONG_TIME`;
const missingQuestionStationId = `${stationId}_MISSING_QUESTION`;
const criterionlessStationId = `${stationId}_CRITERIONLESS`;
const password = `Local-only-${randomUUID()}!`;
let service: SupabaseClient;
let owner: SupabaseClient;
let other: SupabaseClient;
let ownerId = '';
let otherId = '';
let sessionId = '';
let noResponseSessionId = '';

function sql(statement: string): string {
  assert.ok(dbUrl);
  return execFileSync('psql', ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--dbname', dbUrl], { encoding: 'utf8', input: statement }).trim();
}

run('university-scoped candidate MMI practice (disposable local database only)', () => {
  beforeAll(async () => {
    service = createClient(url!, serviceKey!, { auth: { persistSession: false } });
    const ownerEmail = `${prefix}-owner@example.test`;
    const otherEmail = `${prefix}-other@example.test`;
    const createdOwner = await service.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
    const createdOther = await service.auth.admin.createUser({ email: otherEmail, password, email_confirm: true });
    assert.equal(createdOwner.error, null, createdOwner.error?.message);
    assert.equal(createdOther.error, null, createdOther.error?.message);
    ownerId = createdOwner.data.user!.id;
    otherId = createdOther.data.user!.id;
    sql(`UPDATE public.profiles SET university_target='Oxford' WHERE id='${ownerId}';
INSERT INTO public.mmi_stations(station_id,category,topic,difficulty,uni_tags,prep_time_sec,status,scenario_text,source_namespace,source_manifest_sha256) VALUES
('${stationId}','ethics','University fixture','intermediate','{snapshot}',60,'draft','Live scenario that must not leak','university_test','${'b'.repeat(64)}'),
('${archivedStationId}','ethics','Archived fixture','intermediate','{oxford}',60,'archived','Archived','university_test','${'b'.repeat(64)}'),
('${wrongTimingStationId}','ethics','Wrong timing fixture','intermediate','{oxford}',61,'published','Wrong timing','university_test','${'b'.repeat(64)}'),
('${missingQuestionStationId}','ethics','Missing question fixture','intermediate','{oxford}',60,'published','Missing question','university_test','${'b'.repeat(64)}'),
('${criterionlessStationId}','ethics','No rubric fixture','intermediate','{oxford}',60,'published','No rubric','university_test','${'b'.repeat(64)}');
INSERT INTO public.mmi_sub_questions(sub_q_id,station_id,order_num,question_text,time_limit_sec,source_namespace,source_manifest_sha256) SELECT '${stationId}_Q' || order_num,'${stationId}',order_num,'Question ' || order_num,120,'university_test','${'b'.repeat(64)}' FROM generate_series(1,5) order_num;
INSERT INTO public.mmi_sub_questions(sub_q_id,station_id,order_num,question_text,time_limit_sec,source_namespace,source_manifest_sha256) SELECT '${archivedStationId}_Q' || order_num,'${archivedStationId}',order_num,'Archived question ' || order_num,120,'university_test','${'b'.repeat(64)}' FROM generate_series(1,5) order_num;
INSERT INTO public.mmi_sub_questions(sub_q_id,station_id,order_num,question_text,time_limit_sec,source_namespace,source_manifest_sha256) SELECT '${wrongTimingStationId}_Q' || order_num,'${wrongTimingStationId}',order_num,'Wrong-time question ' || order_num,120,'university_test','${'b'.repeat(64)}' FROM generate_series(1,5) order_num;
INSERT INTO public.mmi_sub_questions(sub_q_id,station_id,order_num,question_text,time_limit_sec,source_namespace,source_manifest_sha256) SELECT '${missingQuestionStationId}_Q' || order_num,'${missingQuestionStationId}',order_num,'Missing question ' || order_num,120,'university_test','${'b'.repeat(64)}' FROM generate_series(1,4) order_num;
INSERT INTO public.mmi_sub_questions(sub_q_id,station_id,order_num,question_text,time_limit_sec,source_namespace,source_manifest_sha256) SELECT '${criterionlessStationId}_Q' || order_num,'${criterionlessStationId}',order_num,'No-rubric question ' || order_num,120,'university_test','${'b'.repeat(64)}' FROM generate_series(1,5) order_num;
INSERT INTO public.mmi_marking_criteria(criterion_id,sub_q_id,order_num,bullet_text,source_weight,domain,source_namespace,source_manifest_sha256) SELECT '${stationId}_C' || order_num,'${stationId}_Q' || order_num,1,'Criterion ' || order_num,1,'safety','university_test','${'b'.repeat(64)}' FROM generate_series(1,5) order_num;
INSERT INTO public.mmi_marking_criteria(criterion_id,sub_q_id,order_num,bullet_text,source_weight,domain,source_namespace,source_manifest_sha256) SELECT '${archivedStationId}_C' || order_num,'${archivedStationId}_Q' || order_num,1,'Archived criterion ' || order_num,1,'safety','university_test','${'b'.repeat(64)}' FROM generate_series(1,5) order_num;
INSERT INTO public.mmi_marking_criteria(criterion_id,sub_q_id,order_num,bullet_text,source_weight,domain,source_namespace,source_manifest_sha256) SELECT '${wrongTimingStationId}_C' || order_num,'${wrongTimingStationId}_Q' || order_num,1,'Wrong-time criterion ' || order_num,1,'safety','university_test','${'b'.repeat(64)}' FROM generate_series(1,5) order_num;
INSERT INTO public.mmi_marking_criteria(criterion_id,sub_q_id,order_num,bullet_text,source_weight,domain,source_namespace,source_manifest_sha256) SELECT '${missingQuestionStationId}_C' || order_num,'${missingQuestionStationId}_Q' || order_num,1,'Missing criterion ' || order_num,1,'safety','university_test','${'b'.repeat(64)}' FROM generate_series(1,4) order_num;`);
    owner = createClient(url!, process.env.SUPABASE_TEST_ANON_KEY!, { auth: { persistSession: false } });
    other = createClient(url!, process.env.SUPABASE_TEST_ANON_KEY!, { auth: { persistSession: false } });
    assert.equal((await owner.auth.signInWithPassword({ email: ownerEmail, password })).error, null);
    assert.equal((await other.auth.signInWithPassword({ email: otherEmail, password })).error, null);
  });

  afterAll(async () => {
    sql(`DELETE FROM public.candidate_mmi_station_sessions WHERE user_id IN ('${ownerId}','${otherId}');
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.mmi_station_versions WHERE station_id IN (SELECT station_id FROM public.mmi_stations WHERE source_namespace='university_test');
COMMIT;
DELETE FROM public.mmi_marking_criteria WHERE source_namespace='university_test';
DELETE FROM public.mmi_sub_questions WHERE source_namespace='university_test';
DELETE FROM public.mmi_stations WHERE source_namespace='university_test';`);
    if (ownerId) await service.auth.admin.deleteUser(ownerId);
    if (otherId) await service.auth.admin.deleteUser(otherId);
  });

  it('canonicalises aliases, rejects a missing target/null scope, and excludes every incomplete fixture', async () => {
    const kcl = await service.rpc('canonical_mmi_university_tag', { p_value: "King's College London" });
    assert.equal(kcl.error, null, kcl.error?.message);
    assert.equal(kcl.data, 'kcl');
    const options = await owner.rpc('get_candidate_mmi_practice_options');
    assert.equal(options.error, null, options.error?.message);
    assert.deepEqual(Object.keys(options.data as object).sort(), ['allCount', 'targetCount', 'targetTag', 'targetUniversity']);
    assert.equal((options.data as { targetTag: string }).targetTag, 'oxford');
    assert.equal((options.data as { targetCount: number }).targetCount, 115);
    assert.equal((options.data as { allCount: number }).allCount, 155);
    const missingTarget = await other.rpc('start_candidate_mmi_station_session', { p_scope: 'target' });
    assert.equal(missingTarget.error?.code, '22023');
    const nullScope = await owner.rpc('start_candidate_mmi_station_session', { p_scope: null });
    assert.equal(nullScope.error?.code, '22023');
    for (const invalidStationId of [stationId, archivedStationId, wrongTimingStationId, missingQuestionStationId, criterionlessStationId]) {
      assert.equal(sql(`SELECT public.is_complete_published_mmi_station('${invalidStationId}');`), 'f');
    }
  });

  it('projects a single immutable station version to the candidate and scorer', async () => {
    sql(`INSERT INTO public.mmi_station_versions(station_id,version,content_snapshot)
SELECT station.station_id,1,jsonb_build_object(
  'stationId',station.station_id,'contentVersion',1,'category',station.category,'topic',station.topic,'difficulty',station.difficulty::text,'universityTags',station.uni_tags,'prepTimeSec',station.prep_time_sec,'imageUrl',NULL,'scenarioText','Immutable scenario',
  'questions',(SELECT jsonb_agg(jsonb_build_object('subQuestionId',question.sub_q_id,'orderNum',question.order_num,'questionText',question.question_text,'timeLimitSec',question.time_limit_sec,'sourceTimeLimitSec',120,'modelAnswerCached',NULL,'criteria',(SELECT jsonb_agg(jsonb_build_object('criterionId',criterion.criterion_id,'orderNum',criterion.order_num,'bulletText',criterion.bullet_text,'sourceWeight',criterion.source_weight,'domain',criterion.domain) ORDER BY criterion.order_num) FROM public.mmi_marking_criteria criterion WHERE criterion.sub_q_id=question.sub_q_id)) ORDER BY question.order_num) FROM public.mmi_sub_questions question WHERE question.station_id=station.station_id)
) FROM public.mmi_stations station WHERE station.station_id='${stationId}';
UPDATE public.mmi_stations SET status='published' WHERE station_id='${stationId}';
UPDATE public.profiles SET university_target='snapshot' WHERE id='${ownerId}';`);
    const started = await owner.rpc('start_candidate_mmi_station_session', { p_scope: 'target' });
    assert.equal(started.error, null, started.error?.message);
    sessionId = (started.data as { sessionId: string }).sessionId;
    assert.ok(sessionId);
    assert.equal((started.data as { stationId: string }).stationId, stationId);
    assert.equal((started.data as { scenarioText: string }).scenarioText, 'Immutable scenario');
    sql(`UPDATE public.mmi_stations SET scenario_text='Edited live scenario' WHERE station_id='${stationId}';
UPDATE public.mmi_sub_questions SET question_text='Edited live question' WHERE sub_q_id='${stationId}_Q1';
UPDATE public.mmi_marking_criteria SET bullet_text='Edited live criterion' WHERE criterion_id='${stationId}_C1';
DO $$ BEGIN BEGIN UPDATE public.candidate_mmi_station_sessions SET scenario_text_snapshot='forbidden' WHERE id='${sessionId}'; RAISE EXCEPTION USING ERRCODE='P0002'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END; END $$;
DO $$ BEGIN BEGIN UPDATE public.candidate_mmi_station_prompt_snapshots SET prompt_text='forbidden' WHERE session_id='${sessionId}' AND prompt_order=1; RAISE EXCEPTION USING ERRCODE='P0002'; EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END; END $$;
UPDATE public.candidate_mmi_station_sessions SET started_at=clock_timestamp()-interval '61 seconds' WHERE id='${sessionId}';`);
    const candidateProjection = await owner.rpc('get_candidate_mmi_station_session', { p_session_id: sessionId });
    assert.equal(candidateProjection.error, null, candidateProjection.error?.message);
    assert.equal((candidateProjection.data as { promptText: string }).promptText, 'Question 1');
    const checkpoint = await owner.rpc('checkpoint_candidate_mmi_station_response', { p_session_id: sessionId, p_prompt_order: 1, p_transcript: 'Candidate answer', p_client_revision: 1 });
    assert.equal(checkpoint.error, null, checkpoint.error?.message);
    const finalised = await owner.rpc('finalize_candidate_mmi_station_response', { p_session_id: sessionId, p_prompt_order: 1, p_finalization_key: randomUUID() });
    assert.equal(finalised.error, null, finalised.error?.message);
    sql(`UPDATE public.candidate_mmi_station_sessions SET started_at=clock_timestamp()-interval '12 minutes' WHERE id='${sessionId}';`);
    const claimed = await service.rpc('claim_candidate_mmi_response_scoring', { p_user_id: ownerId, p_session_id: sessionId, p_prompt_order: 1, p_lease_token: randomUUID() });
    assert.equal(claimed.error, null, claimed.error?.message);
    assert.deepEqual({ scenarioText: (claimed.data as { scenarioText: string }).scenarioText, promptText: (claimed.data as { promptText: string }).promptText, criterion: ((claimed.data as { criteria: Array<{ bulletText: string }> }).criteria)[0]?.bulletText }, { scenarioText: 'Immutable scenario', promptText: 'Question 1', criterion: 'Criterion 1' });
  });

  it('preserves legacy work without attainment, withholds unknown scores, and awards only schema-v3 no-response zeros', async () => {
    const result = await owner.rpc('get_candidate_mmi_station_result', { p_session_id: sessionId });
    assert.equal(result.error, null, result.error?.message);
    assert.equal((result.data as { status: string }).status, 'awaiting_scoring');
    assert.equal((result.data as { overallPct: number | null }).overallPct, null);
    sql(`UPDATE public.candidate_mmi_station_responses SET scoring_status='scored', public_assessment='{"dimensions":{"structure":{"score":null,"applicable":false,"evidence":null,"improvement":null},"ethics":{"score":null,"applicable":false,"evidence":null,"improvement":null},"communication":{"score":null,"applicable":false,"evidence":null,"improvement":null},"reflection":{"score":null,"applicable":false,"evidence":null,"improvement":null},"nhs_awareness":{"score":null,"applicable":false,"evidence":null,"improvement":null}},"overallPct":80,"strengths":[],"improvements":[],"improvementTip":"Legacy narrative removed under the current retention policy.","rubricVersion":1}'::jsonb WHERE session_id='${sessionId}' AND prompt_order=1;`);
    const legacyResult = await owner.rpc('get_candidate_mmi_station_result', { p_session_id: sessionId });
    assert.equal((legacyResult.data as { status: string }).status, 'awaiting_scoring');
    assert.equal((legacyResult.data as { overallPct: number | null }).overallPct, null);
    assert.equal(((legacyResult.data as { feedback: Array<{ legacy: boolean }> }).feedback)[0]?.legacy, true);
    const legacyHistory = await owner.rpc('list_candidate_mmi_history', { p_limit: 20 });
    assert.equal((legacyHistory.data as Array<{ domainAttainment: unknown[] }>)[0]?.domainAttainment.length, 0);

    const noResponseStarted = await owner.rpc('start_candidate_mmi_station_session', { p_scope: 'target' });
    assert.equal(noResponseStarted.error, null, noResponseStarted.error?.message);
    noResponseSessionId = (noResponseStarted.data as { sessionId: string }).sessionId;
    sql(`UPDATE public.candidate_mmi_station_sessions SET started_at=clock_timestamp()-interval '12 minutes' WHERE id='${noResponseSessionId}';`);
    const noResponseResult = await owner.rpc('get_candidate_mmi_station_result', { p_session_id: noResponseSessionId });
    assert.equal((noResponseResult.data as { status: string }).status, 'completed');
    assert.equal((noResponseResult.data as { overallPct: number }).overallPct, 0);
    assert.ok((noResponseResult.data as { feedback: Array<{ status: string; assessment: { schemaVersion: number; criteria: Array<{ achieved: boolean }> } }> }).feedback.every((item) => item.status === 'no_response' && item.assessment.schemaVersion === 3 && item.assessment.criteria.every((criterion) => criterion.achieved === false)));
  });

  it('denies another candidate its result and history', async () => {
    const otherResult = await other.rpc('get_candidate_mmi_station_result', { p_session_id: noResponseSessionId });
    assert.equal(otherResult.error?.code, '42501');
    const otherHistory = await other.rpc('list_candidate_mmi_history', { p_limit: 20 });
    assert.equal(otherHistory.error, null, otherHistory.error?.message);
    assert.deepEqual(otherHistory.data, []);
  });
});
