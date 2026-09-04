import { CandidateMmiScoringError } from './scoringApi';

const GENERIC_SCORING_FAILURE = 'AI scoring is unavailable. Try again.';

export function candidateMmiScoringFailureMessage(
  outcomes: readonly PromiseSettledResult<unknown>[],
): string | null {
  const failures = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
  );
  if (failures.length === 0) return null;

  const safeFailures = failures
    .map((failure) => failure.reason)
    .filter((reason): reason is CandidateMmiScoringError => (
      reason instanceof CandidateMmiScoringError
    ));
  const configurationFailure = safeFailures.find(
    (failure) => failure.code === 'provider_not_configured',
  );
  return configurationFailure?.message ?? safeFailures[0]?.message ?? GENERIC_SCORING_FAILURE;
}
