import { describe, expect, it, vi } from 'vitest';
import {
  submitLegacyAnswer,
  type LegacyAnswerRecord,
} from '../src/features/practice/submission';
import type { ScoreResult } from '../src/types';

const score: ScoreResult = {
  structure: 4,
  ethics: 4,
  communication: 3,
  reflection: 3,
  nhs_awareness: 2,
  overall_pct: 64,
  ai_feedback: 'Structured and balanced.',
  improvement_tip: 'Make the safety-net explicit.',
};

function dependencies() {
  return {
    findAnswer: vi.fn(async (): Promise<LegacyAnswerRecord | null> => null),
    createAnswer: vi.fn(async () => ({ id: 'answer-1', text: 'A sufficiently complete response.' })),
    findScore: vi.fn(async (): Promise<ScoreResult | null> => null),
    createScore: vi.fn(async () => undefined),
    finalizeSession: vi.fn(async () => undefined),
    scoreAnswer: vi.fn(async () => score),
  };
}

const input = {
  userId: 'user-1',
  sessionId: 'session-1',
  questionId: 'question-1',
  questionText: 'How would you approach this?',
  answerText: 'A sufficiently complete response.',
};

describe('submitLegacyAnswer', () => {
  it('does not persist an answer when the provider fails', async () => {
    const deps = dependencies();
    deps.scoreAnswer.mockRejectedValue(new Error('provider_not_configured'));

    await expect(submitLegacyAnswer(deps, input)).rejects.toThrow('provider_not_configured');

    expect(deps.createAnswer).not.toHaveBeenCalled();
    expect(deps.createScore).not.toHaveBeenCalled();
    expect(deps.finalizeSession).not.toHaveBeenCalled();
  });

  it('replays an already scored identical answer without another provider call', async () => {
    const deps = dependencies();
    deps.findAnswer.mockResolvedValue({ id: 'answer-1', text: input.answerText });
    deps.findScore.mockResolvedValue(score);

    await expect(submitLegacyAnswer(deps, input)).resolves.toEqual(score);

    expect(deps.scoreAnswer).not.toHaveBeenCalled();
    expect(deps.createAnswer).not.toHaveBeenCalled();
    expect(deps.createScore).not.toHaveBeenCalled();
    expect(deps.finalizeSession).toHaveBeenCalledWith(input.sessionId, score);
  });

  it('reuses an unscored identical answer and persists one score', async () => {
    const deps = dependencies();
    deps.findAnswer.mockResolvedValue({ id: 'answer-1', text: input.answerText });

    await expect(submitLegacyAnswer(deps, input)).resolves.toEqual(score);

    expect(deps.createAnswer).not.toHaveBeenCalled();
    expect(deps.createScore).toHaveBeenCalledWith('answer-1', score);
  });

  it('rejects changed text for an existing session answer before calling the provider', async () => {
    const deps = dependencies();
    deps.findAnswer.mockResolvedValue({ id: 'answer-1', text: 'A different response.' });

    await expect(submitLegacyAnswer(deps, input)).rejects.toThrow('answer_conflict');

    expect(deps.scoreAnswer).not.toHaveBeenCalled();
    expect(deps.createScore).not.toHaveBeenCalled();
  });
});
