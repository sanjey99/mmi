import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const snapshotPath = join(
  process.cwd(),
  'supabase/reconciliation/20260825_hosted_catalog_snapshot.sql',
);

describe('hosted catalog snapshot safety contract', () => {
  it('ships one metadata-only, deterministic drift snapshot', async () => {
    expect(existsSync(snapshotPath)).toBe(true);
    const sql = await readFile(snapshotPath, 'utf8');
    const executableSql = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    expect(executableSql).not.toMatch(
      /(?:^|\n)\s*(?:alter|call|create|delete|do|drop|grant|insert|revoke|truncate|update)\b/i,
    );
    expect(executableSql).not.toMatch(/\bfrom\s+(?:auth|public)\./i);
    for (const catalog of [
      'pg_catalog.pg_class',
      'information_schema.columns',
      'pg_catalog.pg_constraint',
      'pg_catalog.pg_policies',
      'information_schema.role_table_grants',
      'information_schema.column_privileges',
      'pg_catalog.pg_proc',
      'pg_catalog.pg_trigger',
      'pg_catalog.pg_extension',
    ]) expect(sql).toContain(catalog);
    expect(sql).toContain('md5(pg_get_functiondef(p.oid)) AS definition_md5');
    expect(sql).toContain("'migration_relation', to_regclass('supabase_migrations.schema_migrations')::text");
    expect(sql).toContain("'cron_relation', to_regclass('cron.job')::text");
    expect(sql).toMatch(/timezone\('utc', statement_timestamp\(\)\) AS captured_at_utc[\s\S]*md5\(value::text\)/i);
    const hashedObject = sql.slice(sql.indexOf('SELECT jsonb_build_object('), sql.indexOf(') AS value'));
    expect(hashedObject).not.toContain('captured_at_utc');
    expect(sql).not.toMatch(/SELECT\s+jobid,\s*schedule,\s*command\s*,/i);
    expect(sql).toMatch(/md5\(command\)\s+AS\s+command_md5/i);
    expect(sql).toMatch(/octet_length\(command\)\s+AS\s+command_bytes/i);
    expect(sql).toContain(
      'ORDER BY g.table_name, g.grantee, g.privilege_type, g.grantor, g.is_grantable',
    );
    expect(sql).toContain(
      'ORDER BY g.table_name, g.column_name, g.grantee, g.privilege_type, g.grantor, g.is_grantable',
    );
  });
});
