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
const expectedSourceHash = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71';
const expectedCanonicalPayloadFingerprints = Object.freeze({
  'normalized-stations-part-1.json': '83164f9cbac54447edd13e023b5d83ace389d5bc0d82629e525ae3ad680c1f3a',
  'normalized-stations-part-2.json': 'fd91a790ac99e6fb87facb1f121abd54d407abe7c7f6315c379cb966230e2cf0',
});
const privateArtifactPaths = [
  '/supabase/imports/20260825_med_interview_question_bank/normalized-stations-part-1.json',
  '/supabase/imports/20260825_med_interview_question_bank/normalized-stations-part-2.json',
] as const;

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

function assertNoPrivatePromptFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoPrivatePromptFields(entry);
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value)) {
    expect(key).not.toMatch(/scenario_text|question_text|model_answer|criteria|panel_note/i);
    assertNoPrivatePromptFields(entry);
  }
}

describe('normalized candidate MMI station import policy', () => {
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

    expect(manifest.artifact_version).toBe(1);
    expect(manifest.source).toEqual({
      basename: 'med_interview_question_bank.xlsx',
      sha256: expectedSourceHash,
    });
    expect(manifest.normalized_flow).toEqual({
      source_namespace: 'med_interview_question_bank',
      candidate_station_count: 155,
      candidate_sub_question_count: 775,
      panel_question_count: 10,
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
    expect(Object.fromEntries(Object.entries(manifest.private_artifacts).map(([name, artifact]) => [
      name,
      artifact.canonical_jsonb_payload_sha256,
    ]))).toEqual(expectedCanonicalPayloadFingerprints);
    assertNoPrivatePromptFields(manifest);
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
