import { access, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const importDirectory = path.resolve(
  process.cwd(),
  'supabase/imports/20260825_med_interview_question_bank',
);
const generatorPath = path.join(importDirectory, 'generate_normalized_station_import.py');
const manifestPath = path.join(importDirectory, 'normalized-station-manifest.json');
const stationMigrationPath = path.resolve(
  process.cwd(),
  'supabase/migrations/20260826000000_normalized_mmi_station_orchestration.sql',
);
const rubricContentMigrationPath = path.resolve(
  process.cwd(),
  'supabase/migrations/20260910000000_mmi_rubric_content_import.sql',
);
const expectedSourceHash = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71';
const expectedCanonicalPayloadFingerprints = Object.freeze({
  'normalized-stations-part-1.json': 'b44d9ac27997340e7f6bef1f3c9bfa9cdd909186b70c29fba67f4a5438b66725',
  'normalized-stations-part-2.json': '04b7fb7ccd236edcf5d537ccfb6be55b6be03ebe91c3f8e93c0f4a98c62689d6',
});
const privateArtifactPaths = [
  '/supabase/imports/20260825_med_interview_question_bank/normalized-stations-part-1.json',
  '/supabase/imports/20260825_med_interview_question_bank/normalized-stations-part-2.json',
] as const;
const v2PrivatePayloadKeys = Object.freeze([
  'stations',
  'panel_questions',
  'station_id',
  'category',
  'topic',
  'difficulty',
  'university_tags',
  'prep_time_sec',
  'status',
  'image_url',
  'scenario_text',
  'sub_questions',
  'sub_q_id',
  'order_num',
  'source_flat_id',
  'combined_text',
  'question_text',
  'time_limit_sec',
  'model_answer',
  'model_answer_cached',
  'criteria',
  'marking_criteria',
  'criterion_id',
  'bullet_text',
  'source_weight',
  'domain',
  'panel_note',
  'panel_notes',
  'question_id',
] as const);

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runGeneratorProbe(program: string) {
  const { stdout } = await execFileAsync('python3', ['-c', program, generatorPath], {
    cwd: process.cwd(),
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

function assertNoPrivatePayloadFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoPrivatePayloadFields(entry);
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value)) {
    expect(v2PrivatePayloadKeys as readonly string[]).not.toContain(key);
    assertNoPrivatePayloadFields(entry);
  }
}

describe('normalized candidate MMI station import policy', () => {
  it('rejects every v2 private payload schema field from tracked metadata', () => {
    for (const privateKey of v2PrivatePayloadKeys) {
      expect(() => assertNoPrivatePayloadFields({ [privateKey]: 'synthetic private value' })).toThrow();
    }
    expect(() => assertNoPrivatePayloadFields({
      artifact_version: 2,
      source: { basename: 'med_interview_question_bank.xlsx', sha256: expectedSourceHash },
      normalized_flow: {
        candidate_station_count: 155,
        candidate_sub_question_count: 775,
        candidate_criterion_count: 3100,
        panel_question_count: 10,
        criteria_per_candidate_sub_question: { min: 4, max: 4 },
        timing: { scenario_seconds: 60, response_seconds: 120, response_count: 5, total_seconds: 660 },
      },
      private_artifacts: {
        'normalized-stations-part-1.json': {
          sha256: 'a'.repeat(64),
          canonical_jsonb_payload_sha256: 'b'.repeat(64),
        },
      },
      policy: { criteria_preserved: true, orphaned_criteria: 'reject_and_report' },
    })).not.toThrow();
  });

  it('ships a verified local-only generator instead of inferring candidate groups from prompt wording', async () => {
    const generatorExists = await exists(generatorPath);

    expect(generatorExists).toBe(true);
    if (!generatorExists) return;

    const generator = await readFile(generatorPath, 'utf8');
    expect(generator).toContain(`EXPECTED_SOURCE_SHA256 = '${expectedSourceHash}'`);
    expect(generator).toContain("SOURCE_NAMESPACE = 'med_interview_question_bank'");
    expect(generator).toContain("re.fullmatch(r'MMI_\\d{3}'");
    expect(generator).toContain("re.fullmatch(r'MMI_\\d{3}_Q\\d+'");
    expect(generator).toContain("re.fullmatch(r'PANEL_\\d{3}'");
    expect(generator).toContain("['1.0', '2.0', '3.0', '4.0', '5.0']");
    expect(generator).toContain("'stable_grouping_source': 'workbook_station_id_and_sub_q_id'");
    expect(generator).toContain("'missing_or_inconsistent_grouping': 'reject'");
  });

  it('publishes metadata-only normalized counts, stable provenance, and fixed timing', async () => {
    const manifestExists = await exists(manifestPath);

    expect(manifestExists).toBe(true);
    if (!manifestExists) return;

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      artifact_version: number;
      source: { basename: string; sha256: string };
      normalized_flow: {
        source_namespace: string;
        candidate_station_count: number;
        candidate_sub_question_count: number;
        panel_question_count: number;
        sub_question_orders: number[];
        stable_grouping_source: string;
        missing_or_inconsistent_grouping: string;
        timing: { scenario_seconds: number; response_seconds: number; response_count: number; total_seconds: number };
      };
      private_artifacts: Record<string, { sha256: string; canonical_jsonb_payload_sha256: string }>;
    };

    expect(manifest.artifact_version).toBe(2);
    expect(manifest.source).toEqual({
      basename: 'med_interview_question_bank.xlsx',
      sha256: expectedSourceHash,
    });
    expect(manifest.normalized_flow).toMatchObject({
      source_namespace: 'med_interview_question_bank',
      candidate_station_count: 155,
      candidate_sub_question_count: 775,
      candidate_criterion_count: 3100,
      panel_question_count: 10,
      criteria_per_candidate_sub_question: { min: 4, max: 4 },
      sub_question_orders: [1, 2, 3, 4, 5],
      stable_grouping_source: 'workbook_station_id_and_sub_q_id',
      missing_or_inconsistent_grouping: 'reject',
      timing: {
        scenario_seconds: 60,
        response_seconds: 120,
        response_count: 5,
        total_seconds: 660,
      },
    });
    expect((manifest as { policy?: unknown }).policy).toMatchObject({
      criteria_preserved: true,
      source_weights_preserved: true,
      domains_preserved: true,
      cached_model_answers_preserved_when_non_empty: true,
      panel_notes_preserved_admin_only: true,
      orphaned_criteria: 'reject_and_report',
    });
    expect(Object.fromEntries(Object.entries(manifest.private_artifacts).map(([name, artifact]) => [
      name,
      artifact.canonical_jsonb_payload_sha256,
    ]))).toEqual(expectedCanonicalPayloadFingerprints);
    assertNoPrivatePayloadFields(manifest);
  });

  it('normalizes ordered criteria and admin-only panel notes without copying model answers into prompts', async () => {
    const result = await runGeneratorProbe(`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location('normalized_generator', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
station = (10, {
    'station_id': 'MMI_001', 'category': 'ethics', 'topic': 'Synthetic topic',
    'difficulty': 'foundation', 'uni_tags': '  ALPHA, Beta ', 'prep_time_sec': '60',
    'scenario_text': 'Synthetic scenario', 'image_url': 'draft',
})
questions = [(20 + order, {
    'sub_q_id': f'MMI_001_Q{order}', 'station_id': 'MMI_001', 'order': f'{order}.0',
    'question_text': f'Synthetic question {order}', 'time_limit_sec': '120',
    'model_answer_cached': '' if order == 1 else f'Synthetic answer {order}',
}) for order in range(1, 6)]
criteria = [(100 + order * 10 + criterion, {
    'criterion_id': f'MMI_001_Q{order}_C{criterion}', 'sub_q_id': f'MMI_001_Q{order}',
    'bullet_text': f' Synthetic criterion {order}-{criterion} ', 'weight': str(criterion),
    'domain': ' ETHICS ',
}) for order in range(1, 6) for criterion in range(1, 5)]
panels = [(400, {
    'question_id': 'PANEL_001', 'station_type': 'communication', 'topic': 'Synthetic panel topic',
    'difficulty': 'foundation', 'uni_tags': 'ALPHA', 'question_text': 'Synthetic panel question',
    'model_answer_cached': '', 'panel_notes': 'Synthetic admin note',
})]
normalized = module.normalize_content([station], questions, criteria, panels)
print(json.dumps(normalized, sort_keys=True))
`);

    const station = (result.stations as Array<Record<string, unknown>>)[0];
    const questions = station.sub_questions as Array<Record<string, unknown>>;
    expect(station).toMatchObject({
      university_tags: ['alpha', 'beta'], status: 'draft', image_url: null,
    });
    expect(questions.map(question => question.model_answer_cached)).toEqual([
      null, 'Synthetic answer 2', 'Synthetic answer 3', 'Synthetic answer 4', 'Synthetic answer 5',
    ]);
    expect(questions.map(question => question.marking_criteria)).toEqual(
      Array.from({ length: 5 }, (_, questionIndex) => Array.from({ length: 4 }, (_, criterionIndex) => ({
        criterion_id: `MMI_001_Q${questionIndex + 1}_C${criterionIndex + 1}`,
        order_num: criterionIndex + 1,
        bullet_text: `Synthetic criterion ${questionIndex + 1}-${criterionIndex + 1}`,
        source_weight: criterionIndex + 1,
        domain: 'ethics',
      }))),
    );
    expect(questions.flatMap(question => question.marking_criteria as Array<Record<string, unknown>>)).toHaveLength(20);
    expect(JSON.stringify(questions.map(question => question.question_text))).not.toContain('Synthetic answer');
    expect(result.panel_questions).toEqual([expect.objectContaining({
      question_id: 'PANEL_001', panel_notes: 'Synthetic admin note', model_answer_cached: null,
    })]);
  });

  it('rejects mismatched, duplicate, and orphaned criterion provenance before import', async () => {
    const result = await runGeneratorProbe(`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location('normalized_generator', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
station = (1, {'station_id': 'MMI_001', 'category': 'ethics', 'topic': 'Synthetic', 'difficulty': 'foundation', 'uni_tags': 'synthetic', 'prep_time_sec': '60', 'scenario_text': 'Synthetic'})
questions = [(order, {'sub_q_id': f'MMI_001_Q{order}', 'station_id': 'MMI_001', 'order': f'{order}.0', 'question_text': f'Question {order}', 'time_limit_sec': '120', 'model_answer_cached': ''}) for order in range(1, 6)]
criteria = [(100 + order * 10 + criterion, {'criterion_id': f'MMI_001_Q{order}_C{criterion}', 'sub_q_id': f'MMI_001_Q{order}', 'bullet_text': f'Criterion {order}-{criterion}', 'weight': '1', 'domain': 'ethics'}) for order in range(1, 6) for criterion in range(1, 5)]
cases = {
  'mismatched_suffix': ([(1, {**questions[0][1], 'sub_q_id': 'MMI_001_Q9'})] + questions[1:], criteria),
  'duplicate_question': (questions + [(99, dict(questions[0][1]))], criteria),
  'duplicate_criterion': (questions, criteria + [(999, dict(criteria[0][1]))]),
  'orphan_criterion': (questions, criteria + [(1000, {'criterion_id': 'ORPHAN_001', 'sub_q_id': 'MMI_999_Q1', 'bullet_text': 'Orphan', 'weight': '1', 'domain': 'ethics'})]),
}
outcomes = {}
for name, (case_questions, case_criteria) in cases.items():
    try:
        value = module.normalize_content([station], case_questions, case_criteria, [])
        outcomes[name] = {'rejected': False, 'report': value['report']}
    except ValueError:
        outcomes[name] = {'rejected': True}
print(json.dumps(outcomes, sort_keys=True))
`);

    expect(result).toMatchObject({
      mismatched_suffix: { rejected: true },
      duplicate_question: { rejected: false, report: { candidate_station_count: 1, rejected_duplicate_sub_questions: 1 } },
      duplicate_criterion: { rejected: true },
      orphan_criterion: { rejected: false, report: { rejected_orphaned_criteria: 1, accepted_orphaned_criteria: 0 } },
    });
  });

  it('keeps normalized payload artifacts ignored while the metadata manifest remains tracked-safe', async () => {
    const gitignore = await readFile(path.resolve(process.cwd(), '.gitignore'), 'utf8');
    const importIgnoreRules = gitignore
      .split(/\r?\n/)
      .filter(rule => rule.includes('supabase/imports/20260825_med_interview_question_bank/normalized-stations-'));

    expect(importIgnoreRules).toEqual([...privateArtifactPaths]);
    expect(privateArtifactPaths).not.toContain('/supabase/imports/20260825_med_interview_question_bank/normalized-station-manifest.json');
  });

  it('rejects a sub-question provenance identity that belongs to a different station', async () => {
    const result = await runGeneratorProbe(`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location('normalized_generator', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
candidates = []
for station_number in range(1, 156):
    station_id = f'MMI_{station_number:03d}'
    sub_question_station_id = 'MMI_999' if station_id == 'MMI_001' else station_id
    for order_num in range(1, 6):
        candidates.append({
            'station_id': station_id,
            'sub_q_id': f'{sub_question_station_id}_Q{order_num}',
            'order_num': order_num,
            'scenario_text': f'Synthetic scenario {station_id}',
            'question_text': f'Synthetic prompt {order_num}',
            'source_flat_id': f'{station_id}/{sub_question_station_id}_Q{order_num}',
            'category': 'ethics',
            'topic': 'Synthetic topic',
            'difficulty': 'intermediate',
            'university_tags': ['synthetic'],
        })
try:
    module.normalize_stations(candidates)
except ValueError as error:
    print(json.dumps({'rejected': True, 'message': str(error)}))
else:
    print(json.dumps({'rejected': False}))
`);

    expect(result).toMatchObject({ rejected: true });
  });

  it('preserves a shared multi-paragraph scenario and each response prompt through group-level boundary derivation', async () => {
    const result = await runGeneratorProbe(`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location('normalized_generator', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
shared_scenario = 'Synthetic first paragraph.\\n\\nSynthetic second paragraph.'
prompts = [
    'Synthetic response prompt one.',
    'Synthetic response prompt two.',
    'Synthetic response prompt three.',
    'Synthetic response prompt four.',
    'Synthetic response prompt five.',
]
combined_rows = [f'{shared_scenario}\\n\\n{prompt}' for prompt in prompts]
split_group = getattr(module, 'split_candidate_group_texts', None)
if split_group is None:
    print(json.dumps({'supported': False}))
else:
    scenario, parsed_prompts = split_group(combined_rows)
    print(json.dumps({
        'supported': True,
        'scenario': scenario,
        'prompts': parsed_prompts,
    }))
`);

    expect(result).toEqual({
      supported: true,
      scenario: 'Synthetic first paragraph.\n\nSynthetic second paragraph.',
      prompts: [
        'Synthetic response prompt one.',
        'Synthetic response prompt two.',
        'Synthetic response prompt three.',
        'Synthetic response prompt four.',
        'Synthetic response prompt five.',
      ],
    });
  });

  it('adds private versioned rubric content and a strict transactional v2 importer', async () => {
    const migrationExists = await exists(rubricContentMigrationPath);

    expect(migrationExists).toBe(true);
    if (!migrationExists) return;

    const sql = await readFile(rubricContentMigrationPath, 'utf8');
    for (const table of ['mmi_marking_criteria', 'mmi_panel_questions', 'mmi_station_versions']) {
      expect(sql).toMatch(new RegExp(`create\\s+table\\s+public\\.${table}\\b`, 'i'));
      expect(sql).toMatch(new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke\\s+all(?:\\s+privileges)?\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, 'i'));
    }
    expect(sql).toMatch(/to_regclass\s*\(\s*'public\.mmi_marking_criteria_legacy_20260910'\s*\)\s+is\s+not\s+null[\s\S]*?raise\s+exception/i);
    expect(sql).toMatch(/v_relation_kind\s+is\s+distinct\s+from\s+'r'/i);
    expect(sql).not.toMatch(/v_relation_kind\s+not\s+in\s*\([^)]*'p'/i);
    expect(sql).toMatch(/alter\s+table\s+public\.mmi_marking_criteria\s+rename\s+to\s+mmi_marking_criteria_legacy_20260910/i);
    expect(sql).toMatch(/alter\s+table\s+public\.mmi_marking_criteria_legacy_20260910\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/revoke\s+all(?:\s+privileges)?\s+on\s+table\s+public\.mmi_marking_criteria_legacy_20260910\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
    expect(sql).toMatch(/revoke\s+select\s*\([^)]*\)\s*,\s*insert\s*\([^)]*\)\s*,\s*update\s*\([^)]*\)\s*,\s*references\s*\([^)]*\)[\s\S]*?mmi_marking_criteria_legacy_20260910/i);
    expect(sql).toMatch(/legacy MMI marking-criteria archive privilege postcondition failed/i);
    expect(sql).toMatch(/constraint\s+mmi_rubric_criteria_v2_pkey\s+primary\s+key\s*\(\s*criterion_id\s*\)/i);
    expect(sql).toMatch(/constraint\s+mmi_rubric_criteria_v2_sub_q_order_key\s+unique\s*\(\s*sub_q_id\s*,\s*order_num\s*\)/i);
    expect(sql).toMatch(/foreach\s+v_role\s+in\s+array\s+array\[\s*'anon'\s*,\s*'authenticated'\s*\]/i);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(sql).toMatch(new RegExp(`has_table_privilege\\(v_role,\\s*v_table,\\s*'${privilege}'\\)`, 'i'));
    }
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
      expect(sql).toMatch(new RegExp(`has_any_column_privilege\\(v_role,\\s*v_table,\\s*'${privilege}'\\)`, 'i'));
    }

    expect(sql).toMatch(/criterion_id\s+text\s+not\s+null/i);
    expect(sql).toMatch(/sub_q_id\s+text\s+not\s+null\s+references\s+public\.mmi_sub_questions\s*\(\s*sub_q_id\s*\)\s+on\s+delete\s+cascade/i);
    expect(sql).toMatch(/unique\s*\(\s*sub_q_id\s*,\s*order_num\s*\)/i);
    expect(sql).toMatch(/bullet_text\s+text\s+not\s+null[\s\S]*?between\s+1\s+and\s+2000/i);
    expect(sql).toMatch(/source_weight\s+numeric\s*\(\s*8\s*,\s*3\s*\)\s+not\s+null[\s\S]*?source_weight\s*>\s*0/i);
    expect(sql).toMatch(/primary\s+key\s*\(\s*station_id\s*,\s*version\s*\)/i);
    expect(sql).toMatch(/add\s+column\s+content_version\s+integer\s+not\s+null\s+default\s+1/i);
    expect(sql).toMatch(/add\s+column\s+archived_at\s+timestamptz/i);
    expect(sql).toMatch(/add\s+column\s+source_time_limit_sec\s+integer\s+not\s+null\s+default\s+120/i);
    expect(sql).toMatch(/source_time_limit_sec\s+in\s*\(\s*90\s*,\s*120\s*\)/i);
    expect(sql).toMatch(/check\s*\(\s*status\s+in\s*\(\s*'draft'\s*,\s*'published'\s*,\s*'archived'\s*\)\s*\)/i);
    expect(sql).toMatch(/create\s+trigger\s+mmi_station_versions_immutable[\s\S]*?before\s+update\s+or\s+delete[\s\S]*?on\s+public\.mmi_station_versions/i);
    expect(sql).toMatch(/tg_op\s*=\s*'UPDATE'[\s\S]*?old\.created_by\s+is\s+not\s+null[\s\S]*?new\.created_by\s+is\s+null/i);
    expect(sql).toMatch(/tg_op\s*=\s*'UPDATE'[\s\S]*?pg_trigger_depth\s*\(\s*\)\s*>\s*1[\s\S]*?return\s+new/i);
    for (const immutableColumn of ['station_id', 'version', 'content_snapshot', 'created_at']) {
      expect(sql).toMatch(new RegExp(
        `new\\.${immutableColumn}\\s+is\\s+not\\s+distinct\\s+from\\s+old\\.${immutableColumn}`,
        'i',
      ));
    }
    expect(sql).toMatch(/new\.created_by\s+is\s+null[\s\S]*?return\s+new[\s\S]*?raise\s+exception/i);
    expect(sql).toMatch(/raise\s+exception[\s\S]*?errcode\s*=\s*'55000'/i);

    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.import_normalized_mmi_station_batch/i);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.finalize_normalized_mmi_station_import/i);
    expect(sql).toContain('950e52261c043a819dab92183b423a15e43be1ac20e02c4e47927a7b10a0424e');
    expect(sql).toContain('31ba173facd961ef14a9258a41f101c3cebe087b581c481133db88ff9602832c');
    expect(sql).toMatch(/p_payload\s*-\s*array\s*\[\s*'artifact_version'\s*,\s*'source_namespace'\s*,\s*'source_manifest_sha256'\s*,\s*'stations'\s*,\s*'panel_questions'\s*\]\s*<>\s*'\{\}'::jsonb/i);
    expect(sql).toMatch(/v_station\s*-\s*array\s*\[\s*'station_id'[\s\S]*?'sub_questions'\s*\]\s*<>\s*'\{\}'::jsonb/i);
    expect(sql).toMatch(/v_question\s*-\s*array\s*\[\s*'sub_q_id'[\s\S]*?'marking_criteria'\s*\]\s*<>\s*'\{\}'::jsonb/i);
    expect(sql).toMatch(/v_criterion\s*-\s*array\s*\[\s*'criterion_id'\s*,\s*'order_num'\s*,\s*'bullet_text'\s*,\s*'source_weight'\s*,\s*'domain'\s*\]\s*<>\s*'\{\}'::jsonb/i);
    expect(sql).toMatch(/v_panel\s*-\s*array\s*\[\s*'question_id'[\s\S]*?'panel_notes'\s*\]\s*<>\s*'\{\}'::jsonb/i);
    expect(sql).toMatch(/jsonb_array_length\s*\(\s*v_station\s*->\s*'sub_questions'\s*\)\s*<>\s*5/i);
    expect(sql).toMatch(/jsonb_array_length\s*\(\s*v_question\s*->\s*'marking_criteria'\s*\)\s*<>\s*4/i);
    expect(sql).toMatch(/length\s*\(\s*btrim\s*\(\s*v_criterion\s*->>\s*'bullet_text'\s*\)\s*\)\s+not\s+between\s+1\s+and\s+2000/i);
    expect(sql).toMatch(/v_criterion_id\s+is\s+distinct\s+from\s+v_sub_q_id\s*\|\|\s*'_C'/i);

    const stationInsert = sql.search(/insert\s+into\s+public\.mmi_stations/i);
    const questionInsert = sql.search(/insert\s+into\s+public\.mmi_sub_questions/i);
    const criterionInsert = sql.search(/insert\s+into\s+public\.mmi_marking_criteria/i);
    const panelInsert = sql.search(/insert\s+into\s+public\.mmi_panel_questions/i);
    expect(stationInsert).toBeGreaterThanOrEqual(0);
    expect(questionInsert).toBeGreaterThan(stationInsert);
    expect(criterionInsert).toBeGreaterThan(questionInsert);
    expect(panelInsert).toBeGreaterThan(criterionInsert);

    const postcondition = sql.search(/v_station_count\s*<>\s*155[\s\S]*?v_sub_question_count\s*<>\s*775[\s\S]*?v_criterion_count\s*<>\s*3100[\s\S]*?v_panel_count\s*<>\s*10/i);
    const snapshotInsert = sql.search(/insert\s+into\s+public\.mmi_station_versions/i);
    expect(postcondition).toBeGreaterThanOrEqual(0);
    expect(snapshotInsert).toBeGreaterThan(postcondition);
    expect(sql).toMatch(/having\s+count\s*\(\s*c\.criterion_id\s*\)\s*<>\s*4/i);
    expect(sql).toMatch(/v_source_120_count\s*<>\s*772[\s\S]*?v_source_90_count\s*<>\s*3[\s\S]*?v_other_source_duration_count\s*<>\s*0/i);
    expect((sql.match(/\bexcept\b/gi) ?? [])).toHaveLength(2);
    expect(sql).toMatch(/panel\.question_id\s*=\s*question\.source_flat_id/i);
    expect(sql).toMatch(/'sourceTimeLimitSec'\s*,\s*q\.source_time_limit_sec/i);
    expect(sql).toMatch(/jsonb_agg\s*\([\s\S]*?order\s+by\s+(?:q\.)?order_num/i);
    expect(sql).toMatch(/jsonb_agg\s*\([\s\S]*?order\s+by\s+(?:c\.)?order_num/i);
  });

  it('defines an additive, private, service-imported candidate station migration with current-phase-only RPCs', async () => {
    const migrationExists = await exists(stationMigrationPath);

    expect(migrationExists).toBe(true);
    if (!migrationExists) return;

    const sql = await readFile(stationMigrationPath, 'utf8');
    expect(sql).toMatch(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.mmi_normalized_station_import_batches/i);
    expect(sql).toMatch(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.candidate_mmi_station_sessions/i);
    expect(sql).toMatch(/source_namespace/i);
    expect(sql).toMatch(/source_manifest_sha256/i);
    expect(sql).toMatch(/normalized_manifest_sha256/i);
    expect(sql).toMatch(/artifact_sha256/i);
    expect(sql).toMatch(/source_flat_id/i);
    expect(sql).toMatch(/finalized_at/i);
    expect(sql).toMatch(/normalized_mmi_station_enabled/i);
    expect(sql).toMatch(/'false'/i);
    expect(sql).toMatch(/alter\s+table\s+public\.mmi_normalized_station_import_batches\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/alter\s+table\s+public\.candidate_mmi_station_sessions\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/revoke\s+all(?:\s+privileges)?\s+on\s+table\s+public\.mmi_normalized_station_import_batches\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
    expect(sql).toMatch(/revoke\s+all(?:\s+privileges)?\s+on\s+table\s+public\.candidate_mmi_station_sessions\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
    expect(sql).not.toMatch(/grant\s+(?:all|select|insert|update|delete)[\s\S]*?on\s+table\s+public\.mmi_normalized_station_import_batches\s+to\s+(?:public|anon|authenticated|service_role)/i);
    expect(sql).not.toMatch(/grant\s+(?:all|select|insert|update|delete)[\s\S]*?on\s+table\s+public\.candidate_mmi_station_sessions\s+to\s+(?:public|anon|authenticated|service_role)/i);
    expect(sql).toMatch(/acl\.grantee\s*=\s*0/i);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(sql).toMatch(new RegExp(`has_table_privilege\\(v_role, 'public\\.mmi_normalized_station_import_batches', '${privilege}'\\)`, 'i'));
      expect(sql).toMatch(new RegExp(`has_table_privilege\\(v_role, 'public\\.candidate_mmi_station_sessions', '${privilege}'\\)`, 'i'));
      expect(sql).toMatch(new RegExp(`acl\\.privilege_type IN \\([^)]*'${privilege}'`, 'i'));
    }
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
      expect(sql).toMatch(new RegExp(`has_any_column_privilege\\(v_role, 'public\\.mmi_normalized_station_import_batches', '${privilege}'\\)`, 'i'));
      expect(sql).toMatch(new RegExp(`has_any_column_privilege\\(v_role, 'public\\.candidate_mmi_station_sessions', '${privilege}'\\)`, 'i'));
    }
    expect(sql).toMatch(/revoke\s+all(?:\s+privileges)?\s+on\s+table\s+public\.(?:mmi_stations|mmi_sub_questions)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
    expect(sql).toMatch(/clock_timestamp\s*\(\s*\)/i);
    expect(sql).toMatch(/create\s+unique\s+index[\s\S]*?source_namespace[\s\S]*?source_manifest_sha256[\s\S]*?source_flat_id[\s\S]*?where\s+source_flat_id\s+is\s+not\s+null/i);
    expect(sql).toMatch(/count\s*\(\s*distinct\s+source_flat_id\s*\)\s*=\s*775/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/create\s+function\s+public\.start_candidate_mmi_station_session\s*\(\s*\)/i);
    expect(sql).not.toMatch(/create\s+function\s+public\.start_candidate_mmi_station_session\s*\(\s*p_station_id/i);
    expect(sql).toMatch(/order\s+by\s+(?:session\.)?started_at\s+desc/i);
    expect(sql).toMatch(/s\.station_id\s+limit\s+1/i);
    expect(sql).toMatch(/left\s+join\s+public\.candidate_mmi_station_sessions/i);
    expect(sql).toMatch(/max\s*\(\s*previous\.started_at\s*\)/i);

    for (const name of [
      'import_normalized_mmi_station_batch',
      'finalize_normalized_mmi_station_import',
      'start_candidate_mmi_station_session',
      'get_candidate_mmi_station_session',
      'abandon_candidate_mmi_station_session',
    ]) {
      expect(sql).toMatch(new RegExp(`function\\s+public\\.${name}\\b[\\s\\S]*?security\\s+definer|security\\s+definer[\\s\\S]*?function\\s+public\\.${name}\\b`, 'i'));
      expect(sql).toMatch(new RegExp(`function\\s+public\\.${name}\\b[\\s\\S]*?set\\s+search_path\\s*=\\s*pg_catalog\\s*,\\s*public\\s*,\\s*pg_temp`, 'i'));
    }

    for (const name of ['import_normalized_mmi_station_batch', 'finalize_normalized_mmi_station_import']) {
      expect(sql).toMatch(new RegExp(`function\\s+public\\.${name}\\b[\\s\\S]*?auth\\.role\\s*\\(\\s*\\)\\s+is\\s+distinct\\s+from\\s+'service_role'`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]+\\)\\s+to\\s+service_role`, 'i'));
      expect(sql).toMatch(new RegExp(`revoke\\s+all(?:\\s+privileges)?\\s+on\\s+function\\s+public\\.${name}\\([^;]+\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'));
    }

    for (const name of ['start_candidate_mmi_station_session', 'get_candidate_mmi_station_session', 'abandon_candidate_mmi_station_session']) {
      expect(sql).toMatch(new RegExp(`function\\s+public\\.${name}\\b[\\s\\S]*?auth\\.uid\\s*\\(\\s*\\)\\s+is\\s+null`, 'i'));
      expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]*\\)\\s+to\\s+authenticated`, 'i'));
    }

    expect(sql).toMatch(/current_phase_only/i);
    expect(sql).toMatch(/phaseEndsAt'\s*,\s*null/i);
    expect(sql).toMatch(/update\s+public\.mmi_normalized_station_import_batches[\s\S]*?finalized_at/i);
    expect(sql).toMatch(/update\s+public\.mmi_stations[\s\S]*?status\s*=\s*'published'/i);
    expect(sql).toMatch(/status[\s\S]*?'draft'/i);
    expect(sql).toMatch(/finalized_at\s+is\s+not\s+null/i);
    expect(sql).toMatch(/source_manifest_sha256[\s\S]*?source_flat_id/i);
    expect(sql).toMatch(/IS DISTINCT FROM[\s\S]*?source_artifact_sha256/i);
    expect(sql).toMatch(/v_expected_payload_fingerprint\s+text/i);
    expect(sql).toMatch(/v_expected_payload_fingerprint\s*:=\s*'83164f9cbac54447edd13e023b5d83ace389d5bc0d82629e525ae3ad680c1f3a'/i);
    expect(sql).toMatch(/v_expected_payload_fingerprint\s*:=\s*'fd91a790ac99e6fb87facb1f121abd54d407abe7c7f6315c379cb966230e2cf0'/i);
    const fingerprintMismatchIndex = sql.search(/v_payload_fingerprint\s+is\s+distinct\s+from\s+v_expected_payload_fingerprint/i);
    const importLedgerInsertIndex = sql.search(/insert\s+into\s+public\.mmi_normalized_station_import_batches/i);
    expect(fingerprintMismatchIndex).toBeGreaterThanOrEqual(0);
    expect(importLedgerInsertIndex).toBeGreaterThan(fingerprintMismatchIndex);
    expect(sql).toMatch(/candidate_station_count/i);
    expect(sql).toMatch(/candidate_sub_question_count/i);
    expect(sql).toMatch(/valid_station_count/i);
    expect(sql).toMatch(/invalid_station_count/i);
    expect(sql).toMatch(/excluded_panel_question_count/i);
    expect(sql).toMatch(/panel_sub_question_count/i);
    expect(sql).toMatch(/preserved_active_flat_question_count/i);
    expect(sql).not.toMatch(/jsonb_agg\s*\(.*(?:future|prompt)/i);
    expect(sql).not.toMatch(/(?:model_answer|rubric|criteria|score)/i);
    expect(sql).not.toMatch(/(?:delete\s+from|drop\s+table)\s+public\.questions/i);
    expect(sql).not.toMatch(/update\s+public\.questions[\s\S]*?is_active\s*=\s*false/i);
    expect(sql).toMatch(/candidate mmi station .*postcondition/i);
  });
});
