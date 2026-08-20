import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const migrationPath = fileURLToPath(
  new URL(
    '../supabase/migrations/20260817002000_mmi_practice_persistence.sql',
    import.meta.url,
  ),
);

const tableNames = [
  'mmi_scoring_rubrics',
  'mmi_privacy_notices',
  'mmi_attempts',
  'mmi_prompt_attempts',
  'mmi_attempt_prompt_snapshots',
  'mmi_scoring_claims',
  'mmi_transcription_events',
] as const;

const functionNames = [
  'is_valid_mmi_content_snapshot',
  'is_valid_mmi_text_array',
  'is_valid_mmi_dimension_weights',
  'is_valid_mmi_safety_items',
  'is_valid_mmi_public_dimension_results',
  'mmi_dimension_results_has_no_free_text',
  'prevent_mmi_rubric_content_mutation',
  'prevent_mmi_privacy_notice_content_mutation',
  'prevent_mmi_snapshot_mutation',
  'enforce_mmi_attempt_progression',
  'enforce_mmi_prompt_attempt_mutation',
  'get_active_mmi_privacy_notice',
  'claim_mmi_transcription_attempt',
  'complete_mmi_transcription_attempt',
  'calculate_mmi_attempt_aggregate',
  'purge_expired_mmi_private_text',
] as const;

function readMigration() {
  return readFileSync(migrationPath, 'utf8');
}

function functionDeclaration(sql: string, name: string) {
  const match = sql.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?as\\s+\\$[a-z_]+\\$`,
      'i',
    ),
  );

  assert.ok(match, `expected ${name} to be declared`);
  return match[0];
}

describe('MMI practice persistence SQL policy', () => {
  it('declares the fixed lifecycle enums and all persistence tables', () => {
    const sql = readMigration();

    const enumValues: Record<string, string[]> = {
      mmi_attempt_phase: [
        'preparing',
        'prompt_active',
        'awaiting_continue',
        'final_feedback',
      ],
      mmi_attempt_status: ['in_progress', 'completed', 'abandoned'],
      mmi_claim_status: ['claimed', 'completed', 'retryable_failure'],
      mmi_rubric_status: ['draft', 'active', 'retired'],
      mmi_station_kind: ['standard', 'roleplay'],
      mmi_transcript_retention_mode: ['account_lifetime', 'fixed_days'],
    };

    for (const [name, values] of Object.entries(enumValues)) {
      assert.match(sql, new RegExp(`create\\s+type\\s+public\\.${name}`, 'i'));
      for (const value of values) assert.match(sql, new RegExp(`'${value}'`, 'i'));
    }

    for (const table of tableNames) {
      assert.match(
        sql,
        new RegExp(
          `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${table}\\b`,
          'i',
        ),
      );
      assert.match(
        sql,
        new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'),
      );
    }
  });

  it('enforces rubric targets, versions, weights, review, and immutability', () => {
    const sql = readMigration();

    assert.match(sql, /num_nonnulls\s*\(\s*standard_sub_q_id\s*,\s*roleplay_station_id\s*\)\s*=\s*1/i);
    assert.match(sql, /is_valid_mmi_dimension_weights\s*\(\s*dimension_weights\s*\)/i);
    assert.match(sql, /is_valid_mmi_safety_items\s*\(\s*safety_critical_items\s*\)/i);
    assert.match(sql, /where\s+status\s*=\s*'active'/i);
    assert.match(sql, /unique\s*\(\s*standard_sub_q_id\s*,\s*version\s*\)/i);
    assert.match(sql, /unique\s*\(\s*roleplay_station_id\s*,\s*version\s*\)/i);
    assert.match(sql, /prevent_mmi_rubric_content_mutation/i);
    assert.match(sql, /clinician_reviewed_at\s+is\s+not\s+null/i);
    assert.match(sql, /clinician_reviewed_by\s+is\s+not\s+null/i);
  });

  it('enforces attempt, prompt-result, snapshot, and claim identities', () => {
    const sql = readMigration();

    assert.match(sql, /num_nonnulls\s*\(\s*standard_station_id\s*,\s*roleplay_station_id\s*\)\s*=\s*1/i);
    assert.match(sql, /unique\s*\(\s*id\s*,\s*station_kind\s*\)/i);
    assert.match(sql, /foreign\s+key\s*\(\s*attempt_id\s*,\s*station_kind\s*\)/i);
    assert.match(sql, /unique\s*\(\s*attempt_id\s*,\s*prompt_order\s*\)/i);
    assert.match(sql, /foreign\s+key\s*\(\s*attempt_id\s*,\s*prompt_order\s*\)[\s\S]*?mmi_attempt_prompt_snapshots/i);
    assert.match(sql, /unique\s*\(\s*id\s*,\s*attempt_id\s*\)/i);
    assert.match(sql, /foreign\s+key\s*\(\s*prompt_attempt_id\s*,\s*attempt_id\s*\)/i);
    assert.match(sql, /unique\s*\(\s*user_id\s*,\s*idempotency_key\s*\)/i);
    assert.match(sql, /enforce_mmi_attempt_progression/i);
    assert.match(sql, /tg_op\s*=\s*'INSERT'[\s\S]*?invalid_mmi_attempt_initial_state/i);
    assert.match(sql, /current_prompt_order\s*<=\s*expected_prompt_count/i);
    assert.match(sql, /invalid_mmi_phase_transition/i);
    assert.match(sql, /old\.phase\s*=\s*'awaiting_continue'/i);
    assert.match(sql, /new\.phase\s*=\s*'prompt_active'/i);
    assert.match(sql, /count\s*\(\s*\*\s*\)[\s\S]*?expected_prompt_count/i);
    assert.match(sql, /snapshot_mismatch[\s\S]*?incomplete_mmi_attempt/i);
    assert.match(sql, /generate_series\s*\(\s*1\s*,\s*new\.expected_prompt_count\s*\)/i);
    assert.match(sql, /is_valid_mmi_public_dimension_results\s*\(\s*dimension_results\s*\)/i);
    assert.match(sql, /prevent_mmi_snapshot_mutation/i);
    assert.match(sql, /before\s+update\s+or\s+delete\s+on\s+public\.mmi_attempt_prompt_snapshots/i);
    assert.match(sql, /enforce_mmi_prompt_attempt_mutation/i);
    assert.match(sql, /tg_op\s*=\s*'INSERT'[\s\S]*?mmi_prompt_result_provenance_mismatch/i);
    assert.match(sql, /from\s+public\.mmi_attempts[\s\S]*?for\s+update/i);
    assert.match(sql, /immutable_mmi_prompt_result/i);
    assert.match(sql, /new\.free_text_purged_at\s+is\s+not\s+null[\s\S]*?invalid_mmi_prompt_result_state/i);
    assert.match(sql, /new\.submitted_at\s*:=\s*least\s*\(/i);
    assert.match(sql, /new\.dimension_results\s*=\s*\([\s\S]*?jsonb_each\s*\(\s*old\.dimension_results\s*\)/i);
    assert.match(sql, /free_text_purged_at[\s\S]*?mmi_dimension_results_has_no_free_text/i);
    assert.match(sql, /request_digest[\s\S]*?\^\[a-f0-9\]\{64\}\$/i);
    assert.match(sql, /safe_error_code[\s\S]*?\^\[a-z0-9_\]\{1,64\}\$/i);
  });

  it('keeps public rows safe and all assessor or operational tables service-only', () => {
    const sql = readMigration();

    assert.match(sql, /content_snapshot[\s\S]*?is_valid_mmi_content_snapshot/i);
    assert.match(sql, /jsonb_typeof\s*\(\s*p_snapshot->'station_kind'\s*\)\s*=\s*'string'/i);
    assert.match(sql, /content_snapshot->>'station_kind'\s+is\s+distinct\s+from/i);
    assert.match(sql, /strengths[\s\S]*?is_valid_mmi_text_array/i);
    assert.match(sql, /improvements[\s\S]*?is_valid_mmi_text_array/i);
    assert.doesNotMatch(
      sql.match(/create\s+table\s+public\.mmi_attempts[\s\S]*?;/i)?.[0] ?? '',
      /actor_persona|background_info|rubric_criteria|model_answer_cached/i,
    );

    for (const table of [
      'mmi_scoring_rubrics',
      'mmi_privacy_notices',
      'mmi_attempt_prompt_snapshots',
      'mmi_scoring_claims',
      'mmi_transcription_events',
    ]) {
      assert.match(
        sql,
        new RegExp(
          `revoke\\s+all(?:\\s+privileges)?\\s+on(?:\\s+table)?\\s+public\\.${table}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
          'i',
        ),
      );
    }

    assert.doesNotMatch(sql, /audio_(?:uri|url|bytes|blob|path)|provider_response/i);
  });

  it('exposes only own safe attempt rows and a fixed active-notice RPC', () => {
    const sql = readMigration();

    assert.match(sql, /grant\s+select\s+on\s+table\s+public\.mmi_attempts\s+to\s+authenticated/i);
    assert.match(sql, /grant\s+select\s+on\s+table\s+public\.mmi_prompt_attempts\s+to\s+authenticated/i);
    assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete|all)[^;]*mmi_(?:attempts|prompt_attempts)[^;]*authenticated/i);
    assert.match(sql, /using\s*\(\s*user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
    assert.match(
      functionDeclaration(sql, 'get_active_mmi_privacy_notice'),
      /returns\s+table\s*\(\s*version\s+text\s*,\s*processor_name\s+text\s*,\s*notice_text\s+text\s*,\s*retention_mode\s+public\.mmi_transcript_retention_mode\s*,\s*retention_days\s+integer\s*\)/i,
    );
  });

  it('hardens every function and grants only the intended callable surface', () => {
    const sql = readMigration();

    for (const name of functionNames) {
      assert.match(
        functionDeclaration(sql, name),
        /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i,
      );
      assert.match(
        sql,
        new RegExp(
          `revoke\\s+all(?:\\s+privileges)?\\s+on\\s+function\\s+public\\.${name}\\([^;]*?\\)\\s+from\\s+public`,
          'i',
        ),
      );
    }

    assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.get_active_mmi_privacy_notice\(\)\s+to\s+authenticated/i);
    for (const name of [
      'claim_mmi_transcription_attempt',
      'complete_mmi_transcription_attempt',
      'calculate_mmi_attempt_aggregate',
      'purge_expired_mmi_private_text',
    ]) {
      assert.match(
        sql,
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\([^;]*?\\)\\s+to\\s+service_role`,
          'i',
        ),
      );
    }
  });

  it('implements atomic transcription limits, deterministic aggregation, retention, and Cron', () => {
    const sql = readMigration();

    assert.match(sql, /pg_advisory_xact_lock\s*\(/i);
    assert.match(sql, /interval\s+'60 minutes'/i);
    assert.match(sql, /interval\s+'24 hours'/i);
    assert.match(sql, /300\s*\*\s*1024\s*\*\s*1024/i);
    assert.match(sql, /round\s*\(\s*sum\s*\(\s*overall_pct\s*\)::numeric\s*\/\s*nullif\s*\(\s*count\s*\(\s*\*\s*\)\s*,\s*0\s*\)\s*,\s*1\s*\)/i);
    assert.match(sql, /retention_mode\s*=\s*'fixed_days'/i);
    assert.match(sql, /free_text_purged_at\s*=\s*now\s*\(\s*\)/i);
    assert.match(sql, /mmi_prompt_attempts_retention_cutoff/i);
    assert.match(sql, /mmi_scoring_claims_retention_cutoff/i);
    assert.match(sql, /mmi_transcription_events_retention_cutoff/i);
    assert.match(sql, /limit\s+1000\s+for\s+update(?:\s+of\s+p)?\s+skip\s+locked/i);
    assert.match(sql, /for\s+v_batch\s+in\s+1\.\.10\s+loop/i);
    assert.match(sql, /interval\s+'30 days'/i);
    assert.match(sql, /cron\.schedule\s*\(/i);
    assert.match(sql, /purge_expired_mmi_private_text/i);
  });
});
