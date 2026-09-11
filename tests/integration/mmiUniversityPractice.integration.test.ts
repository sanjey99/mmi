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
const stationId = `UNI_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const password = `Local-only-${randomUUID()}!`;
let service: SupabaseClient;
let owner: SupabaseClient;
let other: SupabaseClient;
let ownerId = '';
let otherId = '';
let sessionId = '';

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
INSERT INTO public.mmi_stations(station_id,category,topic,difficulty,uni_tags,prep_time_sec,status,scenario_text,source_namespace,source_manifest_sha256) VALUES ('${stationId}','ethics','University fixture','intermediate','{oxford}',60,'published','Local scenario','university_test','${'b'.repeat(64)}');
INSERT INTO public.mmi_sub_questions(sub_q_id,station_id,order_num,question_text,time_limit_sec,source_namespace,source_manifest_sha256) SELECT '${stationId}_Q' || order_num,'${stationId}',order_num,'Question ' || order_num,120,'university_test','${'b'.repeat(64)}' FROM generate_series(1,5) order_num;
INSERT INTO public.mmi_marking_criteria(criterion_id,sub_q_id,order_num,bullet_text,source_weight,domain,source_namespace,source_manifest_sha256) SELECT '${stationId}_C' || order_num,'${stationId}_Q' || order_num,1,'Criterion ' || order_num,1,'safety','university_test','${'b'.repeat(64)}' FROM generate_series(1,5) order_num;`);
    owner = createClient(url!, process.env.SUPABASE_TEST_ANON_KEY!, { auth: { persistSession: false } });
    other = createClient(url!, process.env.SUPABASE_TEST_ANON_KEY!, { auth: { persistSession: false } });
    assert.equal((await owner.auth.signInWithPassword({ email: ownerEmail, password })).error, null);
    assert.equal((await other.auth.signInWithPassword({ email: otherEmail, password })).error, null);
  });

  afterAll(async () => {
    if (ownerId) await service.auth.admin.deleteUser(ownerId);
    if (otherId) await service.auth.admin.deleteUser(otherId);
    sql(`DELETE FROM public.mmi_marking_criteria WHERE source_namespace='university_test'; DELETE FROM public.mmi_sub_questions WHERE station_id='${stationId}'; DELETE FROM public.mmi_stations WHERE station_id='${stationId}';`);
  });

  it('canonicalises aliases and returns only complete published station counts', async () => {
    const kcl = await service.rpc('canonical_mmi_university_tag', { p_value: "King's College London" });
    assert.equal(kcl.error, null, kcl.error?.message);
    assert.equal(kcl.data, 'kcl');
    const options = await owner.rpc('get_candidate_mmi_practice_options');
    assert.equal(options.error, null, options.error?.message);
    assert.deepEqual(Object.keys(options.data as object).sort(), ['allCount', 'targetCount', 'targetTag', 'targetUniversity']);
    assert.equal((options.data as { targetTag: string }).targetTag, 'oxford');
    assert.ok((options.data as { targetCount: number }).targetCount >= 1);
    assert.ok((options.data as { allCount: number }).allCount >= (options.data as { targetCount: number }).targetCount);
  });

  it('selects an owned target station and denies another candidate its result and history', async () => {
    const started = await owner.rpc('start_candidate_mmi_station_session', { p_scope: 'target' });
    assert.equal(started.error, null, started.error?.message);
    sessionId = (started.data as { sessionId: string }).sessionId;
    assert.ok(sessionId);
    sql(`UPDATE public.candidate_mmi_station_sessions SET started_at=clock_timestamp()-interval '12 minutes' WHERE id='${sessionId}';`);
    const result = await owner.rpc('get_candidate_mmi_station_result', { p_session_id: sessionId });
    assert.equal(result.error, null, result.error?.message);
    assert.equal((result.data as { status: string }).status, 'completed');
    assert.equal((result.data as { overallPct: number }).overallPct, 0);
    const otherResult = await other.rpc('get_candidate_mmi_station_result', { p_session_id: sessionId });
    assert.equal(otherResult.error?.code, '42501');
    const otherHistory = await other.rpc('list_candidate_mmi_history', { p_limit: 20 });
    assert.equal(otherHistory.error, null, otherHistory.error?.message);
    assert.deepEqual(otherHistory.data, []);
  });
});
