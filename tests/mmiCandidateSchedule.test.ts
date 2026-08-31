import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type CandidateMmiScheduleModule = Readonly<{
  CANDIDATE_MMI_PREP_SECONDS: number;
  CANDIDATE_MMI_PROMPT_COUNT: number;
  CANDIDATE_MMI_RESPONSE_SECONDS: number;
  CANDIDATE_MMI_TOTAL_SECONDS: number;
  projectCandidateMmiPhase: (startedAt: Date, serverNow: Date) => {
    kind: 'scenario' | 'response' | 'completed';
    promptOrder: 1 | 2 | 3 | 4 | 5 | null;
    phaseStartedAt: Date;
    phaseEndsAt: Date | null;
  };
  secondsRemaining: (projection: {
    phaseEndsAt: Date | null;
  }, serverNow: Date) => number;
}>;

type CandidateMmiMediaModule = Readonly<{
  createNoCaptureMediaPort: () => {
    prepare: (input: { sessionId: string }) => Promise<void>;
    beginResponse: (input: { sessionId: string; promptOrder: 1 | 2 | 3 | 4 | 5 }) => Promise<void>;
    finishResponse: () => Promise<string | null>;
    abort: (input: { sessionId: string; reason: 'leave' | 'expired' | 'feature_disabled' }) => Promise<void>;
  };
}>;

type CandidateMmiContract =
  | Readonly<{ available: true; schedule: CandidateMmiScheduleModule; media: CandidateMmiMediaModule }>
  | Readonly<{ available: false; reason: string }>;

async function loadCandidateMmiContract(): Promise<CandidateMmiContract> {
  try {
    const [schedule, media] = await Promise.all([
      import(pathToFileURL(path.resolve(process.cwd(), 'src/features/candidateMmi/schedule.ts')).href),
      import(pathToFileURL(path.resolve(process.cwd(), 'src/features/candidateMmi/mediaPort.ts')).href),
    ]);
    return {
      available: true,
      schedule: schedule as CandidateMmiScheduleModule,
      media: media as CandidateMmiMediaModule,
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.name : 'unknown module loading failure',
    };
  }
}

function requireCandidateMmiContract(contract: CandidateMmiContract): Extract<CandidateMmiContract, { available: true }> {
  assert.equal(
    contract.available,
    true,
    `Candidate MMI schedule/media contract is missing (${contract.available ? 'available' : contract.reason}).`,
  );
  return contract as Extract<CandidateMmiContract, { available: true }>;
}

function atElapsed(startedAt: Date, seconds: number): Date {
  return new Date(startedAt.getTime() + seconds * 1_000);
}

test('projects every exact 60 + 5×120 candidate MMI boundary from trusted timestamps', async () => {
  const contract = requireCandidateMmiContract(await loadCandidateMmiContract());
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
      prep: contract.schedule.CANDIDATE_MMI_PREP_SECONDS,
      response: contract.schedule.CANDIDATE_MMI_RESPONSE_SECONDS,
      promptCount: contract.schedule.CANDIDATE_MMI_PROMPT_COUNT,
      total: contract.schedule.CANDIDATE_MMI_TOTAL_SECONDS,
    },
    { prep: 60, response: 120, promptCount: 5, total: 660 },
  );

  for (const [elapsed, kind, promptOrder, phaseStart, phaseEnd] of expected) {
    const projection = contract.schedule.projectCandidateMmiPhase(startedAt, atElapsed(startedAt, elapsed));
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
        phaseEndsAt: phaseEnd === null ? null : atElapsed(startedAt, phaseEnd).toISOString(),
      },
    );
  }
});

test('fails closed by clamping a negative elapsed timestamp and never returns negative remaining seconds', async () => {
  const contract = requireCandidateMmiContract(await loadCandidateMmiContract());
  const startedAt = new Date('2026-08-26T00:00:00.000Z');
  const beforeStart = atElapsed(startedAt, -1);
  const projection = contract.schedule.projectCandidateMmiPhase(startedAt, beforeStart);

  assert.deepEqual(
    {
      kind: projection.kind,
      promptOrder: projection.promptOrder,
      phaseStartedAt: projection.phaseStartedAt.toISOString(),
      phaseEndsAt: projection.phaseEndsAt?.toISOString() ?? null,
      remainingBeforeStart: contract.schedule.secondsRemaining(projection, beforeStart),
      remainingAtExpiry: contract.schedule.secondsRemaining(projection, atElapsed(startedAt, 60)),
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

test('offers a no-capture media port with only prepare, begin, finish, and abort operations', async () => {
  const contract = requireCandidateMmiContract(await loadCandidateMmiContract());
  const port = contract.media.createNoCaptureMediaPort();

  assert.deepEqual(Object.keys(port).sort(), ['abort', 'beginResponse', 'finishResponse', 'prepare']);
  await port.prepare({ sessionId: 'synthetic-station-session' });
  await port.beginResponse({ sessionId: 'synthetic-station-session', promptOrder: 1 });
  assert.equal(await port.finishResponse(), null);
  await port.abort({ sessionId: 'synthetic-station-session', reason: 'leave' });
  assert.equal(JSON.stringify(port).match(/MediaRecorder|camera|storage|upload/i), null);
});
