import { describe, expect, it } from 'vitest';
import { CandidateMmiScoringError } from '../src/features/candidateMmi/scoringApi';
import { candidateMmiScoringFailureMessage, summarizeCandidateMmiAssessment } from '../src/features/candidateMmi/scoringSummary';

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

  it('derives covered and next-time points only from rubric ticks', () => {
    expect(summarizeCandidateMmiAssessment({
      schemaVersion: 3,
      questionScorePct: 25,
      criteria: [
        { criterionId: 'CRIT_1', bulletText: 'Clarify risk', domain: 'safety', weightPct: 25, achieved: true },
        { criterionId: 'CRIT_2', bulletText: 'Protect privacy', domain: null, weightPct: 25, achieved: false },
        { criterionId: 'CRIT_3', bulletText: 'Escalate', domain: null, weightPct: 25, achieved: false },
        { criterionId: 'CRIT_4', bulletText: 'Document', domain: null, weightPct: 25, achieved: false },
      ],
    })).toEqual({
      covered: [{ criterionId: 'CRIT_1', bulletText: 'Clarify risk', domain: 'safety', weightPct: 25, achieved: true }],
      nextTime: [
        { criterionId: 'CRIT_2', bulletText: 'Protect privacy', domain: null, weightPct: 25, achieved: false },
        { criterionId: 'CRIT_3', bulletText: 'Escalate', domain: null, weightPct: 25, achieved: false },
        { criterionId: 'CRIT_4', bulletText: 'Document', domain: null, weightPct: 25, achieved: false },
      ],
    });
  });
});
