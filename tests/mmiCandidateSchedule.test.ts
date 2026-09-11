import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

type CandidateMmiScheduleModule = Readonly<{
  CANDIDATE_MMI_PREP_SECONDS: number;
  CANDIDATE_MMI_PROMPT_COUNT: number;
  CANDIDATE_MMI_RESPONSE_SECONDS: number;
  CANDIDATE_MMI_TOTAL_SECONDS: number;
  projectCandidateMmiPhase: (
    startedAt: Date,
    serverNow: Date,
  ) => {
    kind: 'scenario' | 'response' | 'completed';
    promptOrder: 1 | 2 | 3 | 4 | 5 | null;
    phaseStartedAt: Date;
    phaseEndsAt: Date | null;
  };
  secondsRemaining: (
    projection: { phaseEndsAt: Date | null },
    serverNow: Date,
  ) => number;
}>;
async function loadSchedule(): Promise<CandidateMmiScheduleModule> {
  return import(
    pathToFileURL(
      path.resolve(process.cwd(), 'src/features/candidateMmi/schedule.ts'),
    ).href
  ) as Promise<CandidateMmiScheduleModule>;
}
function atElapsed(startedAt: Date, seconds: number): Date {
  return new Date(startedAt.getTime() + seconds * 1_000);
}

function parenthesesAreBalancedOutsideSqlStrings(sql: string): boolean {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (inString) {
      if (character === "'" && sql[index + 1] === "'") index += 1;
      else if (character === "'") inString = false;
      continue;
    }
    if (character === "'") inString = true;
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return !inString && depth === 0;
}

function topLevelValuesExpressionCount(sql: string): number {
  const valuesStart = sql.indexOf('VALUES(');
  assert.ok(valuesStart >= 0, 'expected VALUES call');
  let depth = 0;
  let inString = false;
  let commas = 0;
  for (let index = valuesStart + 'VALUES'.length; index < sql.length; index += 1) {
    const character = sql[index];
    if (inString) {
      if (character === "'" && sql[index + 1] === "'") index += 1;
      else if (character === "'") inString = false;
      continue;
    }
    if (character === "'") inString = true;
    else if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return commas + 1;
    } else if (character === ',' && depth === 1) commas += 1;
  }
  throw new Error('expected a closed VALUES call');
}

test('projects every exact 60 + 5×120 candidate MMI boundary from trusted timestamps', async () => {
  const schedule = await loadSchedule();
  const startedAt = new Date('2026-08-26T00:00:00.000Z');
  const expected = [
    [0, 'scenario', null, 0, 60],
    [59, 'scenario', null, 0, 60],
    [60, 'response', 1, 60, 180],
    [179, 'response', 1, 60, 180],
    [180, 'response', 2, 180, 300],
    [299, 'response', 2, 180, 300],
    [300, 'response', 3, 300, 420],
    [419, 'response', 3, 300, 420],
    [420, 'response', 4, 420, 540],
    [539, 'response', 4, 420, 540],
    [540, 'response', 5, 540, 660],
    [659, 'response', 5, 540, 660],
    [660, 'completed', null, 660, null],
  ] as const;

  assert.deepEqual(
    {
      prep: schedule.CANDIDATE_MMI_PREP_SECONDS,
      response: schedule.CANDIDATE_MMI_RESPONSE_SECONDS,
      promptCount: schedule.CANDIDATE_MMI_PROMPT_COUNT,
      total: schedule.CANDIDATE_MMI_TOTAL_SECONDS,
    },
    { prep: 60, response: 120, promptCount: 5, total: 660 },
  );
  for (const [elapsed, kind, promptOrder, phaseStart, phaseEnd] of expected) {
    const projection = schedule.projectCandidateMmiPhase(
      startedAt,
      atElapsed(startedAt, elapsed),
    );
    assert.deepEqual(
      {
        kind: projection.kind,
        promptOrder: projection.promptOrder,
        phaseStartedAt: projection.phaseStartedAt.toISOString(),
        phaseEndsAt: projection.phaseEndsAt?.toISOString() ?? null,
      },
      {
        kind,
        promptOrder,
        phaseStartedAt: atElapsed(startedAt, phaseStart).toISOString(),
        phaseEndsAt:
          phaseEnd === null
            ? null
            : atElapsed(startedAt, phaseEnd).toISOString(),
      },
    );
  }
});
test('fails closed by clamping a negative elapsed timestamp and never returns negative remaining seconds', async () => {
  const schedule = await loadSchedule();
  const startedAt = new Date('2026-08-26T00:00:00.000Z');
  const projection = schedule.projectCandidateMmiPhase(
    startedAt,
    atElapsed(startedAt, -1),
  );
  assert.deepEqual(
    {
      kind: projection.kind,
      promptOrder: projection.promptOrder,
      phaseStartedAt: projection.phaseStartedAt.toISOString(),
      phaseEndsAt: projection.phaseEndsAt?.toISOString() ?? null,
      remainingBeforeStart: schedule.secondsRemaining(
        projection,
        atElapsed(startedAt, -1),
      ),
      remainingAtExpiry: schedule.secondsRemaining(
        projection,
        atElapsed(startedAt, 60),
      ),
    },
    {
      kind: 'scenario',
      promptOrder: null,
      phaseStartedAt: startedAt.toISOString(),
      phaseEndsAt: atElapsed(startedAt, 60).toISOString(),
      remainingBeforeStart: 60,
      remainingAtExpiry: 0,
    },
  );
});

test('university practice eligibility keeps the fixed 60 + 5×120 station contract in SQL', () => {
  const migration = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20260910002000_mmi_university_practice_history.sql'),
    'utf8',
  );
  assert.match(migration, /canonical_mmi_university_tag/i);
  assert.match(migration, /king''s college london/i);
  assert.match(migration, /is_complete_published_mmi_station/i);
  assert.match(migration, /prep_time_sec = 60/i);
  assert.match(migration, /count\(\*\) = 5/i);
  assert.match(migration, /time_limit_sec = 120/i);
  assert.match(migration, /mmi_marking_criteria/i);
  assert.match(migration, /mmi_station_versions/i);
  assert.match(migration, /scenario_text_snapshot/i);
  assert.match(migration, /candidate_mmi_station_session_snapshot_immutable/i);
  assert.match(migration, /candidate_mmi_station_prompt_snapshot_immutable/i);
  assert.match(migration, /invalid_candidate_mmi_practice_scope/i);
});

test('the redefined scoped start function has balanced SQL call parentheses', () => {
  const migration = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20260910002000_mmi_university_practice_history.sql'),
    'utf8',
  );
  const marker = 'CREATE OR REPLACE FUNCTION public.start_candidate_mmi_station_session(p_scope text DEFAULT \'all\')';
  const start = migration.lastIndexOf(marker);
  const end = migration.indexOf('$function$;', start);
  assert.ok(start >= 0 && end > start, 'expected redefined scoped start function');
  assert.equal(parenthesesAreBalancedOutsideSqlStrings(migration.slice(start, end)), true);
});

test('the prompt snapshot INSERT supplies six top-level VALUES expressions', () => {
  const migration = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20260910002000_mmi_university_practice_history.sql'),
    'utf8',
  );
  const insert = migration.lastIndexOf(
    'INSERT INTO public.candidate_mmi_station_prompt_snapshots(session_id,prompt_order,sub_question_id,prompt_text,rubric_snapshot,scoring_contract_snapshot)',
  );
  const loopEnd = migration.indexOf('  END LOOP;', insert);
  assert.ok(insert >= 0 && loopEnd > insert, 'expected prompt snapshot insert in scoped start');
  assert.equal(topLevelValuesExpressionCount(migration.slice(insert, loopEnd)), 6);
});

test('mutating integration files run serially to protect exact repository-count assertions', () => {
  const config = readFileSync(path.resolve(process.cwd(), 'vitest.mutation.config.mts'), 'utf8');
  assert.match(config, /fileParallelism:\s*false/);
});

test('historical integration fixtures use transaction-local trigger bypasses, never service-role snapshot edits', () => {
  const candidateFixture = readFileSync(
    path.resolve(process.cwd(), 'tests/integration/candidateMmiStation.integration.test.ts'),
    'utf8',
  );
  const universityFixture = readFileSync(
    path.resolve(process.cwd(), 'tests/integration/mmiUniversityPractice.integration.test.ts'),
    'utf8',
  );
  assert.match(candidateFixture, /SET LOCAL session_replication_role = replica/);
  assert.doesNotMatch(candidateFixture, /candidate_mmi_station_prompt_snapshots'\)\s*\.update/);
  assert.match(universityFixture, /SET LOCAL session_replication_role = replica/);
  assert.match(universityFixture, /Legacy narrative removed under the current retention policy/);
});

test('schema-v3 completion turns a missing legacy schemaVersion into false before bool_and', () => {
  const migration = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20260910002000_mmi_university_practice_history.sql'),
    'utf8',
  );
  const marker = 'CREATE OR REPLACE FUNCTION public.candidate_mmi_station_has_complete_v3_result';
  const start = migration.lastIndexOf(marker);
  const end = migration.indexOf('$function$;', start);
  assert.ok(start >= 0 && end > start, 'expected schema-v3 completion helper');
  const helper = migration.slice(start, end);
  assert.match(helper, /bool_and\(\s*COALESCE\(/s);
  assert.match(helper, /jsonb_typeof\(response\.public_assessment->'schemaVersion'\)\s*=\s*'number'/);
  assert.match(helper, /false\s*\)\s*\)/s);
});
