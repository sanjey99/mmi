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
    const legacyPolicyRepairs = sql.slice(
      sql.indexOf('-- Repair the exact ownership semantics'),
      sql.indexOf('-- Remove both table-level'),
    );
    expect(legacyPolicyRepairs).not.toMatch(/position\s*\(/i);
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

  it('restores the hardened non-secret app-config browser surface on a fresh chain', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.app_config FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.app_config TO authenticated/i);
    expect(sql).toMatch(/app_config browser ACL postcondition failed/i);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(sql).toContain(`has_table_privilege('authenticated', 'public.app_config', '${privilege}')`);
    }
    for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(sql).toContain(`has_table_privilege('anon', 'public.app_config', '${privilege}')`);
    }
    expect(sql.lastIndexOf('service-role Edge ACL postcondition failed')).toBeGreaterThan(
      sql.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_config TO authenticated'),
    );
  });

  it('normalizes one recognized app-config policy generation before restoring browser grants', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const normalizedSql = sql.replace(/\s+/g, ' ');

    for (const policy of [
      'app_config_read_non_secret',
      'app_config_insert_admin',
      'app_config_update_admin',
      'app_config_delete_admin',
      'app_config_insert_admin_non_secret',
      'app_config_update_admin_non_secret',
      'app_config_delete_admin_non_secret',
    ]) expect(sql).toContain(policy);
    expect(sql).toMatch(/ALTER POLICY app_config_insert_admin ON public\.app_config RENAME TO app_config_insert_admin_non_secret/i);
    expect(normalizedSql).toContain("ALTER POLICY app_config_read_non_secret ON public.app_config TO authenticated USING (auth.role() = 'authenticated' AND key <> 'ai_api_key')");
    expect(normalizedSql).toContain("ALTER POLICY app_config_insert_admin_non_secret ON public.app_config TO authenticated WITH CHECK ( key <> 'ai_api_key' AND EXISTS ( SELECT 1 FROM public.profiles AS p WHERE p.id = auth.uid() AND p.is_admin IS TRUE ) )");
    expect(sql).toMatch(/app_config policy cutover postcondition failed/i);
    expect(sql.match(/permissive\s*<>\s*'PERMISSIVE'/g)).toHaveLength(2);
    const policyRepair = sql.lastIndexOf('ALTER POLICY app_config_delete_admin_non_secret');
    const browserGrant = sql.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_config TO authenticated');
    expect(policyRepair).toBeGreaterThanOrEqual(0);
    expect(browserGrant).toBeGreaterThan(policyRepair);
  });

  it('removes every runtime grant from the unused legacy streak helper', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const revoke = sql.search(/REVOKE EXECUTE ON FUNCTION public\.update_streak\(UUID\)\s+FROM PUBLIC, anon, authenticated, service_role/);

    expect(revoke).toBeGreaterThanOrEqual(0);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.update_streak\(UUID\) TO service_role/i);
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      expect(sql).toContain(
        `has_function_privilege('${role}', 'public.update_streak(uuid)', 'EXECUTE')`,
      );
    }
  });

  it('hardens every legacy security-definer helper and keeps trigger/admin helpers non-callable', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const normalizedSql = sql.replace(/\s+/g, ' ');

    for (const signature of ['handle_new_user()', 'is_admin()', 'update_streak(UUID)']) {
      expect(normalizedSql).toContain(
        `ALTER FUNCTION public.${signature} SET search_path = pg_catalog, public, pg_temp`,
      );
    }
    for (const signature of ['handle_new_user()', 'is_admin()']) {
      expect(normalizedSql).toContain(
        `REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role`,
      );
      for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
        expect(normalizedSql).toContain(
          `has_function_privilege('${role}', 'public.${signature.toLowerCase()}', 'EXECUTE')`,
        );
      }
    }
  });

  it('requires feedback storage to remain RPC-only for every runtime role', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toMatch(/FOREACH v_role IN ARRAY ARRAY\['anon', 'authenticated', 'service_role'\]/i);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(sql).toContain(`has_table_privilege(v_role, 'public.cofounder_feedback', '${privilege}')`);
    }
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
      expect(sql).toContain(`has_any_column_privilege(v_role, 'public.cofounder_feedback', '${privilege}')`);
    }
    expect(sql).toMatch(/feedback table must remain RPC-only/i);
  });

  it('fails closed unless the reconciliation already removed service-role assessor grants', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const assessorTables = [
      'mmi_stations',
      'mmi_sub_questions',
      'roleplay_stations',
      'mmi_marking_criteria',
      'roleplay_end_criteria',
      'roleplay_mark_domains',
      'roleplay_response_rules',
    ];

    for (const table of assessorTables) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toMatch(/assessor table service-role ACL prerequisite failed/i);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(sql).toContain(`has_table_privilege('service_role', 'public.' || v_table, '${privilege}')`);
    }
    expect(sql).toContain("has_any_column_privilege('service_role', 'public.' || v_table, 'UPDATE')");
  });

  it('grants Edge Functions only the columns needed for admin checks and AI configuration', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.profiles FROM service_role/i);
    expect(sql).toMatch(/GRANT SELECT \(id, is_admin\) ON TABLE public\.profiles TO service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.app_config FROM service_role/i);
    expect(sql).toMatch(/GRANT SELECT \(key, value\), INSERT \(key, value\), UPDATE \(key, value\)\s+ON TABLE public\.app_config TO service_role/i);
    expect(sql).toMatch(/service-role Edge ACL postcondition failed/i);
    expect(sql).toMatch(/has_column_privilege\('service_role', 'public\.profiles', 'is_admin', 'SELECT'\)/i);
    expect(sql).toMatch(/has_column_privilege\('service_role', 'public\.app_config', 'value', 'UPDATE'\)/i);
    expect(sql).toContain("column_name NOT IN ('id', 'is_admin')");
    expect(sql).toContain("column_name NOT IN ('key', 'value')");
    expect(sql).not.toMatch(/GRANT ALL(?: PRIVILEGES)? ON TABLE public\.(?:profiles|app_config) TO service_role/i);
    expect(sql).not.toMatch(/GRANT (?:DELETE|TRUNCATE|REFERENCES|TRIGGER).*public\.app_config TO service_role/i);
    expect(sql.lastIndexOf('service-role Edge ACL postcondition failed')).toBeGreaterThan(
      sql.indexOf('GRANT UPDATE (\n  full_name,'),
    );
  });

  it('keeps legacy persistence behind RPCs for the service role', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const normalizedSql = sql.replace(/\s+/g, ' ');

    expect(normalizedSql).toContain(
      "FOREACH v_table IN ARRAY ARRAY['questions', 'answers', 'scores', 'mock_sessions', 'profiles', 'app_config']",
    );
    for (const table of ['questions', 'answers', 'scores', 'mock_sessions']) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM service_role`, 'i'));
    }
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(sql).toContain(`has_table_privilege('service_role', 'public.' || v_table, '${privilege}')`);
    }
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
      expect(sql).toContain(`has_any_column_privilege('service_role', 'public.' || v_table, '${privilege}')`);
    }
    expect(sql).toMatch(/service-role legacy table ACL postcondition failed/i);
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
