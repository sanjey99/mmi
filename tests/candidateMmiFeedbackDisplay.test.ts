import { describe, expect, it } from 'vitest';
import type { CandidateMmiFeedback, CandidateMmiPublicAssessment } from '../src/features/candidateMmi/api';
import { getCandidateMmiFeedbackDisplayAssessment } from '../src/features/candidateMmi/feedbackDisplay';
import { criterionMarks } from '../src/features/mmi/rubricPerformance';

const binaryAssessment = Object.freeze({
  schemaVersion: 3 as const,
  questionScorePct: 0,
  criteria: Object.freeze(['Listen to concerns', 'Explain clearly', 'Explore options', 'Agree next steps'].map((bulletText, index) => Object.freeze({
    criterionId: `C${index + 1}`, bulletText, domain: index === 0 ? 'communication' : null,
    weightPct: 25, achieved: false,
  }))),
});
const unanswered: CandidateMmiFeedback = Object.freeze({
  promptOrder: 4, status: 'no_response', legacy: false, assessment: binaryAssessment,
});

describe('candidate MMI unanswered feedback display', () => {
  it('shows known unanswered criteria at level zero with their original marks and an honest reason', () => {
    const display = getCandidateMmiFeedbackDisplayAssessment(unanswered);
    expect(display).toEqual({
      schemaVersion: 4,
      questionScorePct: 0,
      criteria: binaryAssessment.criteria.map(({ achieved: _achieved, ...criterion }) => ({
        ...criterion, performanceLevel: 0, evidenceQuote: null,
        justification: 'No answer was recorded for this question, so this criterion was not demonstrated.',
      })),
    });
    if (display?.schemaVersion !== 4) throw new Error('Expected graduated display criteria.');
    expect(display.criteria.map(criterionMarks)).toEqual([0, 0, 0, 0]);
  });

  it('keeps the server result unchanged and returns separate immutable display data', () => {
    const original = JSON.stringify(unanswered);
    const display = getCandidateMmiFeedbackDisplayAssessment(unanswered);
    expect(JSON.stringify(unanswered)).toBe(original);
    expect(unanswered.assessment).toBe(binaryAssessment);
    expect(display).not.toBe(binaryAssessment);
    expect(Object.isFrozen(display)).toBe(true);
    if (display?.schemaVersion !== 4) throw new Error('Expected graduated display criteria.');
    expect(Object.isFrozen(display.criteria)).toBe(true);
    for (const [index, criterion] of display.criteria.entries()) {
      expect(Object.isFrozen(criterion)).toBe(true);
      expect(criterion).not.toBe(binaryAssessment.criteria[index]);
      expect(criterion).not.toHaveProperty('achieved');
    }
    expect(binaryAssessment.criteria.every(criterion => !('performanceLevel' in criterion))).toBe(true);
  });

  it('preserves answered binary history, including a zero-score answer', () => {
    const answered: CandidateMmiFeedback = { ...unanswered, status: 'scored' };
    expect(getCandidateMmiFeedbackDisplayAssessment(answered)).toBe(binaryAssessment);
  });

  it('preserves graded answers and legacy results by reference', () => {
    const graded: CandidateMmiPublicAssessment = {
      schemaVersion: 4, questionScorePct: 50,
      criteria: binaryAssessment.criteria.map(({ achieved: _achieved, ...criterion }) => ({
        ...criterion, performanceLevel: 2, evidenceQuote: 'I would ask about their concerns.',
        justification: 'The answer asks about concerns without exploring their impact.',
      })),
    };
    const legacy = { overallPct: 50, rubricVersion: 1 };
    expect(getCandidateMmiFeedbackDisplayAssessment({ ...unanswered, status: 'scored', assessment: graded })).toBe(graded);
    expect(getCandidateMmiFeedbackDisplayAssessment({ ...unanswered, status: 'scored', legacy: true, assessment: legacy })).toBe(legacy);
  });

  it('keeps missing assessments unavailable rather than inventing criteria', () => {
    expect(getCandidateMmiFeedbackDisplayAssessment({ ...unanswered, assessment: null })).toBeNull();
  });

  it.each([
    { ...binaryAssessment, questionScorePct: 25 },
    { ...binaryAssessment, criteria: binaryAssessment.criteria.map((criterion, index) => ({ ...criterion, achieved: index === 0 })) },
    { ...binaryAssessment, criteria: [] },
  ])('does not silently replace inconsistent no-response assessment data %#', (assessment) => {
    expect(getCandidateMmiFeedbackDisplayAssessment({ ...unanswered, assessment })).toBe(assessment);
  });

  it('does not adapt a pending or failed result, or one marked as legacy', () => {
    for (const status of ['pending', 'failed'] as const) {
      expect(getCandidateMmiFeedbackDisplayAssessment({ ...unanswered, status })).toBe(binaryAssessment);
    }
    expect(getCandidateMmiFeedbackDisplayAssessment({ ...unanswered, legacy: true })).toBe(binaryAssessment);
  });
});
