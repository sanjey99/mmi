import { describe, expect, it } from 'vitest';
import { parseQuestionCsv } from '../src/features/questions/csv';

describe('parseQuestionCsv', () => {
  it('maps the documented header order and keeps imported rows as drafts', () => {
    const result = parseQuestionCsv([
      'category,text,difficulty,subcategory,university_tags,is_mmi_suitable,guidance_notes',
      'ethics,"A patient declines treatment. How would you balance autonomy, safety, and communication?",intermediate,autonomy,"oxford,ucl",true,"Look for balance"',
    ].join('\n'));

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{
      sourceRow: 2,
      value: {
        category: 'ethics',
        text: 'A patient declines treatment. How would you balance autonomy, safety, and communication?',
        difficulty: 'intermediate',
        subcategory: 'autonomy',
        university_tags: ['oxford', 'ucl'],
        is_mmi_suitable: true,
        guidance_notes: 'Look for balance',
        is_active: false,
      },
    }]);
  });

  it('supports quoted commas, quoted newlines, and escaped quotes', () => {
    const result = parseQuestionCsv(
      'category,text,difficulty\r\nethics,"First line, with context.\r\nThe patient says ""no""; how do you respond?",foundation',
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.value.text).toBe('First line, with context.\nThe patient says "no"; how do you respond?');
  });

  it('reports missing headers and row-level validation without returning invalid rows', () => {
    expect(parseQuestionCsv('category,subcategory,text\nethics,autonomy,Short')).toEqual({
      rows: [],
      errors: [{ row: 1, message: 'Missing required column: difficulty.' }],
    });

    const invalid = parseQuestionCsv('category,text,difficulty\nunknown,"This is a sufficiently long question for validation",hard');
    expect(invalid.rows).toEqual([]);
    expect(invalid.errors).toEqual([
      { row: 2, message: 'Choose a supported category. Choose a supported difficulty.' },
    ]);
  });

  it('enforces a bounded file size and row count before any write', () => {
    const tooLarge = parseQuestionCsv('x'.repeat(1_000_001));
    expect(tooLarge.errors).toEqual([{ row: 1, message: 'CSV files must be 1 MB or smaller.' }]);

    const rows = ['category,text,difficulty'];
    for (let index = 0; index < 501; index += 1) {
      rows.push(`ethics,"Question number ${index} contains enough characters to validate safely",foundation`);
    }
    expect(parseQuestionCsv(rows.join('\n')).errors).toEqual([
      { row: 1, message: 'CSV files may contain at most 500 data rows.' },
    ]);
  });
});
