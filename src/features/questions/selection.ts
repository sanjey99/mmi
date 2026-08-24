import type { Question, QuestionCategory } from '../../types';

export const QUESTION_CATEGORIES = Object.freeze([
  'motivation',
  'ethics',
  'nhs',
  'teamwork',
  'resilience',
  'scenarios',
] as const satisfies readonly QuestionCategory[]);

export type QuestionCounts = Record<QuestionCategory, number>;

export function countQuestionsByCategory(
  questions: readonly Pick<Question, 'category'>[],
): QuestionCounts {
  const initial = Object.fromEntries(
    QUESTION_CATEGORIES.map(category => [category, 0]),
  ) as QuestionCounts;

  return questions.reduce<QuestionCounts>((counts, question) => ({
    ...counts,
    [question.category]: counts[question.category] + 1,
  }), initial);
}

export function pickRandomQuestion(
  questions: readonly Question[],
  previousQuestionId?: string,
  random: () => number = Math.random,
): Question | null {
  if (questions.length === 0) return null;

  const withoutImmediateRepeat = previousQuestionId
    ? questions.filter(question => question.id !== previousQuestionId)
    : questions;
  const candidates = withoutImmediateRepeat.length > 0
    ? withoutImmediateRepeat
    : questions;
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));

  return candidates[index] ?? null;
}
