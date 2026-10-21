import type { CandidateMmiFeedback } from './api';

/** Adapt known unanswered rows for display without changing the stored assessment. */
export function getCandidateMmiFeedbackDisplayAssessment(
  feedback: CandidateMmiFeedback,
): CandidateMmiFeedback['assessment'] {
  const assessment = feedback.assessment;
  if (feedback.status !== 'no_response' || feedback.legacy || assessment?.schemaVersion !== 3
    || assessment.questionScorePct !== 0 || assessment.criteria.length === 0
    || assessment.criteria.some(criterion => criterion.achieved !== false)) return assessment;

  return Object.freeze({
    schemaVersion: 4,
    questionScorePct: 0,
    criteria: Object.freeze(assessment.criteria.map(criterion => Object.freeze({
      criterionId: criterion.criterionId,
      bulletText: criterion.bulletText,
      domain: criterion.domain,
      weightPct: criterion.weightPct,
      performanceLevel: 0 as const,
      evidenceQuote: null,
      justification: 'No answer was recorded for this question, so this criterion was not demonstrated.',
    }))),
  });
}
