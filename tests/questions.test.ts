import { describe, expect, it } from 'vitest';
import {
  countQuestionsByCategory,
  pickRandomQuestion,
} from '../src/features/questions/selection';
import type { Question } from '../src/types';

const question = (id: string, category: Question['category']): Question => ({
  id,
  category,
  subcategory: null,
  text: `Question ${id}`,
  guidance_notes: null,
  university_tags: [],
  difficulty: 'foundation',
  is_mmi_suitable: true,
  times_attempted: 0,
  avg_score: 0,
  created_at: '2026-08-25T00:00:00.000Z',
});

describe('question availability', () => {
  it('returns every supported category with a truthful zero default', () => {
    expect(countQuestionsByCategory([
      question('ethics-1', 'ethics'),
      question('motivation-1', 'motivation'),
    ])).toEqual({
      motivation: 1,
      ethics: 1,
      nhs: 0,
      teamwork: 0,
      resilience: 0,
      scenarios: 0,
    });
  });

  it('selects from the provided category set and avoids an immediate repeat when possible', () => {
    const questions = [question('one', 'ethics'), question('two', 'ethics')];

    expect(pickRandomQuestion(questions, 'one', () => 0)).toMatchObject({ id: 'two' });
    expect(pickRandomQuestion([questions[0]], 'one', () => 0)).toMatchObject({ id: 'one' });
    expect(pickRandomQuestion([], undefined, () => 0)).toBeNull();
  });
});
