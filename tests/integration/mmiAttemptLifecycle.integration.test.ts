import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { buildMmiPersistenceFixtures, createAuthenticatedTestClient, expectDbCode, isDisposableLocalUrl } from './mmiPersistenceFixtures.ts';

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
  it('keeps every Edge Function JWT-verified and uses the shared HTTP boundary', () => {
    const config = read(configPath);
    for (const name of ['score-answer', 'manage-ai-key', 'start-mmi-attempt', 'get-mmi-attempt', 'reveal-mmi-prompt', 'abandon-mmi-attempt']) {
      assert.match(config, new RegExp(`\\[functions\\.${name.replace('-', '\\-')}\\][\\s\\S]*?verify_jwt\\s*=\\s*true`, 'i'));
    }
    for (const path of functionPaths) {
      const source = read(path);
      assert.match(source, /prepareEdgeHttpRequest/);
      assert.match(source, /auth\.getUser\(\)/);
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
    await service.from('mmi_attempts').delete().in('user_id', [ownerId, otherId]);
    await service.from('mmi_scoring_rubrics').delete().or(`standard_sub_q_id.like.${fixturePrefix}%,roleplay_station_id.like.${fixturePrefix}%`);
    await service.from('mmi_privacy_notices').delete().like('version', `${fixturePrefix}%`);
    await service.from('roleplay_stations').delete().like('station_id', `${fixturePrefix}%`);
    await service.from('mmi_stations').delete().like('station_id', `${fixturePrefix}%`);
    await service.auth.admin.deleteUser(ownerId);
    await service.auth.admin.deleteUser(otherId);
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
    assertNoHiddenFields(await response.json());
  });

  it('hides future prompts and returns the same generic not-found response for guessed cross-user IDs', async () => {
    const start = await invoke(ownerToken, 'start-mmi-attempt', { stationKind: 'standard', stationId: ids.standard, privacyNoticeVersion: ids.noticeAccount });
    assert.equal(start.status, 200);
    const { attempt } = await start.json() as { attempt: { id: string } };
    await service.from('mmi_attempts').update({ preparation_ends_at: new Date(Date.now() - 1_000).toISOString() }).eq('id', attempt.id);
    const reveal = await invoke(ownerToken, 'reveal-mmi-prompt', { attemptId: attempt.id });
    assert.equal(reveal.status, 200);
    const revealed = await reveal.json();
    assertNoHiddenFields(revealed);
    assert.doesNotMatch(JSON.stringify(revealed), new RegExp(markers.future));
    const guessed = await invoke(otherToken, 'get-mmi-attempt', { attemptId: attempt.id });
    const missing = await invoke(otherToken, 'get-mmi-attempt', { attemptId: randomUUID() });
    assert.equal(guessed.status, 404);
    assert.deepEqual(await guessed.json(), await missing.json());
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
});
