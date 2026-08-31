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
  const schedule = await loadSchedule(); const startedAt = new Date('2026-08-26T00:00:00.000Z');
  assert.deepEqual({ prep: schedule.CANDIDATE_MMI_PREP_SECONDS, response: schedule.CANDIDATE_MMI_RESPONSE_SECONDS, promptCount: schedule.CANDIDATE_MMI_PROMPT_COUNT, total: schedule.CANDIDATE_MMI_TOTAL_SECONDS }, { prep: 60, response: 120, promptCount: 5, total: 660 });
  for (const [elapsed, kind, promptOrder] of [[0, 'scenario', null], [60, 'response', 1], [180, 'response', 2], [300, 'response', 3], [420, 'response', 4], [540, 'response', 5], [660, 'completed', null]] as const) {
    const projection = schedule.projectCandidateMmiPhase(startedAt, atElapsed(startedAt, elapsed)); assert.deepEqual({ kind: projection.kind, promptOrder: projection.promptOrder }, { kind, promptOrder });
  }
});
test('fails closed by clamping a negative elapsed timestamp and never returns negative remaining seconds', async () => {
  const schedule = await loadSchedule(); const startedAt = new Date('2026-08-26T00:00:00.000Z'); const projection = schedule.projectCandidateMmiPhase(startedAt, atElapsed(startedAt, -1));
  assert.equal(projection.kind, 'scenario'); assert.equal(schedule.secondsRemaining(projection, atElapsed(startedAt, -1)), 60); assert.equal(schedule.secondsRemaining(projection, atElapsed(startedAt, 60)), 0);
});
