import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { buildMmiPersistenceFixtures, createAuthenticatedTestClient, expectDbCode, isDisposableLocalUrl } from './mmiPersistenceFixtures.ts';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { teardownMmiAttemptLifecycleFixtures } from './mmiAttemptLifecycleFixtures.ts';

const root = process.cwd();
const migrationPath = `${root}/supabase/migrations/20260817002500_mmi_attempt_rpcs.sql`;
const configPath = `${root}/supabase/config.toml`;
const functionPaths = [
  `${root}/supabase/functions/start-mmi-attempt/index.ts`,
  `${root}/supabase/functions/get-mmi-attempt/index.ts`,
  `${root}/supabase/functions/reveal-mmi-prompt/index.ts`,
  `${root}/supabase/functions/abandon-mmi-attempt/index.ts`,
] as const;
const hiddenFieldPattern = /(?:actor_persona|background_info|model_answer_cached|hidden_reference_answer|hidden_actor_context|rubric_(?:criteria|dimension_weights|safety_critical_items)|question_text|future_prompt|provider_response|api[_-]?key|authorization)/i;

function read(path: string) {
  assert.ok(existsSync(path), `expected Task 6 file: ${path}`);
  return readFileSync(path, 'utf8');
}

function functionBody(sql: string, name: string) {
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?as\\s+\\$function\\$([\\s\\S]*?)\\$function\\$`,
    'i',
  ));
  assert.ok(match, `expected ${name} to use a delimited function body`);
  return match[1];
}

function assertNoHiddenFields(value: unknown) {
  const visit = (entry: unknown, path = 'response') => {
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    for (const [key, nested] of Object.entries(entry)) {
      assert.doesNotMatch(key, hiddenFieldPattern, `hidden field at ${path}.${key}`);
      visit(nested, `${path}.${key}`);
    }
  };
  visit(value);
}

describe('MMI authenticated attempt lifecycle contracts', () => {
  function createTeardownRecordingService() {
    const calls: string[] = [];
    const service = {
      from: (table: string) => ({
        delete: () => ({
          in: async (column: string, values: string[]) => { calls.push(`${table}.in(${column},${values.join(',')})`); },
          or: async (filters: string) => { calls.push(`${table}.or(${filters})`); },
          like: async (column: string, pattern: string) => { calls.push(`${table}.like(${column},${pattern})`); },
        }),
      }),
      auth: { admin: { deleteUser: async (id: string) => { calls.push(`auth.deleteUser(${id})`); } } },
    } as unknown as SupabaseClient;
    return { calls, service };
  }

  it('preserves lifecycle fixtures for every non-destructive environment', async () => {
    for (const environment of [
      {},
      { MMI_ATTEMPT_LIFECYCLE_PRESERVE_FIXTURES: '1' },
      { MMI_ATTEMPT_LIFECYCLE_PRESERVE_FIXTURES: 'true' },
      { MMI_ATTEMPT_LIFECYCLE_PRESERVE_FIXTURE: '1' },
      { MMI_ATTEMPT_LIFECYCLE_ALLOW_DESTRUCTIVE_CLEANUP: 'DELETE_LOCAL_FIXTURE' },
    ]) {
      const { calls, service } = createTeardownRecordingService();
      await teardownMmiAttemptLifecycleFixtures(service, 'owner', 'other', 'mmi-lifecycle-test', environment);
      assert.deepEqual(calls, [], JSON.stringify(environment));
    }
  });

  it('runs every fixture and admin cleanup only for the destructive sentinel', async () => {
    const { calls, service } = createTeardownRecordingService();
    await teardownMmiAttemptLifecycleFixtures(service, 'owner', 'other', 'mmi-lifecycle-test', {
      MMI_ATTEMPT_LIFECYCLE_ALLOW_DESTRUCTIVE_CLEANUP: 'DELETE_LOCAL_FIXTURES',
    });

    assert.deepEqual(calls, [
      'mmi_attempts.in(user_id,owner,other)',
      'mmi_scoring_rubrics.or(standard_sub_q_id.like.mmi-lifecycle-test%,roleplay_station_id.like.mmi-lifecycle-test%)',
      'mmi_privacy_notices.like(version,mmi-lifecycle-test%)',
      'roleplay_stations.like(station_id,mmi-lifecycle-test%)',
      'mmi_stations.like(station_id,mmi-lifecycle-test%)',
      'auth.deleteUser(owner)',
      'auth.deleteUser(other)',
    ]);
  });

  it('keeps every Edge Function JWT-verified and uses the shared HTTP boundary', () => {
    const config = read(configPath);
    for (const name of ['score-answer', 'manage-ai-key', 'start-mmi-attempt', 'get-mmi-attempt', 'reveal-mmi-prompt', 'abandon-mmi-attempt']) {
      const section = config.match(new RegExp(`\\[functions\\.${name.replace('-', '\\-')}\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'i'));
      assert.ok(section, `missing [functions.${name}]`);
      assert.match(section[1], /^verify_jwt\s*=\s*true\s*$/mi);
      assert.doesNotMatch(section[1], /^verify_jwt\s*=\s*false\s*$/mi);
    }
    for (const path of functionPaths) {
      const source = read(path);
      assert.match(source, /prepareEdgeHttpRequest/);
      assert.match(source, /auth\.getUser\(\)/);
      assert.match(source, /readBoundedJson/);
      assert.doesNotMatch(source, /service_role[^\n]*authorization|console\.(?:log|error).*authorization/i);
    }
  });

  it('defines closed, service-only creation, reveal, and abandonment RPCs', () => {
    const sql = read(migrationPath);
    for (const name of ['create_mmi_attempt', 'reveal_mmi_first_prompt', 'abandon_mmi_attempt']) {
      const body = functionBody(sql, name);
      assert.match(body, /auth\.role\s*\(\s*\)\s+is\s+distinct\s+from\s+'service_role'/i);
      assert.match(sql, new RegExp(`security\\s+definer[\\s\\S]*?function\\s+public\\.${name}|function\\s+public\\.${name}[\\s\\S]*?security\\s+definer`, 'i'));
      assert.match(sql, new RegExp(`function\\s+public\\.${name}[\\s\\S]*?set\\s+search_path\\s*=\\s*public\\s*,\\s*pg_temp`, 'i'));
      assert.match(sql, new RegExp(`revoke\\s+all(?:\\s+privileges)?\\s+on\\s+function\\s+public\\.${name}\\([^;]+\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'));
      assert.match(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]+\\)\\s+to\\s+service_role`, 'i'));
    }
    assert.match(functionBody(sql, 'create_mmi_attempt'), /order\s+by\s+q\.order_num/i);
    assert.match(functionBody(sql, 'create_mmi_attempt'), /status::text\s*=\s*'published'/i);
    assert.match(functionBody(sql, 'create_mmi_attempt'), /status\s*=\s*'active'/i);
    assert.match(functionBody(sql, 'reveal_mmi_first_prompt'), /for\s+update/i);
    assert.match(functionBody(sql, 'abandon_mmi_attempt'), /for\s+update/i);
    assert.match(functionBody(sql, 'abandon_mmi_attempt'), /status\s*=\s*'in_progress'/i);
  });

  it('uses fixed safe response shapes and never serializes hidden or future prompt fields', () => {
    const sources = [read(migrationPath), ...functionPaths.map(read)];
    for (const source of sources) {
      assert.doesNotMatch(source, /select\s+\*/i);
    }
    const start = read(functionPaths[0]);
    const get = read(functionPaths[1]);
    const reveal = read(functionPaths[2]);
    assert.match(start, /privacy_notice_version/);
    assert.doesNotMatch(start, /prompt_text/i);
    assert.match(get, /preparing/);
    assert.match(get, /awaiting_continue/);
    assert.match(get, /final_feedback/);
    assert.match(get, /prompt_active/);
    assert.match(get, /not_found/);
    assert.match(reveal, /preparation_in_progress/);
    assert.match(reveal, /remainingSeconds/);
    assertNoHiddenFields({ attempt: { phase: 'preparing', station: { studentBrief: 'safe' } } });
  });

  it('pins the exact retained scoring contract and a complete response schema in every snapshot', async () => {
    const sql = read(migrationPath);
    const match = sql.match(/v_contract_snapshot\s+JSONB\s*:=\s*\$contract\$([\s\S]*?)\$contract\$::JSONB/i);
    assert.ok(match, 'expected a canonical Task 4 contract literal');
    const contractModule = await import('../../supabase/functions/_shared/mmiScoringContract' + '.ts') as any;
    const { createMmiScoringContractSnapshot, CURRENT_MMI_SCORING_CONTRACT_VERSION } = contractModule;
    assert.deepEqual(JSON.parse(match[1]), createMmiScoringContractSnapshot(CURRENT_MMI_SCORING_CONTRACT_VERSION));
    const create = functionBody(sql, 'create_mmi_attempt');
    assert.match(create, /scoring_contract_version[\s\S]*?v_contract_snapshot->>'version'/i);
    assert.match(create, /response_schema_snapshot[\s\S]*?v_contract_snapshot->'responseSchema'/i);
  });

  it('requires contiguous prompt ordering, locked source rows, and post-insert snapshot identity checks', () => {
    const create = functionBody(read(migrationPath), 'create_mmi_attempt');
    assert.match(create, /min\s*\(\s*q\.order_num\s*\)[\s\S]*?max\s*\(\s*q\.order_num\s*\)/i);
    assert.match(create, /v_min_prompt_order\s*<>\s*1/i);
    assert.match(create, /v_max_prompt_order\s*<>\s*v_prompt_count/i);
    assert.ok((create.match(/for\s+(?:key\s+)?share|for\s+update/gi) ?? []).length >= 4);
    assert.match(create, /snapshot_count_mismatch/i);
  });

  it('handles actual Functions client error-context and 204 result shapes without exposing tokens', async () => {
    const { resolveMmiFunctionResult, MmiApiError } = await import('../../src/features/mmi/api' + '.ts') as any;
    assert.equal(await resolveMmiFunctionResult({ data: null, error: null }, true), undefined);
    await assert.rejects(() => resolveMmiFunctionResult({ data: null, error: {
      context: new Response(JSON.stringify({ code: 'preparation_in_progress', remainingSeconds: 17 }), { status: 409 }),
    } }, false), (error: unknown) => error instanceof MmiApiError && (error as { code: string; remainingSeconds?: number }).code === 'preparation_in_progress' && (error as { remainingSeconds?: number }).remainingSeconds === 17);
    await assert.rejects(() => resolveMmiFunctionResult({ data: null, error: { context: new Response(JSON.stringify({ code: 'authorization' }), { status: 401 }) } }, false), (error: unknown) => error instanceof MmiApiError && (error as { code: string }).code === 'request_failed');
  });

  it('drives exported wrappers through an injected Supabase Functions-shaped client', async () => {
    const { createMmiAttemptApi, MmiApiError } = await import('../../src/features/mmi/api' + '.ts') as any;
    const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
    const api = createMmiAttemptApi(async (name: string, options: { body: Record<string, unknown> }) => {
      calls.push({ name, body: options.body });
      if (name === 'reveal-mmi-prompt') return { data: null, error: { context: new Response(JSON.stringify({ code: 'preparation_in_progress', remainingSeconds: 9 }), { status: 409 }) } };
      if (name === 'get-mmi-attempt') return { data: { attempt: { id: 'a' } }, error: null };
      if (name === 'abandon-mmi-attempt') return { data: '', error: null };
      return { data: null, error: { context: new Response(JSON.stringify({ code: 'station_unavailable' }), { status: 409 }) } };
    });
    await assert.rejects(() => api.revealMmiPrompt('00000000-0000-4000-8000-000000000000'), (error: unknown) => error instanceof MmiApiError && (error as { code: string; remainingSeconds?: number }).code === 'preparation_in_progress' && (error as { remainingSeconds?: number }).remainingSeconds === 9);
    assert.deepEqual(await api.getMmiAttempt('00000000-0000-4000-8000-000000000000'), { attempt: { id: 'a' } });
    await api.abandonMmiAttempt('00000000-0000-4000-8000-000000000000');
    await assert.rejects(() => api.startMmiAttempt({ stationKind: 'standard', stationId: 'station', privacyNoticeVersion: 'notice' }), (error: unknown) => error instanceof MmiApiError && (error as { code: string }).code === 'station_unavailable');
    assert.deepEqual(calls, [
      { name: 'reveal-mmi-prompt', body: { attemptId: '00000000-0000-4000-8000-000000000000' } },
      { name: 'get-mmi-attempt', body: { attemptId: '00000000-0000-4000-8000-000000000000' } },
      { name: 'abandon-mmi-attempt', body: { attemptId: '00000000-0000-4000-8000-000000000000' } },
      { name: 'start-mmi-attempt', body: { stationKind: 'standard', stationId: 'station', privacyNoticeVersion: 'notice' } },
    ]);
  });
});

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const required = process.env.MMI_ATTEMPT_LIFECYCLE_INTEGRATION_REQUIRED === '1';
if ((url || anonKey || serviceRoleKey) && !isDisposableLocalUrl(url)) {
  throw new Error('MMI attempt lifecycle tests only run against a disposable local Supabase URL');
}
if (required && !(url && anonKey && serviceRoleKey)) {
  throw new Error('Required local MMI attempt lifecycle integration credentials are missing');
}

const run = required && url && anonKey && serviceRoleKey ? describe : describe.skip;
const fixturePrefix = `mmi-lifecycle-${randomUUID().slice(0, 8)}`;
const password = `Local-only-${randomUUID()}!`;

run('MMI authenticated lifecycle (explicit disposable-local integration only)', () => {
  let service: SupabaseClient;
  let owner: SupabaseClient;
  let other: SupabaseClient;
  let ownerId: string;
  let otherId: string;
  let ownerToken: string;
  let otherToken: string;
  const { ids, safetyItems, weights } = buildMmiPersistenceFixtures(fixturePrefix);

  const markers = {
    future: `${fixturePrefix}-FUTURE_PROMPT`,
    hiddenActor: `${fixturePrefix}-HIDDEN_ACTOR`,
    hiddenBackground: `${fixturePrefix}-HIDDEN_BACKGROUND`,
    hiddenReference: `${fixturePrefix}-HIDDEN_REFERENCE`,
  };

  function assertRealSafeResponse(value: unknown) {
    assertNoHiddenFields(value);
    assert.doesNotMatch(JSON.stringify(value), new RegExp(Object.values(markers).join('|')));
  }

  async function insert(table: string, row: Record<string, unknown> | Record<string, unknown>[]) {
    const { data, error } = await service.from(table).insert(row).select();
    assert.equal(error, null, error?.message);
    return data ?? [];
  }

  async function invoke(token: string | undefined, name: string, body: unknown) {
    const headers: Record<string, string> = { apikey: anonKey!, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  before(async () => {
    service = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });
    ({ client: owner, userId: ownerId } = await createAuthenticatedTestClient({ service, url: url!, anonKey: anonKey!, password, fixturePrefix, label: 'owner' }));
    ({ client: other, userId: otherId } = await createAuthenticatedTestClient({ service, url: url!, anonKey: anonKey!, password, fixturePrefix, label: 'other' }));
    ownerToken = (await owner.auth.getSession()).data.session?.access_token ?? '';
    otherToken = (await other.auth.getSession()).data.session?.access_token ?? '';
    assert.ok(ownerToken);
    assert.ok(otherToken);

    await insert('mmi_stations', [
      { station_id: ids.standard, category: 'ethics', topic: 'Published fixture', difficulty: 'intermediate', prep_time_sec: 1, status: 'published', scenario_text: 'Safe student brief.' },
      { station_id: `${fixturePrefix}-draft`, category: 'ethics', topic: 'Draft fixture', difficulty: 'intermediate', prep_time_sec: 1, status: 'draft', scenario_text: 'Draft only.' },
      { station_id: `${fixturePrefix}-missing-rubric`, category: 'ethics', topic: 'Rubric gap', difficulty: 'intermediate', prep_time_sec: 1, status: 'published', scenario_text: 'No active rubric.' },
    ]);
    await insert('mmi_sub_questions', [
      { sub_q_id: ids.standardPrompt1, station_id: ids.standard, order_num: 1, question_text: 'Current prompt.', time_limit_sec: 120, model_answer_cached: markers.hiddenReference },
      { sub_q_id: ids.standardPrompt2, station_id: ids.standard, order_num: 2, question_text: markers.future, time_limit_sec: 120, model_answer_cached: markers.hiddenReference },
      { sub_q_id: `${fixturePrefix}-missing-rubric-prompt`, station_id: `${fixturePrefix}-missing-rubric`, order_num: 1, question_text: 'Unreviewed prompt.', time_limit_sec: 120 },
    ]);
    await insert('roleplay_stations', {
      station_id: ids.roleplay, title: 'Role-play fixture', topic: 'Communication', category: 'scenarios', difficulty: 'intermediate', prep_time_sec: 1, time_limit_sec: 120,
      actor_persona: markers.hiddenActor, background_info: markers.hiddenBackground, opening_line: 'Safe opening line.', status: 'published',
    });
    await insert('mmi_privacy_notices', {
      version: ids.noticeAccount, processor_name: 'Local processor', notice_text: 'Local fixture notice.', retention_mode: 'account_lifetime', published_at: new Date().toISOString(), is_active: true,
    });
    await insert('mmi_scoring_rubrics', [
      { standard_sub_q_id: ids.standardPrompt1, version: 1, status: 'active', criteria: { summary: 'Reviewed criteria.' }, dimension_weights: weights, safety_critical_items: safetyItems, clinician_reviewed_at: new Date().toISOString(), clinician_reviewed_by: ownerId },
      { standard_sub_q_id: ids.standardPrompt2, version: 1, status: 'active', criteria: { summary: 'Reviewed criteria.' }, dimension_weights: weights, safety_critical_items: safetyItems, clinician_reviewed_at: new Date().toISOString(), clinician_reviewed_by: ownerId },
      { roleplay_station_id: ids.roleplay, version: 1, status: 'active', criteria: { summary: 'Reviewed criteria.' }, dimension_weights: weights, safety_critical_items: safetyItems, clinician_reviewed_at: new Date().toISOString(), clinician_reviewed_by: ownerId },
    ]);
  });

  after(async () => {
    if (!service) return;
    await teardownMmiAttemptLifecycleFixtures(service, ownerId, otherId, fixturePrefix);
  });

  it('rejects unauthenticated, draft, missing, and unreviewed starts', async () => {
    assert.equal((await invoke(undefined, 'start-mmi-attempt', { stationKind: 'standard', stationId: ids.standard, privacyNoticeVersion: ids.noticeAccount })).status, 401);
    for (const stationId of [`${fixturePrefix}-draft`, `${fixturePrefix}-missing`]) {
      const response = await invoke(ownerToken, 'start-mmi-attempt', { stationKind: 'standard', stationId, privacyNoticeVersion: ids.noticeAccount });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { code: 'station_not_found' });
    }
    const noRubric = await invoke(ownerToken, 'start-mmi-attempt', { stationKind: 'standard', stationId: `${fixturePrefix}-missing-rubric`, privacyNoticeVersion: ids.noticeAccount });
    assert.equal(noRubric.status, 409);
  });

  it('creates a role-play attempt without actor identity and denies normal-JWT direct RPC calls', async () => {
    const direct = await owner.rpc('create_mmi_attempt', {
      p_user_id: ownerId, p_station_kind: 'standard', p_station_id: ids.standard, p_privacy_notice_version: ids.noticeAccount,
    });
    assert.ok(direct.error);
    assert.equal(direct.error.code, '42501');
    const response = await invoke(ownerToken, 'start-mmi-attempt', { stationKind: 'roleplay', stationId: ids.roleplay, privacyNoticeVersion: ids.noticeAccount });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assertRealSafeResponse(payload);
  });

  it('hides future prompts and returns the same generic not-found response for guessed cross-user IDs', async () => {
    const start = await invoke(ownerToken, 'start-mmi-attempt', { stationKind: 'standard', stationId: ids.standard, privacyNoticeVersion: ids.noticeAccount });
    assert.equal(start.status, 200);
    const { attempt } = await start.json() as { attempt: { id: string } };
    await service.from('mmi_attempts').update({ preparation_ends_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', attempt.id);
    const reveal = await invoke(ownerToken, 'reveal-mmi-prompt', { attemptId: attempt.id });
    assert.equal(reveal.status, 200);
    const revealed = await reveal.json();
    assertRealSafeResponse(revealed);
    assert.doesNotMatch(JSON.stringify(revealed), new RegExp(markers.future));
    const guessed = await invoke(otherToken, 'get-mmi-attempt', { attemptId: attempt.id });
    const missing = await invoke(otherToken, 'get-mmi-attempt', { attemptId: randomUUID() });
    assert.equal(guessed.status, 404);
    assert.deepEqual(await guessed.json(), await missing.json());
  });

  it('returns safe early preparation state, then the same first prompt on repeated reveal', async () => {
    const start = await invoke(ownerToken, 'start-mmi-attempt', { stationKind: 'standard', stationId: ids.standard, privacyNoticeVersion: ids.noticeAccount });
    const { attempt } = await start.json() as { attempt: { id: string } };
    const early = await invoke(ownerToken, 'reveal-mmi-prompt', { attemptId: attempt.id });
    assert.equal(early.status, 409);
    const earlyPayload = await early.json();
    assert.equal(earlyPayload.code, 'preparation_in_progress');
    assert.ok(Number.isInteger(earlyPayload.remainingSeconds));
    assert.ok(earlyPayload.remainingSeconds >= 0 && earlyPayload.remainingSeconds <= 1);
    assertRealSafeResponse(earlyPayload);
    await service.from('mmi_attempts').update({ preparation_ends_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', attempt.id);
    const first = await (await invoke(ownerToken, 'reveal-mmi-prompt', { attemptId: attempt.id })).json();
    const repeated = await (await invoke(ownerToken, 'reveal-mmi-prompt', { attemptId: attempt.id })).json();
    assert.deepEqual(repeated, first);
    assert.equal(first.prompt.order, 1);
    assertRealSafeResponse(first);
  });

  it('restores each server phase with its exact safe projection and protects completed scores', async () => {
    const start = async () => {
      const response = await invoke(ownerToken, 'start-mmi-attempt', { stationKind: 'standard', stationId: ids.standard, privacyNoticeVersion: ids.noticeAccount });
      return (await response.json() as { attempt: { id: string } }).attempt.id;
    };
    const preparingId = await start();
    const preparing = await (await invoke(ownerToken, 'get-mmi-attempt', { attemptId: preparingId })).json();
    assert.equal(preparing.attempt.phase, 'preparing'); assert.ok(Number.isInteger(preparing.remainingSeconds)); assert.ok(preparing.remainingSeconds >= 0 && preparing.remainingSeconds <= 1); assert.equal('prompt' in preparing, false); assertRealSafeResponse(preparing);
    const activeId = await start();
    await service.from('mmi_attempts').update({ preparation_ends_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', activeId);
    await invoke(ownerToken, 'reveal-mmi-prompt', { attemptId: activeId });
    const active = await (await invoke(ownerToken, 'get-mmi-attempt', { attemptId: activeId })).json();
    assert.equal(active.attempt.phase, 'prompt_active'); assert.equal(active.prompt.order, 1); assertRealSafeResponse(active);

    const scoredStart = await invoke(ownerToken, 'start-mmi-attempt', { stationKind: 'roleplay', stationId: ids.roleplay, privacyNoticeVersion: ids.noticeAccount });
    const scoredId = (await scoredStart.json() as { attempt: { id: string } }).attempt.id;
    await service.from('mmi_attempts').update({ preparation_ends_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', scoredId);
    await invoke(ownerToken, 'reveal-mmi-prompt', { attemptId: scoredId });
    const snapshot = await service.from('mmi_attempt_prompt_snapshots').select('station_kind,standard_sub_q_id,rubric_id,rubric_version,scoring_contract_version').eq('attempt_id', scoredId).eq('prompt_order', 1).single();
    const dimensions = Object.fromEntries(['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness'].map((key) => [key, { score: 3, applicable: true, evidence: 'Fixture evidence', improvement: 'Fixture improvement' }]));
    await service.from('mmi_prompt_attempts').insert({ attempt_id: scoredId, station_kind: snapshot.data?.station_kind, standard_sub_q_id: snapshot.data?.standard_sub_q_id, prompt_order: 1, reviewed_transcript: 'A reviewed synthetic transcript long enough for the fixture.', dimension_results: dimensions, strengths: ['Synthetic strength'], improvements: ['Synthetic improvement'], improvement_tip: 'Synthetic tip', overall_pct: 60, rubric_id: snapshot.data?.rubric_id, rubric_version: snapshot.data?.rubric_version, scoring_contract_version: snapshot.data?.scoring_contract_version });
    await service.from('mmi_attempts').update({ phase: 'awaiting_continue' }).eq('id', scoredId);
    const awaiting = await (await invoke(ownerToken, 'get-mmi-attempt', { attemptId: scoredId })).json();
    assert.equal(awaiting.attempt.phase, 'awaiting_continue'); assert.ok(awaiting.feedback); assert.equal('prompt' in awaiting, false); assertRealSafeResponse(awaiting);
    await service.from('mmi_attempts').update({ status: 'completed', phase: 'final_feedback', completed_at: new Date().toISOString(), overall_pct: 60 }).eq('id', scoredId);
    const final = await (await invoke(ownerToken, 'get-mmi-attempt', { attemptId: scoredId })).json();
    assert.equal(final.attempt.phase, 'final_feedback'); assert.ok(final.feedback); assert.equal(final.feedback.overallPct, 60); assert.equal(final.summaryAvailable, true); assertRealSafeResponse(final);
    const completedAbandon = await invoke(ownerToken, 'abandon-mmi-attempt', { attemptId: scoredId });
    assert.equal(completedAbandon.status, 409); assert.deepEqual(await completedAbandon.json(), { code: 'completed_attempt' });
    const persisted = await service.from('mmi_prompt_attempts').select('overall_pct').eq('attempt_id', scoredId);
    assert.equal(persisted.data?.length, 1);
    assert.equal(persisted.data?.[0]?.overall_pct, 60);
  });

  it('abandons an owned in-progress attempt idempotently without exposing a score', async () => {
    const start = await invoke(ownerToken, 'start-mmi-attempt', { stationKind: 'standard', stationId: ids.standard, privacyNoticeVersion: ids.noticeAccount });
    const { attempt } = await start.json() as { attempt: { id: string } };
    const first = await invoke(ownerToken, 'abandon-mmi-attempt', { attemptId: attempt.id });
    const repeated = await invoke(ownerToken, 'abandon-mmi-attempt', { attemptId: attempt.id });
    assert.equal(first.status, 204);
    assert.equal(repeated.status, 204);
    const persisted = await service.from('mmi_attempts').select('status,abandoned_at,overall_pct').eq('id', attempt.id).single();
    assert.equal(persisted.data?.status, 'abandoned');
    assert.ok(persisted.data?.abandoned_at);
    assert.equal(persisted.data?.overall_pct, null);
  });

  it('rejects normal-JWT direct RPC calls and keeps cross-user attempts generically absent', async () => {
    const direct = await owner.rpc('create_mmi_attempt', {
      p_user_id: ownerId,
      p_station_kind: 'standard',
      p_station_id: ids.standard,
      p_privacy_notice_version: ids.noticeAccount,
    });
    assert.ok(direct.error);
    assert.equal(direct.error.code, '42501');

    const guessed = await other.from('mmi_attempts').select('id').eq('id', randomUUID());
    assert.deepEqual(guessed.data, []);
    assert.equal(guessed.error, null);
    assert.notEqual(ownerId, otherId);
  });

  it('recursively rejects hidden fields from every endpoint response fixture', () => {
    assertNoHiddenFields({
      attempt: { id: 'attempt', phase: 'preparing', remainingSeconds: 1 },
      prompt: { order: 1, text: 'current only', timeLimitSec: 120 },
      feedback: { overallPct: 80 },
    });
  });

  it('keeps direct create RPC denial explicit', async () => {
    await expectDbCode(
      owner.rpc('abandon_mmi_attempt', { p_user_id: ownerId, p_attempt_id: randomUUID() }),
      '42501',
    );
  });

  it('denies every service-only lifecycle RPC to a normal JWT', async () => {
    for (const [name, args] of [
      ['create_mmi_attempt', { p_user_id: ownerId, p_station_kind: 'standard', p_station_id: ids.standard, p_privacy_notice_version: ids.noticeAccount }],
      ['reveal_mmi_first_prompt', { p_user_id: ownerId, p_attempt_id: randomUUID() }],
      ['abandon_mmi_attempt', { p_user_id: ownerId, p_attempt_id: randomUUID() }],
    ] as const) await expectDbCode(owner.rpc(name, args), '42501');
  });
});
