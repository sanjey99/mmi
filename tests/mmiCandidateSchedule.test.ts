import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

type CandidateMmiScheduleModule = Readonly<{
  CANDIDATE_MMI_PREP_SECONDS: number; CANDIDATE_MMI_PROMPT_COUNT: number; CANDIDATE_MMI_RESPONSE_SECONDS: number; CANDIDATE_MMI_TOTAL_SECONDS: number;
  projectCandidateMmiPhase: (startedAt: Date, serverNow: Date) => { kind: 'scenario' | 'response' | 'completed'; promptOrder: 1 | 2 | 3 | 4 | 5 | null; phaseStartedAt: Date; phaseEndsAt: Date | null };
  secondsRemaining: (projection: { phaseEndsAt: Date | null }, serverNow: Date) => number;
}>;
async function loadSchedule(): Promise<CandidateMmiScheduleModule> { return import(pathToFileURL(path.resolve(process.cwd(), 'src/features/candidateMmi/schedule.ts')).href) as Promise<CandidateMmiScheduleModule>; }
function atElapsed(startedAt: Date, seconds: number): Date { return new Date(startedAt.getTime() + seconds * 1_000); }

test('projects every exact 60 + 5×120 candidate MMI boundary from trusted timestamps', async () => {
  const schedule = await loadSchedule();
  const startedAt = new Date('2026-08-26T00:00:00.000Z');
  const expected = [
    [0, 'scenario', null, 0, 60], [59, 'scenario', null, 0, 60],
    [60, 'response', 1, 60, 180], [179, 'response', 1, 60, 180],
    [180, 'response', 2, 180, 300], [299, 'response', 2, 180, 300],
    [300, 'response', 3, 300, 420], [419, 'response', 3, 300, 420],
    [420, 'response', 4, 420, 540], [539, 'response', 4, 420, 540],
    [540, 'response', 5, 540, 660], [659, 'response', 5, 540, 660],
    [660, 'completed', null, 660, null],
  ] as const;

  assert.deepEqual(
    { prep: schedule.CANDIDATE_MMI_PREP_SECONDS, response: schedule.CANDIDATE_MMI_RESPONSE_SECONDS, promptCount: schedule.CANDIDATE_MMI_PROMPT_COUNT, total: schedule.CANDIDATE_MMI_TOTAL_SECONDS },
    { prep: 60, response: 120, promptCount: 5, total: 660 },
  );
  for (const [elapsed, kind, promptOrder, phaseStart, phaseEnd] of expected) {
    const projection = schedule.projectCandidateMmiPhase(startedAt, atElapsed(startedAt, elapsed));
    assert.deepEqual(
      { kind: projection.kind, promptOrder: projection.promptOrder, phaseStartedAt: projection.phaseStartedAt.toISOString(), phaseEndsAt: projection.phaseEndsAt?.toISOString() ?? null },
      { kind, promptOrder, phaseStartedAt: atElapsed(startedAt, phaseStart).toISOString(), phaseEndsAt: phaseEnd === null ? null : atElapsed(startedAt, phaseEnd).toISOString() },
    );
  }
});
test('fails closed by clamping a negative elapsed timestamp and never returns negative remaining seconds', async () => {
  const schedule = await loadSchedule();
  const startedAt = new Date('2026-08-26T00:00:00.000Z');
  const projection = schedule.projectCandidateMmiPhase(startedAt, atElapsed(startedAt, -1));
  assert.deepEqual(
    { kind: projection.kind, promptOrder: projection.promptOrder, phaseStartedAt: projection.phaseStartedAt.toISOString(), phaseEndsAt: projection.phaseEndsAt?.toISOString() ?? null, remainingBeforeStart: schedule.secondsRemaining(projection, atElapsed(startedAt, -1)), remainingAtExpiry: schedule.secondsRemaining(projection, atElapsed(startedAt, 60)) },
    { kind: 'scenario', promptOrder: null, phaseStartedAt: startedAt.toISOString(), phaseEndsAt: atElapsed(startedAt, 60).toISOString(), remainingBeforeStart: 60, remainingAtExpiry: 0 },
  );
});
