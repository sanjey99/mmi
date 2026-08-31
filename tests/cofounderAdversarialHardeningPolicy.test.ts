import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const reconciliationPath = join(
  process.cwd(),
  'supabase/reconciliation/20260825_cofounder_preview_security.sql',
);
const cutoverPath = join(
  process.cwd(),
  'supabase/migrations/20260825004000_cofounder_preview_privilege_cutover.sql',
);
const hostileFixturePath = join(
  process.cwd(),
  'supabase/tests/20260825_cofounder_preview_security_hostile_fixture.sql',
);
const hostileVerificationPath = join(
  process.cwd(),
  'supabase/tests/20260825_cofounder_preview_security_hostile_verify.sql',
);
const localRunnerPath = join(
  process.cwd(),
  'scripts/run-local-cofounder-adversarial-proof.sh',
);

const assessorTables = [
  'mmi_stations',
  'mmi_sub_questions',
  'roleplay_stations',
  'mmi_marking_criteria',
  'roleplay_end_criteria',
  'roleplay_mark_domains',
  'roleplay_response_rules',
];

describe('cofounder adversarial Supabase hardening contract', () => {
  it('provides a disposable-only hostile fixture and rejects unsafe runner targets before psql', async () => {
    const fixture = await readFile(hostileFixturePath, 'utf8');

    expect(fixture).toContain('LOCAL-ONLY');
    expect(fixture).toContain('SUPABASE_LOCAL_MUTATION_TESTS');
    const verification = await readFile(hostileVerificationPath, 'utf8');
    expect(verification).toContain('LOCAL-ONLY');
    expect(verification).toContain('auth.users');
    expect(verification).not.toContain('email_confirmed_at');
    expect(verification).not.toContain('confirmed_at');
    expect(verification).toContain('raw_app_meta_data');
    expect(verification).toContain('hostile ACL proof failed');
    expect(verification).toContain('expected eight column grants differ');
    const runner = await readFile(localRunnerPath, 'utf8');
    expect(runner).toContain('SUPABASE_LOCAL_MUTATION_TESTS');
    expect(runner).toContain('SUPABASE_LOCAL_DB_URL');
    expect(runner).toContain("new URL(process.argv[1])");
    expect(runner).toContain("['127.0.0.1', 'localhost', '[::1]']");
    expect(runner).toContain(' -q -v ON_ERROR_STOP=1');
    expect(runner).toContain('captured preflight and');
    expect(runner).not.toContain('postgresql://*127.0.0.1*');
    expect(runner).toContain('Expected 040 to fail closed');
    expect(runner).toContain('Cutover rollback proof failed');
    expect(runner).toContain("is_admin[[:space:]]*\\(");
    expect(runner).toContain("auth.users WHERE id <> ''00000000-0000-0000-0000-000000000403''");
    expect(runner).toContain('pre-040 catalog preparation');
    expect(runner).toContain("version = '20260825004000'");
    for (const table of assessorTables) expect(runner).toContain(`('${table}')`);
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(fixture).toMatch(new RegExp(`GRANT ALL PRIVILEGES ON TABLE public\\.mmi_stations TO ${role}`, 'i'));
      expect(fixture).toMatch(new RegExp(`GRANT SELECT \\(id\\) ON TABLE public\\.mmi_stations TO ${role}`, 'i'));
    }
    expect(fixture).toContain("CASE WHEN v_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(v_role) END");
    expect(fixture).not.toContain("TO %I', v_table, v_role");
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'mmi-proof-runner-'));
    const psqlPath = join(temporaryDirectory, 'psql');
    const psqlLogPath = join(temporaryDirectory, 'psql-invoked');

    try {
      await writeFile(psqlPath, '#!/usr/bin/env sh\nprintf invoked > "$TEST_PSQL_LOG"\nexit 99\n');
      await chmod(psqlPath, 0o700);
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const child = spawn('bash', [localRunnerPath], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PATH: `${temporaryDirectory}:${process.env.PATH}`,
            SUPABASE_LOCAL_MUTATION_TESTS: 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA',
            SUPABASE_LOCAL_DB_URL: 'postgresql://127.0.0.1/mmi_runner_proof?host=%2Fdefinitely-not-a-postgres-socket',
            TEST_PSQL_LOG: psqlLogPath,
          },
        });
        child.once('error', reject);
        child.once('close', resolve);
      });

      expect(exitCode).toBe(64);
      await expect(readFile(psqlLogPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    expect(runner).toContain("value.search !== ''");
    expect(runner).toContain("value.hash !== ''");
    expect(runner).toContain('canonical_database_url');
    expect(runner).toContain('psql_args=("$canonical_database_url" -X');
    expect(runner).toContain('current_database()');
    expect(runner).toContain('inet_server_addr()');
    expect(runner).toContain('pg_db_role_setting');
    expect(runner).toContain('app.mmi_adversarial_disposable');
    expect(runner).toContain('I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA');
    expect(runner).toContain("current_database() = '$database_name'");
    expect(runner).toContain("database.datname = '$database_name'");
    expect(runner).not.toContain('-v expected_database=');
    expect(runner.indexOf('^mmi_[a-z0-9_]*proof[a-z0-9_]*$')).toBeLessThan(
      runner.indexOf("current_database() = '$database_name'"),
    );
  });

  it('removes inherited and direct table and column ACLs from every runtime role', async () => {
    const sql = await readFile(reconciliationPath, 'utf8');

    expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role');
    for (const table of assessorTables) expect(sql).toContain(`'${table}'`);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(sql).toContain(`FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']`);
      expect(sql).toContain(`has_table_privilege(v_role, 'public.' || v_table, 'SELECT')`);
      expect(sql).toContain(`has_any_column_privilege(v_role, 'public.' || v_table, 'SELECT')`);
    }
  });

  it('pins SECURITY DEFINER helpers and keeps only is_admin callable during reconciliation', async () => {
    const sql = await readFile(reconciliationPath, 'utf8');

    for (const signature of [
      'public.handle_new_user()',
      'public.update_streak(uuid)',
      'public.is_admin()',
    ]) {
      expect(sql).toContain(`ALTER FUNCTION ${signature} SET search_path = pg_catalog, public`);
      expect(sql).toContain(`'${signature}'`);
    }
    expect(sql).toContain('to_regprocedure(v_helper.signature)');
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.handle_new_user\(\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.update_streak\(UUID\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_admin\(\) TO authenticated/i);
    expect(sql).toMatch(/reconciliation helper security postcondition failed/i);
  });

  it('makes helper functions non-callable after cutover and fails closed on residual service grants', async () => {
    const sql = await readFile(cutoverPath, 'utf8');

    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.update_streak\(UUID\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.update_streak\(UUID\) TO service_role/i);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.is_admin\(\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toMatch(/cutover helper execution postcondition failed/i);
    expect(sql).toMatch(/ALTER POLICY "questions_write_admin"/i);
    const cutoverVerifier = await readFile(join(
      process.cwd(),
      'supabase/tests/20260825_cofounder_preview_security_cutover_verify.sql',
    ), 'utf8');
    expect(cutoverVerifier).toContain("is_admin[[:space:]]*\\(");
    expect(cutoverVerifier).toContain("position('p.is_admin'");
    expect(sql).toMatch(/assessor table service-role ACL prerequisite failed/i);
    expect(sql).toContain("FOREACH v_privilege IN ARRAY ARRAY[");
    expect(sql).toContain("has_table_privilege('service_role', 'public.' || v_table, v_privilege)");
  });
});
