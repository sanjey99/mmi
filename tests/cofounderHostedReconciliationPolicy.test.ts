import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/reconciliation/20260825_cofounder_preview_security.sql',
);

describe('cofounder preview hosted reconciliation policy', () => {
  it('runs before preview objects and fails closed unless hosted security tables exist', async () => {
    const sql = (await readFile(migrationPath, 'utf8')).toLowerCase();
    const requiredTables = [
      'app_config',
      'profiles',
      'mmi_stations',
      'mmi_sub_questions',
      'roleplay_stations',
      'mmi_marking_criteria',
      'roleplay_end_criteria',
      'roleplay_mark_domains',
      'roleplay_response_rules',
    ];

    expect(sql).toContain('begin;');
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '30s'");
    expect(sql).toContain('to_regclass');
    for (const table of requiredTables) expect(sql).toContain(`'${table}'`);
    for (const previewTable of ['legacy_scoring_claims', 'legacy_scoring_attempts', 'cofounder_feedback']) {
      expect(sql).not.toContain(`'${previewTable}'`);
    }
    expect(sql).toContain('raise exception');
    expect(sql).toContain('hosted-only');
    expect(sql).toContain('do not run supabase db push');
  });

  it('requires the exact observed AI-config policy set and validates postconditions', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    for (const policy of [
      'app_config_read_non_secret',
      'app_config_insert_admin',
      'app_config_update_admin',
      'app_config_delete_admin',
    ]) expect(sql).toContain(policy);
    expect(sql).toMatch(/v_policy_count\s*<>\s*4/i);
    expect(sql).toMatch(/policyname\s+not\s+in/i);
    expect(sql.match(/ALTER POLICY/g)).toHaveLength(4);
    expect(sql).toMatch(/key\s*(?:<>|!=)\s*'ai_api_key'/);
    expect(sql).toMatch(/policy reconciliation postcondition failed/i);
    expect(sql).toMatch(/ALTER TABLE public\.app_config ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.app_config FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.app_config TO authenticated/i);
    expect(sql).toContain('has_any_column_privilege');
    expect(sql).toMatch(/has_table_privilege\('anon', 'public\.app_config', 'REFERENCES'\)/i);
    expect(sql).toMatch(/has_table_privilege\('anon', 'public\.app_config', 'TRIGGER'\)/i);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.is_admin\(\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_admin\(\) TO authenticated/i);
    const appConfigPolicySection = sql.slice(sql.indexOf('ALTER TABLE public.app_config'), sql.indexOf('-- Remove table-level'));
    expect(appConfigPolicySection).not.toMatch(/public\.is_admin\(\)/i);
    expect(sql).not.toMatch(/\bcreate\s+policy\b/i);
    expect(sql).not.toMatch(/\bdrop\s+(?:policy|table|function|trigger|schema|type|extension)\b/i);
  });

  it('establishes the least-privilege Edge ACL before functions are deployed', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.profiles FROM service_role/i);
    expect(sql).toMatch(/GRANT SELECT \(id, is_admin\) ON TABLE public\.profiles TO service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.app_config FROM service_role/i);
    expect(sql).toMatch(/GRANT SELECT \(key, value\), INSERT \(key, value\), UPDATE \(key, value\)\s+ON TABLE public\.app_config TO service_role/i);
    expect(sql).toMatch(/service-role Edge ACL postcondition failed/i);
    expect(sql).toMatch(/has_column_privilege\('service_role', 'public\.profiles', 'id', 'SELECT'\)/i);
    expect(sql).toMatch(/has_column_privilege\('service_role', 'public\.app_config', 'key', 'INSERT'\)/i);
    expect(sql).toContain("column_name NOT IN ('id', 'is_admin')");
    expect(sql).toContain("column_name NOT IN ('key', 'value')");
    expect(sql).not.toMatch(/GRANT ALL(?: PRIVILEGES)? ON TABLE public\.(?:profiles|app_config) TO service_role/i);
    expect(sql).not.toMatch(/GRANT (?:DELETE|TRUNCATE|REFERENCES|TRIGGER).*public\.app_config TO service_role/i);
    expect(sql.lastIndexOf('service-role Edge ACL postcondition failed')).toBeGreaterThan(
      sql.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_config TO authenticated'),
    );
  });

  it('cannot be applied by the automatic migration chain', async () => {
    const migrationDirectory = join(process.cwd(), 'supabase/migrations');
    const migrationNames = await import('node:fs/promises').then(({ readdir }) => readdir(migrationDirectory));
    expect(migrationNames.some((name) => name.includes('security_reconciliation'))).toBe(false);
  });

  it('revokes direct browser access to every assessor-bearing table without row DML', async () => {
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
      expect(sql).toMatch(new RegExp(
        `revoke\\s+all(?:\\s+privileges)?\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+public,\\s*anon,\\s*authenticated`,
        'i',
      ));
    }
    expect(sql).toContain('has_table_privilege');
    expect(sql).toContain('has_any_column_privilege');
    expect(sql).toMatch(/assessor table ACL postcondition failed/i);
    expect(sql).not.toMatch(
      /(?:^|\n)\s*(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+(?:table\s+)?public\.)/i,
    );
    expect(sql).not.toMatch(/\b(?:cron\.|migration repair|supabase_migrations)\b/i);
  });
});
