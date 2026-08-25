import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260825004000_cofounder_preview_privilege_cutover.sql',
);

describe('cofounder preview privilege cutover policy', () => {
  it('repairs every legacy ownership policy before restoring browser grants', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const normalizedSql = sql.replace(/\s+/g, ' ');
    const exactPolicyFragments = [
      'ALTER POLICY "answers_own" ON public.answers TO PUBLIC USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
      'ALTER POLICY "scores_insert_own" ON public.scores TO PUBLIC WITH CHECK ( EXISTS ( SELECT 1 FROM public.answers AS owned_answer WHERE owned_answer.id = scores.answer_id AND owned_answer.user_id = auth.uid() ) )',
      'ALTER POLICY "scores_select_own" ON public.scores TO PUBLIC USING ( EXISTS ( SELECT 1 FROM public.answers AS owned_answer WHERE owned_answer.id = scores.answer_id AND owned_answer.user_id = auth.uid() ) )',
      'ALTER POLICY "sessions_own" ON public.mock_sessions TO PUBLIC USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
      'ALTER POLICY "profiles_read_own" ON public.profiles TO authenticated USING (auth.uid() = id)',
      'ALTER POLICY "profiles_select_own" ON public.profiles TO PUBLIC USING (auth.uid() = id)',
      'ALTER POLICY "profiles_update_own" ON public.profiles TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id)',
    ];

    for (const policyFragment of exactPolicyFragments) {
      expect(normalizedSql).toContain(policyFragment);
    }

    const finalPolicyRepair = normalizedSql.indexOf(exactPolicyFragments.at(-1)!);
    const firstBrowserGrant = normalizedSql.indexOf('GRANT SELECT ON TABLE public.answers TO authenticated');
    expect(finalPolicyRepair).toBeGreaterThanOrEqual(0);
    expect(firstBrowserGrant).toBeGreaterThan(finalPolicyRepair);
    expect(sql).not.toMatch(/position\s*\(/i);
  });

  it('makes legacy browser privilege changes only in the final cutover transaction', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('BEGIN;');
    expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(sql).toContain("SET LOCAL statement_timeout = '30s'");
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.questions FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.answers FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.scores FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.mock_sessions FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.profiles FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.answers TO authenticated/i);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.scores TO authenticated/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON TABLE public\.mock_sessions TO authenticated/i);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.profiles TO authenticated/i);
    expect(sql).toMatch(/GRANT UPDATE\s*\(\s*full_name,\s*avatar_url,\s*university_target,\s*entry_year,\s*daily_goal,\s*onboarding_complete,\s*updated_at\s*\)\s*ON TABLE public\.profiles TO authenticated/i);
  });

  it('removes default streak execution before granting service-role-only execution', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const revoke = sql.search(/REVOKE EXECUTE ON FUNCTION public\.update_streak\(UUID\)\s+FROM PUBLIC, anon, authenticated, service_role/);
    const grant = sql.indexOf('GRANT EXECUTE ON FUNCTION public.update_streak(UUID) TO service_role');

    expect(revoke).toBeGreaterThanOrEqual(0);
    expect(grant).toBeGreaterThan(revoke);
  });

  it('fails closed and contains no row DML or destructive object deletion', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('to_regclass');
    expect(sql).toContain("'questions'");
    expect(sql).toContain("to_regprocedure('public.update_streak(uuid)')");
    for (const signature of [
      'public.claim_legacy_scoring(uuid,uuid,uuid,text,text,uuid)',
      'public.complete_legacy_scoring(uuid,uuid,uuid,text,text,smallint,smallint,smallint,smallint,smallint,text,text)',
      'public.fail_legacy_scoring(uuid,uuid,uuid,text)',
      'public.list_legacy_questions(public.question_category,public.question_difficulty,text,integer)',
      'public.get_legacy_question(uuid)',
      'public.get_legacy_question_counts()',
      'public.create_legacy_questions(jsonb)',
      'public.submit_cofounder_feedback(text,text,text,text,text,boolean)',
      'public.list_cofounder_feedback(integer)',
    ]) expect(sql).toContain(`to_regprocedure('${signature}')`);
    expect(sql).toContain('relrowsecurity');
    expect(sql).toContain('pg_policies');
    for (const policy of [
      'answers_own',
      'scores_insert_own',
      'scores_select_own',
      'sessions_own',
      'profiles_read_own',
      'profiles_select_own',
      'profiles_update_own',
    ]) expect(sql).toContain(policy);
    expect(sql).toMatch(/v_policy_count\s*<>\s*7/i);
    expect(sql).toMatch(/hosted RLS policy prerequisite failed/i);
    expect(sql).toContain('has_function_privilege');
    expect(sql).toContain('has_table_privilege');
    expect(sql).toContain('has_any_column_privilege');
    expect(sql).toContain('has_column_privilege');
    expect(sql).toContain('prosecdef');
    expect(sql).toContain('proconfig');
    expect(sql).toContain('pg_get_userbyid');
    expect(sql).toMatch(/preview RPC identity prerequisite failed/i);
    expect(sql).toMatch(/service-only preview table ACL prerequisite failed/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+(?:table\s+)?public\.)/i);
    expect(sql).not.toMatch(/\bdrop\s+(?:policy|table|function|trigger|schema|type|extension)\b/i);
  });
});
