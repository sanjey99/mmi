import type { AdminMmiCriterionDraft, AdminMmiQuestionDraft, AdminMmiStationDraft } from './types';

const generatedQuestionId = (stationId: string, suffix: number) => `${stationId}-q${suffix}`;
const generatedCriterionId = (questionId: string, suffix: number) => `${questionId}-c${suffix}`;
const nextSuffix = (ids: readonly string[], expression: RegExp) => {
  const used = ids.reduce((maximum, id) => Math.max(maximum, Number(expression.exec(id)?.[1] ?? 0)), 0);
  return used + 1;
};

const createQuestion = (stationId: string, suffix: number, criteria: readonly AdminMmiCriterionDraft[] = []): AdminMmiQuestionDraft => ({
  subQuestionId: generatedQuestionId(stationId, suffix),
  order: suffix,
  questionText: '',
  timeLimitSec: 120,
  modelAnswerCached: null,
  criteria,
});

export const createStationDraft = (stationId = 'new-station'): AdminMmiStationDraft => ({
  stationId,
  expectedVersion: null,
  category: '', topic: '', difficulty: 'foundation', universityTags: [], prepTimeSec: 60, imageUrl: null, scenarioText: '',
  questions: [1, 2, 3, 4, 5].map((suffix) => ({
    ...createQuestion(stationId, suffix),
    criteria: [1, 2, 3, 4].map((criterionSuffix) => ({
      criterionId: generatedCriterionId(generatedQuestionId(stationId, suffix), criterionSuffix),
      order: criterionSuffix, bulletText: '', domain: null, sourceWeight: 1,
    })),
  })),
});

/** Remap only unsaved, generated IDs; loaded source IDs are immutable identity. */
export const remapUnsavedStationDraft = (draft: AdminMmiStationDraft, prospectiveStationId: string): AdminMmiStationDraft => {
  const stationId = prospectiveStationId.trim();
  if (draft.expectedVersion !== null || stationId.length === 0 || stationId === draft.stationId) return draft;
  const oldQuestion = new RegExp(`^${escapeRegExp(draft.stationId)}-q(\\d+)$`);
  return {
    ...draft,
    stationId,
    questions: draft.questions.map((question) => {
      const suffix = oldQuestion.exec(question.subQuestionId)?.[1];
      if (!suffix) return question;
      const subQuestionId = generatedQuestionId(stationId, Number(suffix));
      const oldCriterion = new RegExp(`^${escapeRegExp(question.subQuestionId)}-c(\\d+)$`);
      return {
        ...question,
        subQuestionId,
        criteria: question.criteria.map((criterion) => {
          const criterionSuffix = oldCriterion.exec(criterion.criterionId)?.[1];
          return criterionSuffix ? { ...criterion, criterionId: generatedCriterionId(subQuestionId, Number(criterionSuffix)) } : criterion;
        }),
      };
    }),
  };
};

export const addDraftQuestion = (draft: AdminMmiStationDraft): AdminMmiStationDraft => {
  if (draft.questions.length >= 5) return draft;
  const suffix = nextSuffix(draft.questions.map((question) => question.subQuestionId), new RegExp(`^${escapeRegExp(draft.stationId)}-q(\\d+)$`));
  return { ...draft, questions: [...draft.questions, { ...createQuestion(draft.stationId, suffix), order: draft.questions.length + 1 }] };
};

export const addDraftCriterion = (draft: AdminMmiStationDraft, subQuestionId: string): AdminMmiStationDraft => ({
  ...draft,
  questions: draft.questions.map((question) => {
    if (question.subQuestionId !== subQuestionId || question.criteria.length >= 20) return question;
    const suffix = nextSuffix(question.criteria.map((criterion) => criterion.criterionId), new RegExp(`^${escapeRegExp(question.subQuestionId)}-c(\\d+)$`));
    return { ...question, criteria: [...question.criteria, { criterionId: generatedCriterionId(question.subQuestionId, suffix), order: question.criteria.length + 1, bulletText: '', domain: null, sourceWeight: 1 }] };
  }),
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
