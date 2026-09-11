import { describe, expect, it } from 'vitest';
import type { AdminMmiStationDraft } from '../src/features/adminMmi/types';
import { validateStationDraft } from '../src/features/adminMmi/validation';

function stationDraft(): AdminMmiStationDraft {
  return {
    stationId: 'MMI_901',
    expectedVersion: 3,
    category: ' Ethics ',
    topic: ' Confidentiality ',
    difficulty: 'intermediate',
    universityTags: [' Oxford ', 'ALL'],
    prepTimeSec: 60,
    imageUrl: null,
    scenarioText: ' A colleague may have breached confidentiality. ',
    questions: [1, 2, 3, 4, 5].map((order) => ({
      subQuestionId: `MMI_901_Q${order}`,
      order,
      questionText: ` Question ${order}? `,
      timeLimitSec: 120,
      modelAnswerCached: null,
      criteria: [1, 2, 3, 4].map((criterionOrder) => ({
        criterionId: `MMI_901_Q${order}_C${criterionOrder}`,
        order: criterionOrder,
        bulletText: ` Criterion ${criterionOrder} `,
        domain: criterionOrder === 1 ? ' Safety ' : null,
        sourceWeight: 1,
      })),
    })),
  };
}

describe('admin MMI station validation', () => {
  it('normalizes into a new deeply immutable value and derives equal preview weights', () => {
    const input = stationDraft();
    const before = structuredClone(input);

    const result = validateStationDraft(input, 'publish');

    expect(result.issues).toEqual([]);
    expect(result.value).not.toBe(input);
    expect(input).toEqual(before);
    expect(result.value).toMatchObject({
      category: 'Ethics',
      topic: 'Confidentiality',
      universityTags: ['oxford', 'all'],
      scenarioText: 'A colleague may have breached confidentiality.',
    });
    expect(result.value.questions[0]?.criteria[0]).toEqual({
      criterionId: 'MMI_901_Q1_C1',
      order: 1,
      bulletText: 'Criterion 1',
      domain: 'Safety',
      sourceWeight: 1,
    });
    expect(result.equalWeightPreview[0]?.criteria.map((criterion) => criterion.weightPct))
      .toEqual([25, 25, 25, 25]);
    expect(JSON.stringify(result.value)).not.toContain('weightPct');
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.questions)).toBe(true);
    expect(Object.isFrozen(result.value.questions[0]?.criteria)).toBe(true);
  });

  it('allows an incomplete draft while still enforcing safe bounded base fields', () => {
    const incomplete: AdminMmiStationDraft = {
      ...stationDraft(),
      expectedVersion: null,
      topic: '',
      scenarioText: '',
      universityTags: [],
      questions: [],
    };

    expect(validateStationDraft(incomplete, 'draft').issues).toEqual([]);
    expect(validateStationDraft({ ...incomplete, stationId: '../unsafe' }, 'draft').issues)
      .toContainEqual(expect.objectContaining({ path: 'stationId', code: 'invalid_id' }));
    expect(validateStationDraft({ ...incomplete, category: 'x'.repeat(101) }, 'draft').issues)
      .toContainEqual(expect.objectContaining({ path: 'category', code: 'too_long' }));
    expect(validateStationDraft({ ...incomplete, imageUrl: 'http://insecure.example.test/a' }, 'draft').issues)
      .toContainEqual(expect.objectContaining({ path: 'imageUrl', code: 'invalid_url' }));
  });

  it('requires the complete 60 + five-by-120 contract before publication', () => {
    const base = stationDraft();
    const malformed: AdminMmiStationDraft = {
      ...base,
      universityTags: ['Oxford', ' oxford '],
      prepTimeSec: 59 as 60,
      questions: [
        ...base.questions.slice(0, 4),
        {
          ...base.questions[4]!,
          order: 4,
          timeLimitSec: 90 as 120,
          questionText: '   ',
          criteria: [
            base.questions[4]!.criteria[0]!,
            { ...base.questions[4]!.criteria[1]!, criterionId: base.questions[4]!.criteria[0]!.criterionId },
          ],
        },
      ],
    };

    const issueCodes = validateStationDraft(malformed, 'publish').issues.map((issue) => issue.code);

    expect(issueCodes).toEqual(expect.arrayContaining([
      'duplicate_tag',
      'invalid_prep_time',
      'invalid_question_orders',
      'invalid_response_time',
      'required',
      'duplicate_criterion_id',
    ]));
  });

  it('rejects empty criteria and unsafe or oversized nested content for publication', () => {
    const base = stationDraft();
    const result = validateStationDraft({
      ...base,
      scenarioText: 'x'.repeat(10_001),
      questions: base.questions.map((question, index) => index === 0
        ? { ...question, criteria: [] }
        : index === 1
          ? { ...question, criteria: [{ ...question.criteria[0]!, bulletText: 'x'.repeat(2_001) }] }
          : question),
    }, 'publish');

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'scenarioText', code: 'too_long' }),
      expect.objectContaining({ path: 'questions.0.criteria', code: 'required' }),
      expect.objectContaining({ path: 'questions.1.criteria.0.bulletText', code: 'too_long' }),
    ]));
  });

  it('rejects criterion IDs reused by different questions in the same station', () => {
    const base = stationDraft();
    const duplicatedAcrossQuestions: AdminMmiStationDraft = {
      ...base,
      questions: base.questions.map((question, index) => index === 1
        ? {
            ...question,
            criteria: question.criteria.map((criterion, criterionIndex) => criterionIndex === 0
              ? { ...criterion, criterionId: base.questions[0]!.criteria[0]!.criterionId }
              : criterion),
          }
        : question),
    };

    expect(validateStationDraft(duplicatedAcrossQuestions, 'draft').issues)
      .toContainEqual(expect.objectContaining({
        path: 'questions.1.criteria.0.criterionId',
        code: 'duplicate_criterion_id',
      }));
  });
});
