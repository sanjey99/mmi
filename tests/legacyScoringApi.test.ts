import { describe, expect, it, vi } from 'vitest';
import {
  LegacyScoringError,
  createLegacyScoringApi,
} from '../src/features/practice/scoringApi';
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

describe('legacy scoring client boundary', () => {
  it('sends only owned resource identifiers and answer text to the Edge function', async () => {
    const invoke = vi.fn(async () => ({ data: score, error: null }));
    const api = createLegacyScoringApi(invoke);

    await expect(api.scoreAnswer({
      sessionId: '6f86f4d9-af0f-4c79-a15f-3577a4218c74',
      questionId: 'f51362d7-a51a-4d67-b97b-4f56181d871b',
      answerText: 'A sufficiently complete synthetic response.',
    })).resolves.toEqual(score);

    expect(invoke).toHaveBeenCalledWith('score-answer', {
      body: {
        sessionId: '6f86f4d9-af0f-4c79-a15f-3577a4218c74',
        questionId: 'f51362d7-a51a-4d67-b97b-4f56181d871b',
        answerText: 'A sufficiently complete synthetic response.',
      },
    });
  });

  it('rejects malformed identifiers and answer bounds before invoking a paid function', async () => {
    const invoke = vi.fn();
    const api = createLegacyScoringApi(invoke);

    await expect(api.scoreAnswer({
      sessionId: 'not-a-uuid',
      questionId: 'f51362d7-a51a-4d67-b97b-4f56181d871b',
      answerText: 'Short',
    })).rejects.toMatchObject({ code: 'invalid_request' } as LegacyScoringError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['provider_not_configured', 'Scoring is not configured yet.'],
    ['rate_limited', 'You have reached the scoring limit.'],
    ['in_progress', 'This response is already being scored.'],
    ['answer_conflict', 'This station already has a different submitted response.'],
    ['provider_failed', 'The scoring provider is temporarily unavailable.'],
    ['invalid_provider_response', 'The scorer returned an invalid response. Please retry.'],
  ])('maps allowlisted server code %s to safe copy', async (code, message) => {
    const response = new Response(JSON.stringify({ code }), { status: 409 });
    const api = createLegacyScoringApi(async () => ({ data: null, error: { context: response } }));

    const error = await api.scoreAnswer({
      sessionId: '6f86f4d9-af0f-4c79-a15f-3577a4218c74',
      questionId: 'f51362d7-a51a-4d67-b97b-4f56181d871b',
      answerText: 'A sufficiently complete synthetic response.',
    }).catch(caught => caught);

    expect(error).toBeInstanceOf(LegacyScoringError);
    expect(error).toMatchObject({ code, message });
  });

  it('does not expose unknown server payloads or provider bodies', async () => {
    const response = new Response(JSON.stringify({
      code: 'database_error',
      detail: 'provider response and internal table name',
    }), { status: 500 });
    const api = createLegacyScoringApi(async () => ({ data: null, error: { context: response } }));

    let error: unknown;
    try {
      await api.scoreAnswer({
        sessionId: '6f86f4d9-af0f-4c79-a15f-3577a4218c74',
        questionId: 'f51362d7-a51a-4d67-b97b-4f56181d871b',
        answerText: 'A sufficiently complete synthetic response.',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(LegacyScoringError);
    if (!(error instanceof LegacyScoringError)) throw new Error('Expected a LegacyScoringError');
    expect(error.code).toBe('request_failed');
    expect(error.message).not.toContain('provider');
    expect(error.message).not.toContain('table');
  });

  it('rejects a malformed success payload instead of rendering untrusted scores', async () => {
    const api = createLegacyScoringApi(async () => ({
      data: { ...score, structure: 99 },
      error: null,
    }));

    await expect(api.scoreAnswer({
      sessionId: '6f86f4d9-af0f-4c79-a15f-3577a4218c74',
      questionId: 'f51362d7-a51a-4d67-b97b-4f56181d871b',
      answerText: 'A sufficiently complete synthetic response.',
    })).rejects.toMatchObject({ code: 'invalid_response' } as LegacyScoringError);
  });
});
