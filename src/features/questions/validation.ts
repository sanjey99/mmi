import type { QuestionCategory, QuestionDifficulty } from '../../types';
import { QUESTION_CATEGORIES } from './selection';

const QUESTION_DIFFICULTIES = Object.freeze([
  'foundation',
  'intermediate',
  'advanced',
] as const satisfies readonly QuestionDifficulty[]);

export interface QuestionDraft {
  category: QuestionCategory;
  text: string;
  difficulty: QuestionDifficulty;
  subcategory: string | null;
  university_tags: string[];
  is_mmi_suitable: boolean;
  guidance_notes: string | null;
  is_active: boolean;
}

type ValidationResult =
  | { success: true; data: QuestionDraft }
  | { success: false; issues: string[] };

const stringValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function validateQuestionDraft(value: unknown): ValidationResult {
  const input = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const category = stringValue(input.category).toLowerCase();
  const text = stringValue(input.text);
  const difficulty = stringValue(input.difficulty).toLowerCase();
  const subcategory = stringValue(input.subcategory);
  const guidanceNotes = stringValue(input.guidance_notes);
  const rawTags = Array.isArray(input.university_tags) ? input.university_tags : [];
  const universityTags = rawTags
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean);
  const issues: string[] = [];

  if (!QUESTION_CATEGORIES.includes(category as QuestionCategory)) {
    issues.push('Choose a supported category.');
  }
  if (text.length < 20 || text.length > 2000) {
    issues.push('Question text must be between 20 and 2000 characters.');
  }
  if (!QUESTION_DIFFICULTIES.includes(difficulty as QuestionDifficulty)) {
    issues.push('Choose a supported difficulty.');
  }
  if (subcategory.length > 100) {
    issues.push('Subcategory must be 100 characters or fewer.');
  }
  if (universityTags.length > 20) {
    issues.push('Use no more than 20 university tags.');
  }
  if (universityTags.some(tag => tag.length > 60)) {
    issues.push('University tags must be 60 characters or fewer.');
  }
  if (guidanceNotes.length > 4000) {
    issues.push('Guidance notes must be 4000 characters or fewer.');
  }

  if (issues.length > 0) return { success: false, issues };

  return {
    success: true,
    data: {
      category: category as QuestionCategory,
      text,
      difficulty: difficulty as QuestionDifficulty,
      subcategory: subcategory || null,
      university_tags: [...new Set(universityTags)],
      is_mmi_suitable: input.is_mmi_suitable === true,
      guidance_notes: guidanceNotes || null,
      is_active: input.is_active === true,
    },
  };
}
