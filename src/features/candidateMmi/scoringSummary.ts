import { CandidateMmiScoringError } from './scoringApi';
import type {
  CandidateMmiCriterionResult,
  CandidateMmiPublicAssessment,
} from './api';

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

export type CandidateMmiRubricSummary = Readonly<{
  covered: readonly CandidateMmiCriterionResult[];
  nextTime: readonly CandidateMmiCriterionResult[];
}>;

export function summarizeCandidateMmiAssessment(
  assessment: CandidateMmiPublicAssessment,
): CandidateMmiRubricSummary {
  return Object.freeze({
    covered: Object.freeze(assessment.criteria.filter((criterion) => criterion.achieved)),
    nextTime: Object.freeze(assessment.criteria.filter((criterion) => !criterion.achieved)),
  });
}
