import { describe, expect, it } from 'vitest';
import { validateQuestionDraft } from '../src/features/questions/validation';

describe('validateQuestionDraft', () => {
  it('constructs a normalized immutable draft from valid input', () => {
    expect(validateQuestionDraft({
      category: ' Ethics ',
      text: '  How would you respond when a patient declines the recommended treatment?  ',
      difficulty: 'INTERMEDIATE',
      subcategory: ' autonomy ',
      university_tags: [' Oxford ', 'ucl', ''],
      is_mmi_suitable: true,
      guidance_notes: '  Look for balanced reasoning. ',
      is_active: false,
    })).toEqual({
      success: true,
      data: {
        category: 'ethics',
        text: 'How would you respond when a patient declines the recommended treatment?',
        difficulty: 'intermediate',
        subcategory: 'autonomy',
        university_tags: ['oxford', 'ucl'],
        is_mmi_suitable: true,
        guidance_notes: 'Look for balanced reasoning.',
        is_active: false,
      },
    });
  });

  it('rejects invalid enums, short text, excessive fields, and active-by-default input', () => {
    const result = validateQuestionDraft({
      category: 'clinical',
      text: 'Too short',
      difficulty: 'hard',
      subcategory: 'x'.repeat(101),
      university_tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`),
      guidance_notes: 'x'.repeat(4001),
      is_active: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(expect.arrayContaining([
        'Choose a supported category.',
        'Question text must be between 20 and 2000 characters.',
        'Choose a supported difficulty.',
        'Subcategory must be 100 characters or fewer.',
        'Use no more than 20 university tags.',
        'Guidance notes must be 4000 characters or fewer.',
      ]));
    }
  });
});
