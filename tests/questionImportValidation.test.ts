import { describe, expect, it } from 'vitest';
import { validateQuestionImport } from '../src/features/questions/importValidation';

const source = {
  source_namespace: 'med_interview_question_bank',
  source_id: 'MMI_001/MMI_001_Q1',
  source_manifest_sha256: '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71',
  source_batch_id: 'questions-part-1',
};

describe('validateQuestionImport', () => {
  it('shares normal question validation and rejects published import rows', () => {
    expect(validateQuestionImport({
      category: 'ethics',
      text: 'This prompt is long enough for the question validation contract.',
      difficulty: 'foundation',
      subcategory: null,
      university_tags: [],
      is_mmi_suitable: true,
      guidance_notes: null,
      is_active: true,
      ...source,
    })).toEqual({
      success: false,
      issues: ['Imported questions must be inactive.'],
    });
  });
});
