import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { canRunLocalMutationTests } from './mutationTestSafety.ts';

const url = process.env.SUPABASE_TEST_URL;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const enabled = canRunLocalMutationTests(process.env);

const run = enabled ? describe : describe.skip;
const fixturePrefix = `mmi-schema-${randomUUID().slice(0, 8)}`;
let service: SupabaseClient;

function databaseErrorCode(expectedCode: string) {
  return (error: unknown) => {
    assert.equal(
      (error as { code?: unknown } | null)?.code,
      expectedCode,
    );
    return true;
  };
}

function stationId(label: string) {
  return `${fixturePrefix}-${label}`;
}

async function insertStandardStation(
  label: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await service
    .from('mmi_stations')
    .insert({
      station_id: stationId(label),
      category: 'scenarios',
      topic: 'Integration fixture',
      difficulty: 'intermediate',
      prep_time_sec: 60,
      status: 'draft',
      scenario_text: 'Student-facing integration fixture.',
      ...overrides,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function insertSubQuestion(
  label: string,
  parentStationId: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await service
    .from('mmi_sub_questions')
    .insert({
      sub_q_id: stationId(label),
      station_id: parentStationId,
      order_num: 1,
      question_text: 'How would you approach this scenario?',
      time_limit_sec: 120,
      ...overrides,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function insertRoleplayStation(
  label: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await service
    .from('roleplay_stations')
    .insert({
      station_id: stationId(label),
      title: 'Integration role-play',
      topic: 'Communication',
      difficulty: 'intermediate',
      actor_persona: 'Assessor-only integration fixture.',
      background_info: 'Assessor-only integration fixture.',
      opening_line: 'Student-facing integration fixture.',
      status: 'draft',
      ...overrides,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

run('MMI content schema (isolated Supabase project only)', () => {
  before(() => {
    service = createClient(url!, serviceRoleKey!, {
      auth: { persistSession: false },
    });
  });

  after(async () => {
    if (!service) return;

    await service
      .from('roleplay_stations')
      .delete()
      .like('station_id', `${fixturePrefix}%`);
    await service
      .from('mmi_stations')
      .delete()
      .like('station_id', `${fixturePrefix}%`);
  });

  it('rejects a sub-question whose station does not exist', async () => {
    await assert.rejects(
      insertSubQuestion('missing-parent-prompt', stationId('missing-parent')),
      databaseErrorCode('23503'),
    );
  });

  it('rejects duplicate prompt order within one station', async () => {
    const station = await insertStandardStation('duplicate-order');
    await insertSubQuestion('duplicate-order-first', station.station_id);

    await assert.rejects(
      insertSubQuestion('duplicate-order-second', station.station_id),
      databaseErrorCode('23505'),
    );
  });

  it('rejects non-positive standard-station timing limits', async () => {
    await assert.rejects(
      insertStandardStation('invalid-prep', { prep_time_sec: 0 }),
      databaseErrorCode('23514'),
    );

    const station = await insertStandardStation('invalid-response');
    await assert.rejects(
      insertSubQuestion('invalid-response-prompt', station.station_id, {
        time_limit_sec: 0,
      }),
      databaseErrorCode('23514'),
    );
  });

  it('adds safe launch defaults and positive limits to role-play stations', async () => {
    const roleplay = await insertRoleplayStation('roleplay-defaults');

    assert.deepEqual(
      {
        category: roleplay.category,
        prep_time_sec: roleplay.prep_time_sec,
        time_limit_sec: roleplay.time_limit_sec,
      },
      {
        category: 'scenarios',
        prep_time_sec: 120,
        time_limit_sec: 300,
      },
    );

    await assert.rejects(
      insertRoleplayStation('invalid-roleplay-prep', { prep_time_sec: 0 }),
      databaseErrorCode('23514'),
    );
    await assert.rejects(
      insertRoleplayStation('invalid-roleplay-response', { time_limit_sec: 0 }),
      databaseErrorCode('23514'),
    );
  });

  it('accepts only the audited draft and published status values', async () => {
    await assert.rejects(
      insertStandardStation('invalid-standard-status', { status: 'archived' }),
      databaseErrorCode('23514'),
    );
    await assert.rejects(
      insertRoleplayStation('invalid-roleplay-status', { status: 'archived' }),
      databaseErrorCode('23514'),
    );
  });
});
