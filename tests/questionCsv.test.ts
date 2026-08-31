import { describe, expect, it } from 'vitest';
import { parseQuestionCsv } from '../src/features/questions/csv';

describe('parseQuestionCsv', () => {
  it('maps the documented header order and keeps imported rows as drafts', () => {
    const result = parseQuestionCsv([
      'category,text,difficulty,subcategory,university_tags,is_mmi_suitable,guidance_notes,source_namespace,source_id,source_manifest_sha256,source_batch_id',
      'ethics,"A patient declines treatment. How would you balance autonomy, safety, and communication?",intermediate,autonomy,"oxford,ucl",true,"Look for balance",med_interview_question_bank,MMI_001/MMI_001_Q1,903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71,questions-part-1',
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
        source_namespace: 'med_interview_question_bank',
        source_id: 'MMI_001/MMI_001_Q1',
        source_manifest_sha256: '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71',
        source_batch_id: 'questions-part-1',
      },
    }]);
  });

  it('supports quoted commas, quoted newlines, and escaped quotes', () => {
    const result = parseQuestionCsv(
      'category,text,difficulty,source_namespace,source_id,source_manifest_sha256,source_batch_id\r\nethics,"First line, with context.\r\nThe patient says ""no""; how do you respond?",foundation,med_interview_question_bank,MMI_001/MMI_001_Q1,903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71,questions-part-1',
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.value.text).toBe('First line, with context.\nThe patient says "no"; how do you respond?');
  });

  it('reports missing headers and row-level validation without returning invalid rows', () => {
    expect(parseQuestionCsv('category,subcategory,text\nethics,autonomy,Short')).toEqual({
      rows: [],
      errors: [{ row: 1, message: 'Missing required column: difficulty.' }],
    });

    const invalid = parseQuestionCsv('category,text,difficulty,source_namespace,source_id,source_manifest_sha256,source_batch_id\nunknown,"This is a sufficiently long question for validation",hard,Med Interview, ,not-a-hash,part 1');
    expect(invalid.rows).toEqual([]);
    expect(invalid.errors).toEqual([
      { row: 2, message: 'Choose a supported category. Choose a supported difficulty. Source namespace must use lowercase letters, digits, and underscores. Source ID is required and may contain only letters, digits, underscores, periods, slashes, colons, and hyphens. Source manifest must be a lowercase SHA-256 value. Source batch ID must use lowercase letters, digits, underscores, and hyphens.' },
    ]);
  });

  it('rejects header-only files before any import', () => {
    expect(parseQuestionCsv(
      'category,text,difficulty,source_namespace,source_id,source_manifest_sha256,source_batch_id',
    )).toEqual({
      rows: [],
      errors: [{ row: 1, message: 'CSV file must contain at least one data row.' }],
    });
  });

  it('accepts only explicit MMI suitability tokens', () => {
    const headers = 'category,text,difficulty,is_mmi_suitable,source_namespace,source_id,source_manifest_sha256,source_batch_id';
    const prompt = 'This question is long enough to pass normal question validation safely.';
    const manifest = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71';

    const valid = parseQuestionCsv([
      headers,
      `ethics,"${prompt}",foundation,yes,med_interview_question_bank,MMI_001/MMI_001_Q1,${manifest},questions-part-1`,
      `ethics,"${prompt}",foundation,0,med_interview_question_bank,MMI_001/MMI_001_Q2,${manifest},questions-part-1`,
      `ethics,"${prompt}",foundation,,med_interview_question_bank,MMI_001/MMI_001_Q3,${manifest},questions-part-1`,
    ].join('\n'));
    expect(valid.errors).toEqual([]);
    expect(valid.rows.map(row => row.value.is_mmi_suitable)).toEqual([true, false, false]);

    expect(parseQuestionCsv([
      headers,
      `ethics,"${prompt}",foundation,perhaps,med_interview_question_bank,MMI_001/MMI_001_Q1,${manifest},questions-part-1`,
    ].join('\n'))).toEqual({
      rows: [],
      errors: [{ row: 2, message: 'MMI suitability must be true/1/yes, false/0/no, or empty.' }],
    });
  });

  it('requires one stable import batch and unique source IDs before any write', () => {
    const headers = 'category,text,difficulty,source_namespace,source_id,source_manifest_sha256,source_batch_id';
    const prompt = 'This question is long enough to pass normal question validation safely.';
    const manifest = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71';

    expect(parseQuestionCsv([
      headers,
      `ethics,"${prompt}",foundation,med_interview_question_bank,MMI_001/MMI_001_Q1,${manifest},questions-part-1`,
      `ethics,"${prompt}",foundation,med_interview_question_bank,MMI_001/MMI_001_Q1,${manifest},questions-part-1`,
    ].join('\n'))).toEqual({
      rows: [],
      errors: [{ row: 3, message: 'Duplicate source ID in this import batch.' }],
    });

    expect(parseQuestionCsv([
      headers,
      `ethics,"${prompt}",foundation,med_interview_question_bank,MMI_001/MMI_001_Q1,${manifest},questions-part-1`,
      `ethics,"${prompt}",foundation,med_interview_question_bank,MMI_001/MMI_001_Q2,${manifest},questions-part-2`,
    ].join('\n'))).toEqual({
      rows: [],
      errors: [{ row: 3, message: 'CSV rows must share one source namespace, manifest, and batch ID.' }],
    });
  });

  it('enforces a bounded file size and row count before any write', () => {
    const tooLarge = parseQuestionCsv('x'.repeat(1_000_001));
    expect(tooLarge.errors).toEqual([{ row: 1, message: 'CSV files must be 1 MB or smaller.' }]);

    const rows = ['category,text,difficulty,source_namespace,source_id,source_manifest_sha256,source_batch_id'];
    for (let index = 0; index < 501; index += 1) {
      rows.push(`ethics,"Question number ${index} contains enough characters to validate safely",foundation,med_interview_question_bank,MMI_001/MMI_001_Q${index},903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71,questions-part-1`);
    }
    expect(parseQuestionCsv(rows.join('\n')).errors).toEqual([
      { row: 1, message: 'CSV files may contain at most 500 data rows.' },
    ]);
  });
});
