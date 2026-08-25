import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const importDirectory = path.resolve(
  process.cwd(),
  'supabase/imports/20260825_med_interview_question_bank',
);
const privateArtifactPaths = [
  '/supabase/imports/20260825_med_interview_question_bank/questions-part-1.csv',
  '/supabase/imports/20260825_med_interview_question_bank/questions-part-2.csv',
] as const;
const expectedSourceHash = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71';

describe('20260825 medical-interview question-bank import policy', () => {
  it('keeps private prompt payloads out of public clones while preserving verified converter provenance', async () => {
    const [manifestText, generator, gitignore] = await Promise.all([
      readFile(path.join(importDirectory, 'manifest.json'), 'utf8'),
      readFile(path.join(importDirectory, 'generate_import.py'), 'utf8'),
      readFile(path.resolve(process.cwd(), '.gitignore'), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as {
      source: { basename: string; sha256: string };
      artifacts: Record<string, { rows: number; sha256: string }>;
      policy: {
        repeated_headers_removed: number;
        exact_duplicate_rows_deduplicated: number;
        criteria_excluded: boolean;
        cached_model_answers_excluded: boolean;
        panel_notes_excluded: boolean;
        guidance_notes_policy: string;
        category_mapping: Record<string, string>;
        difficulty_normalization: { medium: string; case_insensitive_allowed_values: string[] };
      };
      relationships: {
        complete_mmi_graphs: number;
        quarantined_broken_relations: number;
        quarantine_reason: string;
      };
      prompt_counts: { standard_deduplicated: number; panel_questions: number; total: number };
    };
    const importIgnoreRules = gitignore
      .split(/\r?\n/)
      .filter(rule => rule.includes('supabase/imports/'));

    expect(importIgnoreRules).toEqual([...privateArtifactPaths]);
    expect(manifest.source).toEqual({
      basename: 'med_interview_question_bank.xlsx',
      sha256: expectedSourceHash,
    });
    expect(manifest.artifacts).toEqual({
      'questions-part-1.csv': {
        rows: 500,
        sha256: '021267a618a781d18b7c9b5e4321df56150b53c4f764cccb8ab03bd46786b54a',
      },
      'questions-part-2.csv': {
        rows: 285,
        sha256: '0e4897dcb7da1aa10cb2b4ab7475db7d949ca35c90146054d458c5783e09305e',
      },
    });
    expect(manifest.policy).toMatchObject({
      repeated_headers_removed: 97,
      exact_duplicate_rows_deduplicated: 25,
      criteria_excluded: true,
      cached_model_answers_excluded: true,
      panel_notes_excluded: true,
      guidance_notes_policy: 'source IDs and timing metadata only',
      category_mapping: {
        ethics: 'ethics',
        professionalism: 'ethics',
        motivation: 'motivation',
        'personal statement': 'motivation',
        'nhs hot topics': 'nhs',
        'nhs & healthcare': 'nhs',
        'task prioritisation': 'teamwork',
        communication: 'scenarios',
      },
      difficulty_normalization: {
        medium: 'intermediate',
        case_insensitive_allowed_values: ['foundation', 'intermediate', 'advanced'],
      },
    });
    expect(manifest.relationships).toEqual({
      complete_mmi_graphs: 155,
      quarantined_broken_relations: 5,
      quarantine_reason: 'Station records without a complete five-question relation were excluded.',
    });
    expect(manifest.prompt_counts).toEqual({
      standard_deduplicated: 775,
      panel_questions: 10,
      total: 785,
    });

    expect(generator).toContain(`EXPECTED_SOURCE_SHA256 = '${expectedSourceHash}'`);
    expect(generator).toMatch(/Generated CSV payloads are local-only private proof\. They must\s+not be committed\./);
    expect(generator).toContain("if source.name != 'med_interview_question_bank.xlsx':");
    expect(generator).toContain('if sha256_file(source) != EXPECTED_SOURCE_SHA256:');
    expect(generator).toMatch(/CSV_HEADERS = \[\n(?:    '[a-z_]+',\n){7}\]/);
    const csvHeaders = generator.match(/CSV_HEADERS = \[\n((?:    '[a-z_]+',\n){7})\]/)?.[1] ?? '';
    for (const header of [
      'category',
      'text',
      'difficulty',
      'subcategory',
      'university_tags',
      'is_mmi_suitable',
      'guidance_notes',
    ]) {
      expect(generator).toContain(`    '${header}',`);
    }
    expect(csvHeaders).not.toMatch(/criteria|model_answer|panel_notes/);
    expect(generator).toContain("'criteria_excluded': True,");
    expect(generator).toContain("'cached_model_answers_excluded': True,");
    expect(generator).toContain("'panel_notes_excluded': True,");
    expect(generator).toContain("'guidance_notes_policy': 'source IDs and timing metadata only',");
    expect(generator).toContain("f'{filename} exceeds the 500-row importer limit.'");
    expect(generator).toContain("f'{filename} exceeds the 1 MB importer limit.'");
  });
});
