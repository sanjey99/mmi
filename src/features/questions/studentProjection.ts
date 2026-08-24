import type { Question } from '../../types';

export const STUDENT_QUESTION_COLUMNS = 'id, category, subcategory, text, university_tags, difficulty, is_mmi_suitable, times_attempted, avg_score, created_at';

type StudentQuestionRow = Omit<Question, 'guidance_notes'>;

export function toStudentQuestion(row: StudentQuestionRow): Question {
  return {
    id: row.id,
    category: row.category,
    subcategory: row.subcategory,
    text: row.text,
    guidance_notes: null,
    university_tags: row.university_tags,
    difficulty: row.difficulty,
    is_mmi_suitable: row.is_mmi_suitable,
    times_attempted: row.times_attempted,
    avg_score: row.avg_score,
    created_at: row.created_at,
  };
}
