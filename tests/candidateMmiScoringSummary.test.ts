import { describe, expect, it } from 'vitest';
import { CandidateMmiScoringError } from '../src/features/candidateMmi/scoringApi';
import { candidateMmiScoringFailureMessage } from '../src/features/candidateMmi/scoringSummary';

describe('candidate MMI scoring failure summary', () => {
  it('shows the safe actionable provider configuration reason', () => {
    expect(candidateMmiScoringFailureMessage([
      { status: 'rejected', reason: new CandidateMmiScoringError('provider_not_configured') },
      { status: 'rejected', reason: new CandidateMmiScoringError('provider_not_configured') },
    ])).toBe('AI scoring is not configured yet.');
  });

  it('never exposes an unknown thrown error', () => {
    expect(candidateMmiScoringFailureMessage([
      { status: 'rejected', reason: new Error('secret provider response') },
    ])).toBe('AI scoring is unavailable. Try again.');
  });

  it('returns no message when every request settles successfully', () => {
    expect(candidateMmiScoringFailureMessage([
      { status: 'fulfilled', value: { status: 'no_response' } },
    ])).toBeNull();
  });
});
