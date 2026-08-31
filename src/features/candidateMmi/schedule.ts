import type {
  CandidateMmiPhaseProjection,
  CandidateMmiPromptOrder,
} from './types';

export const CANDIDATE_MMI_PREP_SECONDS = 60 as const;
export const CANDIDATE_MMI_RESPONSE_SECONDS = 120 as const;
export const CANDIDATE_MMI_PROMPT_COUNT = 5 as const;
export const CANDIDATE_MMI_TOTAL_SECONDS = 660 as const;

const millisecondsPerSecond = 1_000;

function copyValidDate(value: Date): Date {
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError('Candidate MMI timing requires valid dates.');
  return new Date(timestamp);
}

function atElapsed(startedAt: Date, elapsedSeconds: number): Date {
  return new Date(startedAt.getTime() + elapsedSeconds * millisecondsPerSecond);
}

export function projectCandidateMmiPhase(startedAtInput: Date, serverNowInput: Date): CandidateMmiPhaseProjection {
  const startedAt = copyValidDate(startedAtInput);
  const serverNow = copyValidDate(serverNowInput);
  const elapsedMilliseconds = Math.max(0, serverNow.getTime() - startedAt.getTime());
  const preparationMilliseconds = CANDIDATE_MMI_PREP_SECONDS * millisecondsPerSecond;
  const responseMilliseconds = CANDIDATE_MMI_RESPONSE_SECONDS * millisecondsPerSecond;
  const totalMilliseconds = CANDIDATE_MMI_TOTAL_SECONDS * millisecondsPerSecond;

  if (elapsedMilliseconds < preparationMilliseconds) {
    return Object.freeze({
      kind: 'scenario',
      promptOrder: null,
      phaseStartedAt: atElapsed(startedAt, 0),
      phaseEndsAt: atElapsed(startedAt, CANDIDATE_MMI_PREP_SECONDS),
    });
  }

  if (elapsedMilliseconds < totalMilliseconds) {
    const elapsedAfterPreparation = elapsedMilliseconds - preparationMilliseconds;
    const promptIndex = Math.floor(elapsedAfterPreparation / responseMilliseconds);
    const promptOrder = (promptIndex + 1) as CandidateMmiPromptOrder;
    const phaseStartSeconds = CANDIDATE_MMI_PREP_SECONDS + promptIndex * CANDIDATE_MMI_RESPONSE_SECONDS;
    return Object.freeze({
      kind: 'response',
      promptOrder,
      phaseStartedAt: atElapsed(startedAt, phaseStartSeconds),
      phaseEndsAt: atElapsed(startedAt, phaseStartSeconds + CANDIDATE_MMI_RESPONSE_SECONDS),
    });
  }

  return Object.freeze({
    kind: 'completed',
    promptOrder: null,
    phaseStartedAt: atElapsed(startedAt, CANDIDATE_MMI_TOTAL_SECONDS),
    phaseEndsAt: null,
  });
}

export function secondsRemaining(
  projection: Pick<CandidateMmiPhaseProjection, 'phaseStartedAt' | 'phaseEndsAt'>,
  serverNowInput: Date,
): number {
  if (projection.phaseEndsAt === null) return 0;
  const phaseStartedAt = copyValidDate(projection.phaseStartedAt);
  const phaseEndsAt = copyValidDate(projection.phaseEndsAt);
  const serverNow = copyValidDate(serverNowInput);
  const boundedNow = Math.max(phaseStartedAt.getTime(), serverNow.getTime());
  return Math.max(0, Math.ceil((phaseEndsAt.getTime() - boundedNow) / millisecondsPerSecond));
}
