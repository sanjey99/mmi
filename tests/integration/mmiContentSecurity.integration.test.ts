import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const integrationRequired =
  process.env.MMI_CONTENT_SECURITY_INTEGRATION_REQUIRED === '1';

function isDisposableLocalUrl(value: string | undefined) {
  if (!value) return false;

  const hostname = new URL(value).hostname;
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

if (url && !isDisposableLocalUrl(url)) {
  throw new Error('MMI content security tests only run against local Supabase');
}

const enabled = Boolean(url && anonKey && serviceRoleKey);

if (integrationRequired && !enabled) {
  throw new Error(
    'Required MMI content security integration credentials are missing',
  );
}

const run = enabled ? describe : describe.skip;
const fixturePrefix = `mmi-security-${randomUUID().slice(0, 8)}`;
const password = `Local-only-${randomUUID()}!`;

const markers = {
  currentPrompt: `${fixturePrefix}-CURRENT_PROMPT`,
  draft: `${fixturePrefix}-DRAFT_ROW`,
  futurePrompt: `${fixturePrefix}-FUTURE_PROMPT`,
  hiddenBackground: `${fixturePrefix}-HIDDEN_BACKGROUND`,
  hiddenModel: `${fixturePrefix}-HIDDEN_MODEL_AND_RUBRIC_TEXT`,
  hiddenPersona: `${fixturePrefix}-HIDDEN_PERSONA`,
} as const;

const ids = {
  draftRoleplay: `${fixturePrefix}-draft-roleplay`,
  draftStandard: `${fixturePrefix}-draft-standard`,
  firstPrompt: `${fixturePrefix}-prompt-1`,
  futurePrompt: `${fixturePrefix}-prompt-2`,
  roleplay: `${fixturePrefix}-roleplay`,
  standardFirst: `${fixturePrefix}-standard-first`,
  standardLast: `${fixturePrefix}-standard-last`,
} as const;

const cardKeys = [
  'category',
  'difficulty',
  'prep_time_sec',
  'prompt_count',
  'station_id',
  'station_kind',
  'title',
  'topic',
  'university_tags',
].sort();

const previewKeys = [
  ...cardKeys,
  'opening_line',
  'student_brief',
].sort();

let service: SupabaseClient;
let student: SupabaseClient;
let admin: SupabaseClient;
let anonymous: SupabaseClient;
const authUserIds: string[] = [];

function assertSafeJson(value: unknown) {
  const serialized = JSON.stringify(value);

  for (const field of [
    'model_answer_cached',
    'actor_persona',
    'background_info',
    'question_text',
    'rubric',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(field, 'i'));
  }

  for (const marker of Object.values(markers)) {
    assert.doesNotMatch(serialized, new RegExp(marker));
  }
}

function assertExactKeys(
  rows: Array<Record<string, unknown>>,
  expectedKeys: string[],
) {
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), expectedKeys);
  }
}

async function mustInsert(table: string, rows: Record<string, unknown>[]) {
  const { error } = await service.from(table).insert(rows);
  assert.equal(error, null, error?.message);
}

async function createAuthenticatedClient(isAdmin: boolean) {
  const email = `${fixturePrefix}-${isAdmin ? 'admin' : 'student'}@example.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null, error?.message);
  assert.ok(data.user);
  authUserIds.push(data.user.id);

  if (isAdmin) {
    const { error: profileError } = await service
      .from('profiles')
      .update({ is_admin: true })
      .eq('id', data.user.id);
    assert.equal(profileError, null, profileError?.message);
  }

  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  assert.equal(signInError, null, signInError?.message);
  return client;
}

async function assertPermissionDenied(
  request: PromiseLike<{ data: unknown; error: { code?: string } | null }>,
) {
  const { data, error } = await request;
  assert.equal(data, null);
  assert.ok(error, 'expected the base-table request to be denied');
  assert.equal(error.code, '42501');
}

run('MMI student content boundary (disposable local Supabase only)', () => {
  before(async () => {
    service = createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
    anonymous = createClient(url!, anonKey!, {
      auth: { persistSession: false },
    });

    await mustInsert('mmi_stations', [
      {
        station_id: ids.standardFirst,
        category: 'ethics',
        topic: '01 Literal % standard',
        difficulty: 'foundation',
        uni_tags: ['ucl'],
        prep_time_sec: 45,
        status: 'published',
        scenario_text: 'A public standard-station brief.',
      },
      {
        station_id: ids.standardLast,
        category: 'nhs',
        topic: '03 Final standard',
        difficulty: 'advanced',
        uni_tags: ['oxford'],
        prep_time_sec: 90,
        status: 'published',
        scenario_text: 'Another public standard-station brief.',
      },
      {
        station_id: ids.draftStandard,
        category: 'ethics',
        topic: markers.draft,
        difficulty: 'intermediate',
        uni_tags: ['ucl'],
        prep_time_sec: 60,
        status: 'draft',
        scenario_text: markers.draft,
      },
    ]);

    await mustInsert('mmi_sub_questions', [
      {
        sub_q_id: ids.firstPrompt,
        station_id: ids.standardFirst,
        order_num: 1,
        question_text: markers.currentPrompt,
        time_limit_sec: 120,
        model_answer_cached: markers.hiddenModel,
      },
      {
        sub_q_id: ids.futurePrompt,
        station_id: ids.standardFirst,
        order_num: 2,
        question_text: markers.futurePrompt,
        time_limit_sec: 120,
        model_answer_cached: markers.hiddenModel,
      },
      {
        sub_q_id: `${fixturePrefix}-last-prompt`,
        station_id: ids.standardLast,
        order_num: 1,
        question_text: 'Final station prompt.',
        time_limit_sec: 180,
        model_answer_cached: markers.hiddenModel,
      },
      {
        sub_q_id: `${fixturePrefix}-draft-prompt`,
        station_id: ids.draftStandard,
        order_num: 1,
        question_text: markers.draft,
        time_limit_sec: 120,
        model_answer_cached: markers.hiddenModel,
      },
    ]);

    await mustInsert('roleplay_stations', [
      {
        station_id: ids.roleplay,
        title: '02 Role-play _ station',
        topic: 'Communication',
        category: 'scenarios',
        difficulty: 'intermediate',
        uni_tags: ['kings'],
        prep_time_sec: 120,
        time_limit_sec: 300,
        actor_persona: markers.hiddenPersona,
        background_info: markers.hiddenBackground,
        opening_line: 'A public role-play opening line.',
        status: 'published',
      },
      {
        station_id: ids.draftRoleplay,
        title: markers.draft,
        topic: markers.draft,
        category: 'scenarios',
        difficulty: 'intermediate',
        uni_tags: ['kings'],
        prep_time_sec: 120,
        time_limit_sec: 300,
        actor_persona: markers.hiddenPersona,
        background_info: markers.hiddenBackground,
        opening_line: markers.draft,
        status: 'draft',
      },
    ]);

    student = await createAuthenticatedClient(false);
    admin = await createAuthenticatedClient(true);
  });

  after(async () => {
    if (!service) return;

    const { error: roleplayCleanupError } = await service
      .from('roleplay_stations')
      .delete()
      .like('station_id', `${fixturePrefix}%`);
    const { error: standardCleanupError } = await service
      .from('mmi_stations')
      .delete()
      .like('station_id', `${fixturePrefix}%`);

    const userCleanupErrors: Array<Error | null> = [];
    for (const userId of authUserIds) {
      const { error } = await service.auth.admin.deleteUser(userId);
      userCleanupErrors.push(error);
    }

    assert.equal(
      roleplayCleanupError,
      null,
      roleplayCleanupError?.message,
    );
    assert.equal(
      standardCleanupError,
      null,
      standardCleanupError?.message,
    );
    for (const error of userCleanupErrors) {
      assert.equal(error, null, error?.message);
    }
  });

  it('denies student and admin base-table reads through every PostgREST shape', async () => {
    for (const client of [student, admin]) {
      await assertPermissionDenied(
        client
          .from('mmi_stations')
          .select('*')
          .eq('station_id', ids.standardFirst),
      );
      await assertPermissionDenied(
        client
          .from('mmi_stations')
          .select('station_id')
          .eq('station_id', `${fixturePrefix}-guessed`),
      );
      await assertPermissionDenied(
        client
          .from('mmi_sub_questions')
          .select('sub_q_id,model_answer_cached')
          .eq('sub_q_id', ids.firstPrompt),
      );
      await assertPermissionDenied(
        client
          .from('mmi_sub_questions')
          .select('*')
          .eq('model_answer_cached', markers.hiddenModel),
      );
      await assertPermissionDenied(
        client
          .from('mmi_stations')
          .select('*,mmi_sub_questions(*)')
          .eq('station_id', ids.standardFirst),
      );
      await assertPermissionDenied(
        client
          .from('roleplay_stations')
          .select('station_id,actor_persona,background_info')
          .eq('station_id', ids.roleplay),
      );
    }
  });

  it('returns only published, fixed-projection cards to students and admins', async () => {
    for (const client of [student, admin]) {
      const { data, error } = await client.rpc('list_mmi_station_cards');
      assert.equal(error, null, error?.message);
      assert.ok(data);
      assert.deepEqual(
        data.map((card: {
          station_id: string;
          station_kind: string;
          title: string;
        }) => [card.title, card.station_kind, card.station_id]),
        [
          ['01 Literal % standard', 'standard', ids.standardFirst],
          ['02 Role-play _ station', 'roleplay', ids.roleplay],
          ['03 Final standard', 'standard', ids.standardLast],
        ],
      );
      assertExactKeys(data, cardKeys);
      assertSafeJson(data);
    }
  });

  it('keeps select, hidden-field filters, and relationship expansion inside the RPC boundary', async () => {
    const { data: selected, error: selectedError } = await student
      .rpc('list_mmi_station_cards')
      .select('*');
    assert.equal(selectedError, null, selectedError?.message);
    assert.ok(selected);
    assertExactKeys(selected, cardKeys);
    assertSafeJson(selected);

    const { data: hiddenFilter, error: hiddenFilterError } = await student
      .rpc('list_mmi_station_cards')
      .eq('model_answer_cached', markers.hiddenModel);
    assert.equal(hiddenFilter, null);
    assert.ok(hiddenFilterError);

    const { data: expanded, error: expandedError } = await student
      .rpc('list_mmi_station_cards')
      .select('*,mmi_sub_questions(*)');
    assert.equal(expanded, null);
    assert.ok(expandedError);
  });

  it('combines filters and treats SQL wildcard characters literally', async () => {
    const { data: filtered, error: filteredError } = await student.rpc(
      'list_mmi_station_cards',
      {
        p_category: 'ethics',
        p_difficulty: 'foundation',
        p_kind: 'standard',
        p_search: '%',
        p_university: 'ucl',
      },
    );
    assert.equal(filteredError, null, filteredError?.message);
    assert.deepEqual(
      filtered?.map((card: { station_id: string }) => card.station_id),
      [ids.standardFirst],
    );

    const { data: underscore, error: underscoreError } = await student.rpc(
      'list_mmi_station_cards',
      { p_search: '_' },
    );
    assert.equal(underscoreError, null, underscoreError?.message);
    assert.deepEqual(
      underscore?.map((card: { station_id: string }) => card.station_id),
      [ids.roleplay],
    );

    const { data: hiddenSearch, error: hiddenSearchError } = await student.rpc(
      'list_mmi_station_cards',
      { p_search: markers.hiddenModel },
    );
    assert.equal(hiddenSearchError, null, hiddenSearchError?.message);
    assert.deepEqual(hiddenSearch, []);
  });

  it('clamps pagination and rejects unsupported station kinds', async () => {
    const { data, error } = await student.rpc('list_mmi_station_cards', {
      p_limit: 0,
      p_offset: -100,
    });
    assert.equal(error, null, error?.message);
    assert.equal(data?.length, 1);
    assert.equal(data?.[0]?.station_id, ids.standardFirst);

    const { data: invalidData, error: invalidError } = await student.rpc(
      'list_mmi_station_cards',
      { p_kind: 'circuit' },
    );
    assert.equal(invalidData, null);
    assert.equal(invalidError?.code, '22023');
  });

  it('returns safe previews without current or future prompt text', async () => {
    for (const client of [student, admin]) {
      const { data: standard, error: standardError } = await client.rpc(
        'get_mmi_station_preview',
        { p_kind: 'standard', p_station_id: ids.standardFirst },
      );
      assert.equal(standardError, null, standardError?.message);
      assert.equal(standard?.length, 1);
      assert.equal(standard?.[0]?.prompt_count, 2);
      assert.equal(standard?.[0]?.student_brief, 'A public standard-station brief.');
      assert.equal(standard?.[0]?.opening_line, null);
      assertExactKeys(standard ?? [], previewKeys);
      assertSafeJson(standard);

      const { data: roleplay, error: roleplayError } = await client.rpc(
        'get_mmi_station_preview',
        { p_kind: 'roleplay', p_station_id: ids.roleplay },
      );
      assert.equal(roleplayError, null, roleplayError?.message);
      assert.equal(roleplay?.length, 1);
      assert.equal(roleplay?.[0]?.student_brief, '02 Role-play _ station');
      assert.equal(roleplay?.[0]?.opening_line, 'A public role-play opening line.');
      assertExactKeys(roleplay ?? [], previewKeys);
      assertSafeJson(roleplay);
    }
  });

  it('returns no preview for draft, missing, or malformed identities', async () => {
    for (const [kind, stationId] of [
      ['standard', ids.draftStandard],
      ['roleplay', ids.draftRoleplay],
      ['standard', `${fixturePrefix}-guessed`],
    ] as const) {
      const { data, error } = await student.rpc('get_mmi_station_preview', {
        p_kind: kind,
        p_station_id: stationId,
      });
      assert.equal(error, null, error?.message);
      assert.deepEqual(data, []);
    }

    const { data, error } = await student.rpc('get_mmi_station_preview', {
      p_kind: 'circuit',
      p_station_id: ids.standardFirst,
    });
    assert.equal(data, null);
    assert.equal(error?.code, '22023');
  });

  it('selects the next published station deterministically and wraps once', async () => {
    const { data: next, error: nextError } = await student.rpc(
      'get_next_mmi_station_preview',
      { p_kind: 'standard', p_station_id: ids.standardFirst },
    );
    assert.equal(nextError, null, nextError?.message);
    assert.deepEqual(
      next?.map((card: { station_id: string; station_kind: string }) => [
        card.station_kind,
        card.station_id,
      ]),
      [['roleplay', ids.roleplay]],
    );
    assertExactKeys(next ?? [], previewKeys);
    assertSafeJson(next);

    const { data: wrapped, error: wrappedError } = await student.rpc(
      'get_next_mmi_station_preview',
      { p_kind: 'standard', p_station_id: ids.standardLast },
    );
    assert.equal(wrappedError, null, wrappedError?.message);
    assert.deepEqual(
      wrapped?.map((card: { station_id: string; station_kind: string }) => [
        card.station_kind,
        card.station_id,
      ]),
      [['standard', ids.standardFirst]],
    );

    const { data: guessed, error: guessedError } = await student.rpc(
      'get_next_mmi_station_preview',
      { p_kind: 'standard', p_station_id: `${fixturePrefix}-guessed` },
    );
    assert.equal(guessedError, null, guessedError?.message);
    assert.deepEqual(guessed, []);

    const { error: hideStandardError } = await service
      .from('mmi_stations')
      .update({ status: 'draft' })
      .eq('station_id', ids.standardLast);
    assert.equal(hideStandardError, null, hideStandardError?.message);
    const { error: hideRoleplayError } = await service
      .from('roleplay_stations')
      .update({ status: 'draft' })
      .eq('station_id', ids.roleplay);
    assert.equal(hideRoleplayError, null, hideRoleplayError?.message);

    try {
      const { data: noAlternative, error: noAlternativeError } =
        await student.rpc('get_next_mmi_station_preview', {
          p_kind: 'standard',
          p_station_id: ids.standardFirst,
        });
      assert.equal(noAlternativeError, null, noAlternativeError?.message);
      assert.deepEqual(noAlternative, []);
    } finally {
      const { error: restoreStandardError } = await service
        .from('mmi_stations')
        .update({ status: 'published' })
        .eq('station_id', ids.standardLast);
      const { error: restoreRoleplayError } = await service
        .from('roleplay_stations')
        .update({ status: 'published' })
        .eq('station_id', ids.roleplay);

      assert.equal(
        restoreStandardError,
        null,
        restoreStandardError?.message,
      );
      assert.equal(
        restoreRoleplayError,
        null,
        restoreRoleplayError?.message,
      );
    }
  });

  it('denies anonymous execution of every student content RPC', async () => {
    const calls = [
      anonymous.rpc('list_mmi_station_cards'),
      anonymous.rpc('get_mmi_station_preview', {
        p_kind: 'standard',
        p_station_id: ids.standardFirst,
      }),
      anonymous.rpc('get_next_mmi_station_preview', {
        p_kind: 'standard',
        p_station_id: ids.standardFirst,
      }),
    ];

    for (const call of calls) {
      const { data, error } = await call;
      assert.equal(data, null);
      assert.equal(error?.code, '42501');
    }
  });
});
