import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const policyMigration = join(
  process.cwd(),
  'supabase/migrations/20260805010000_ai_key_function_only_writes.sql',
);

describe('AI key write-only database policy', () => {
  it('leaves Edge Functions as the only path that can replace ai_api_key', async () => {
    const sql = await readFile(policyMigration, 'utf8');

    expect(sql).toContain('CREATE POLICY "app_config_insert_admin_non_secret"');
    expect(sql).toContain("WITH CHECK (public.is_admin() AND key != 'ai_api_key')");
    expect(sql).toContain('CREATE POLICY "app_config_update_admin_non_secret"');
    expect(sql).toContain("USING (public.is_admin() AND key != 'ai_api_key')");
    expect(sql).toContain('CREATE POLICY "app_config_delete_admin_non_secret"');
  });
});
