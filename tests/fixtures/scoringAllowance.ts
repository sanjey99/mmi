import type { CandidateMmiScoringAllowance } from '../../src/features/candidateMmi/scoringAllowance';

export function scoringAllowanceFixture(overrides: Partial<CandidateMmiScoringAllowance> = {}): CandidateMmiScoringAllowance {
  return {
    checkedAt: '2026-10-20T12:00:00.000Z', resetsAt: '2026-10-21T00:00:00.000Z',
    responsesRemaining: 10, attemptsRemaining: 20, stationAllowanceRemaining: 2,
    scoringPaused: false, globalCapacityAvailable: true,
    ...overrides,
  };
}
