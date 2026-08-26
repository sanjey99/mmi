import { describe, expect, it } from 'vitest';
import {
  hashLegacyAnswer,
  parseLegacyScoringRequest,
  readLegacyClaim,
  safeLegacyRpcCode,
} from '../supabase/functions/_shared/legacyScoring';

const validRequest = {
  sessionId: '6f86f4d9-af0f-4c79-a15f-3577a4218c74',
  questionId: 'f51362d7-a51a-4d67-b97b-4f56181d871b',
  answerText: 'A sufficiently complete synthetic response.',
};

describe('legacy scoring Edge core', () => {
  it('accepts only the exact identifier-and-answer request shape', () => {
    expect(parseLegacyScoringRequest(validRequest)).toEqual(validRequest);
    expect(() => parseLegacyScoringRequest({ ...validRequest, userId: 'forged' })).toThrow('invalid_request');
    expect(() => parseLegacyScoringRequest({ ...validRequest, questionText: 'forged' })).toThrow('invalid_request');
    expect(() => parseLegacyScoringRequest({ ...validRequest, answerText: ' too short ' })).toThrow('invalid_request');
  });

  it('creates a stable lowercase SHA-256 digest without retaining the answer', async () => {
    await expect(hashLegacyAnswer('A sufficiently complete synthetic response.')).resolves.toBe(
      '9fe041cfb70b681d247f2be103214825d112f4dd0fe5a9b6859b639531d555de',
    );
  });

  it('accepts fixed claim states and requires an authoritative prompt for acquisition', () => {
    expect(readLegacyClaim({
      status: 'acquired',
      claim_id: '6f86f4d9-af0f-4c79-a15f-3577a4218c74',
      lease_token: 'f51362d7-a51a-4d67-b97b-4f56181d871b',
      question_text: 'Authoritative prompt',
    })).toMatchObject({ status: 'acquired', question_text: 'Authoritative prompt' });
    expect(readLegacyClaim({ status: 'in_progress' })).toEqual({ status: 'in_progress' });
    expect(() => readLegacyClaim({ status: 'acquired', question_text: '' })).toThrow('persistence_failed');
  });

  it('allows only reviewed database error codes across the HTTP boundary', () => {
    expect(safeLegacyRpcCode({ message: 'answer_conflict' })).toBe('answer_conflict');
    expect(safeLegacyRpcCode({ message: 'rate_limited', details: 'secret table details' })).toBe('rate_limited');
    expect(safeLegacyRpcCode({ message: 'relation public.answers failed' })).toBe('persistence_failed');
  });
});
