import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe as nodeDescribe, it as nodeIt } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { describe as vitestDescribe, it as vitestIt } from 'vitest';

// Keep this policy contract visible to both configured runners. The regular
// Node command owns `tests/mmi*.test.ts`, while Vitest owns its explicit list.
type Describe = (name: string, body: () => void) => void;
type Test = (name: string, body: () => void) => void;
const describe = (process.env.VITEST ? vitestDescribe : nodeDescribe) as unknown as Describe;
const it = (process.env.VITEST ? vitestIt : nodeIt) as unknown as Test;

const scoringMigration = readFileSync(fileURLToPath(new URL(
  '../supabase/migrations/20260910001000_mmi_rubric_scoring_retention.sql',
  import.meta.url,
)), 'utf8');
const practiceMigration = readFileSync(fileURLToPath(new URL(
  '../supabase/migrations/20260910002000_mmi_university_practice_history.sql',
  import.meta.url,
)), 'utf8');
const adminMigration = readFileSync(fileURLToPath(new URL(
  '../supabase/migrations/20260910003000_mmi_admin_operations.sql',
  import.meta.url,
)), 'utf8');
const finalHardeningMigration = readFileSync(fileURLToPath(new URL(
  '../supabase/migrations/20260910005000_mmi_final_high_blockers.sql',
  import.meta.url,
)), 'utf8');
const candidateApi = readFileSync(fileURLToPath(new URL(
  '../src/features/candidateMmi/api.ts',
  import.meta.url,
)), 'utf8');
const adminApi = readFileSync(fileURLToPath(new URL(
  '../src/features/adminMmi/api.ts',
  import.meta.url,
)), 'utf8');
const keyHandler = readFileSync(fileURLToPath(new URL(
  '../supabase/functions/manage-ai-key/handler.ts',
  import.meta.url,
)), 'utf8');

function lastFunctionBody(sql: string, name: string): string {
  const matches = [...sql.matchAll(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?as\\s+\\$function\\$([\\s\\S]*?)\\$function\\$`,
    'gi',
  ))];
  assert.ok(matches.length > 0, `expected ${name} function body`);
  return matches.at(-1)![1]!;
}

function declaration(sql: string, name: string): string {
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?as\\s+\\$function\\$`,
    'i',
  ));
  assert.ok(match, `expected ${name} function declaration`);
  return match[0]!;
}

const forbiddenProjectionFields = [
  'finalized_transcript',
  'draft_transcript',
  'answer_text',
  'evidence',
  'raw_response',
  'provider_response',
  'api_key',
] as const;

describe('MMI rubric retention and admin projection policy', () => {
  it('keeps candidate and admin browser boundaries recursively hostile to retained response content', () => {
    assert.match(candidateApi, /function hasExactKeys/);
    assert.match(adminApi, /function exact/);
    assert.match(adminApi, /function hasForbiddenKey[\s\S]*?normalized\.includes\('transcript'\)/);
    assert.match(adminApi, /normalized\.includes\('answertext'\)/);
    assert.match(adminApi, /normalized\.includes\('evidence'\)/);
    assert.match(adminApi, /raw\.\*response/);
    assert.match(adminApi, /normalized\.includes\('apikey'\)/);
    assert.match(candidateApi, /const rubricAssessmentKeys = \['criteria', 'questionScorePct', 'schemaVersion'\]/);
    assert.match(candidateApi, /const rubricCriterionKeys = \['achieved', 'bulletText', 'criterionId', 'domain', 'weightPct'\]/);
  });

  it('projects only structured rubric/cost data from candidate results and admin detail', () => {
    const publicBodies = [
      lastFunctionBody(scoringMigration, 'get_candidate_mmi_station_feedback'),
      lastFunctionBody(practiceMigration, 'get_candidate_mmi_station_result'),
      lastFunctionBody(practiceMigration, 'list_candidate_mmi_history'),
      lastFunctionBody(adminMigration, 'list_admin_mmi_assessments'),
      lastFunctionBody(adminMigration, 'get_admin_mmi_assessment'),
    ].join('\n');

    for (const field of forbiddenProjectionFields) {
      assert.doesNotMatch(publicBodies, new RegExp(`['\"]${field}['\"]`, 'i'), `public JSON must not project ${field}`);
    }
    assert.match(lastFunctionBody(adminMigration, 'get_admin_mmi_assessment'), /'criterionId'[\s\S]*?'achieved'[\s\S]*?'weightPct'/i);
    assert.match(lastFunctionBody(adminMigration, 'get_admin_mmi_assessment'), /'estimatedCost'[\s\S]*?'latencyMs'[\s\S]*?'outcome'/i);
  });

  it('uses the final installed definitions for atomic scoring and margin-backed retention', () => {
    const installedSql = `${scoringMigration}\n${practiceMigration}\n${adminMigration}\n${finalHardeningMigration}`;
    const complete = lastFunctionBody(installedSql, 'complete_candidate_mmi_response_scoring');
    const usageInsert = complete.indexOf('INSERT INTO public.mmi_ai_usage_events');
    const scoreUpdate = complete.indexOf("scoring_status='scored',finalized_transcript=NULL,transcript_purged_at=clock_timestamp()");
    assert.ok(usageInsert >= 0, 'successful score must record metered usage');
    assert.ok(scoreUpdate > usageInsert, 'successful score must clear transcript in the same transaction after usage persistence');

    const purge = lastFunctionBody(installedSql, 'purge_expired_candidate_mmi_free_text');
    assert.match(purge, /p_now\s*-\s*interval '23 hours 30 minutes'/i);
    assert.doesNotMatch(purge, /lease_expires_at\s*>\s*p_now/i);
    assert.match(purge, /finalized_transcript=NULL,transcript_purged_at=p_now,scoring_status='feedback_unavailable'/i);
    assert.match(finalHardeningMigration, /'\*\/5 \* \* \* \*'/);
    assert.match(finalHardeningMigration, /CREATE TABLE public\.mmi_retention_job_health/i);
    assert.match(finalHardeningMigration, /REVOKE ALL ON TABLE public\.mmi_retention_job_health FROM PUBLIC, anon, authenticated, service_role/i);
  });

  it('keeps AI keys write-only and revokes direct browser-table access', () => {
    const config = lastFunctionBody(adminMigration, 'get_admin_ai_config');
    assert.match(config, /'isConfigured'/);
    const configProjection = config.slice(config.indexOf('RETURN jsonb_build_object'));
    assert.doesNotMatch(configProjection, /api[_ ]?key/i);
    assert.match(keyHandler, /apiKey/);
    assert.doesNotMatch(keyHandler, /return\s+[^;{}]*apiKey/i);

    for (const table of [
      'mmi_ai_usage_events',
      'mmi_admin_access_audit',
    ]) {
      const allSql = `${scoringMigration}\n${practiceMigration}\n${adminMigration}`;
      assert.match(allSql, new RegExp(`revoke\\s+all(?:\\s+privileges)?\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'));
    }
  });

  it('hardens security-definer entry points and commits an audit row before admin detail returns', () => {
    for (const [sql, names] of [
      [scoringMigration, ['complete_candidate_mmi_response_scoring', 'fail_candidate_mmi_response_scoring', 'purge_expired_candidate_mmi_free_text']],
      [practiceMigration, ['get_candidate_mmi_station_result', 'list_candidate_mmi_history']],
      [adminMigration, ['get_admin_ai_config', 'list_admin_mmi_assessments', 'get_admin_mmi_assessment']],
    ] as const) {
      for (const name of names) {
        assert.match(declaration(sql, name), /security\s+definer/i, `${name} must be security definer`);
        assert.match(declaration(sql, name), /set\s+search_path\s*=\s*(?:pg_catalog\s*,\s*)?public\s*,\s*pg_temp/i, `${name} must pin its search path`);
      }
    }

    const detail = lastFunctionBody(adminMigration, 'get_admin_mmi_assessment');
    const auditInsert = detail.indexOf('INSERT INTO public.mmi_admin_access_audit');
    const returnProjection = detail.indexOf('RETURN jsonb_build_object');
    assert.ok(auditInsert >= 0 && auditInsert < returnProjection, 'audit insertion must happen before detail is returned');
  });

  it('rate-limits paid claims and permits only all-null or fully metered scored usage', () => {
    const claim = lastFunctionBody(finalHardeningMigration, 'claim_candidate_mmi_response_scoring');
    assert.match(claim, /mmi_paid_scoring_claim_attempts/i);
    assert.match(claim, /claimed_at\s*<=\s*v_now\s*-\s*interval '1 hour'/i);
    assert.match(claim, /v_recent_claim_count\s*>=\s*3/i);
    assert.match(claim, /'status'\s*,\s*'rate_limited'/i);
    assert.match(claim, /'retryAfterSeconds'/i);
    assert.match(claim, /'retryAt'/i);

    const usageValidator = lastFunctionBody(finalHardeningMigration, 'is_valid_candidate_mmi_usage');
    assert.match(usageValidator, /p_scored[\s\S]*?inputTokens[\s\S]*?estimatedCost/i);
    assert.match(usageValidator, /jsonb_typeof\(p_usage->'inputTokens'\) = 'null'/i);
  });
});
