import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { canRunLocalMutationTests } from './mutationTestSafety.ts';
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
import { deleteLocalAssessorContentByPrefix, insertLocalAssessorContentRows } from './localDatabaseFixture.ts';

const enabled = canRunLocalMutationTests(process.env);

const run = enabled ? describe : describe.skip;
const fixturePrefix = `mmi-schema-${randomUUID().slice(0, 8)}`;

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
  const [data] = await insertLocalAssessorContentRows('mmi_stations', {
    station_id: stationId(label),
    category: 'scenarios',
    topic: 'Integration fixture',
    difficulty: 'intermediate',
    prep_time_sec: 60,
    status: 'draft',
    scenario_text: 'Student-facing integration fixture.',
    ...overrides,
  });
  assert.ok(data);
  return data;
}

async function insertSubQuestion(
  label: string,
  parentStationId: string,
  overrides: Record<string, unknown> = {},
) {
  const [data] = await insertLocalAssessorContentRows('mmi_sub_questions', {
    sub_q_id: stationId(label),
    station_id: parentStationId,
    order_num: 1,
    question_text: 'How would you approach this scenario?',
    time_limit_sec: 120,
    ...overrides,
  });
  assert.ok(data);
  return data;
}

async function insertRoleplayStation(
  label: string,
  overrides: Record<string, unknown> = {},
) {
  const [data] = await insertLocalAssessorContentRows('roleplay_stations', {
    station_id: stationId(label),
    title: 'Integration role-play',
    topic: 'Communication',
    difficulty: 'intermediate',
    actor_persona: 'Assessor-only integration fixture.',
    background_info: 'Assessor-only integration fixture.',
    opening_line: 'Student-facing integration fixture.',
    status: 'draft',
    ...overrides,
  });
  assert.ok(data);
  return data;
}

run('MMI content schema (isolated Supabase project only)', () => {
  after(async () => {
    await deleteLocalAssessorContentByPrefix(fixturePrefix);
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
