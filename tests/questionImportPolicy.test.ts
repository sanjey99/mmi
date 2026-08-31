import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260825005000_cofounder_question_import_idempotency.sql',
);

describe('retry-safe workbook question import policy', () => {
  it('adds a nullable durable source identity without changing manual/seed question rows', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('ADD COLUMN source_namespace text');
    expect(sql).toContain('ADD COLUMN source_id text');
    expect(sql).toContain('questions_source_identity_valid');
    expect(sql).toContain('questions_source_identity_unique');
    expect(sql).toMatch(/WHERE source_namespace IS NOT NULL AND source_id IS NOT NULL/i);
    expect(sql).toMatch(/source_namespace = lower\(btrim\(source_namespace\)\)/i);
    expect(sql).toMatch(/source_id = btrim\(source_id\)/i);
  });

  it('records batch identity privately and exposes writes only through one hardened admin RPC', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const normalized = sql.replace(/\s+/g, ' ');

    expect(sql).toContain('CREATE TABLE public.question_import_batches');
    expect(sql).toContain('applied_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL');
    expect(sql).toContain('ALTER TABLE public.question_import_batches ENABLE ROW LEVEL SECURITY');
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.question_import_batches FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toContain('CREATE FUNCTION public.import_legacy_question_batch(');
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toContain('SET search_path = pg_catalog, public, pg_temp');
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.import_legacy_question_batch\([\s\S]*FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.import_legacy_question_batch/i);
    expect(normalized).toContain("WHERE p.id = v_user_id AND p.is_admin IS TRUE");
    expect(sql).toMatch(/v_payload_fingerprint := pg_catalog\.encode\(\s*pg_catalog\.sha256\(pg_catalog\.convert_to\(p_rows::text, 'UTF8'\)\),\s*'hex'\s*\)/);
    expect(sql).toContain("payload_fingerprint ~ '^[a-f0-9]{64}$'");
    expect(sql).not.toMatch(/\bmd5\s*\(/i);
    expect(sql).toContain("pg_get_userbyid(p.proowner)");
    expect(sql).toContain("p.prosecdef");
    expect(sql).toContain("p.proconfig");
    expect(sql).toContain("import RPC security-definer postcondition failed");
    expect(sql).toContain("has_function_privilege('public', 'public.import_legacy_question_batch(text,text,text,jsonb)', 'EXECUTE')");
    expect(sql).toContain("has_function_privilege('authenticated', 'public.import_legacy_question_batch(text,text,text,jsonb)', 'EXECUTE')");
    expect(sql).toContain('REVOKE ALL ON TABLE public.question_import_batches FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).toContain("has_table_privilege(v_role, 'public.question_import_batches', 'MAINTAIN')");
    expect(sql).not.toContain("has_table_privilege('PUBLIC', 'public.question_import_batches'");
    expect(sql).toContain("aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner)))");
    expect(sql).toContain('acl.grantee = 0');
    expect(sql).not.toMatch(/FOREACH v_role IN ARRAY ARRAY\['anon', 'authenticated', 'service_role'\][\s\S]{0,700}has_function_privilege\(v_role, 'public\.import_legacy_question_batch/i);
  });

  it('fails closed for altered retries but makes exact retries safe, without overwriting history counters', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toMatch(/ON CONFLICT \(source_namespace, source_manifest_sha256, batch_id\) DO NOTHING/i);
    expect(sql).toMatch(/import batch identity was already used with a different payload/i);
    expect(sql).toMatch(/outcome := 'retried'/i);
    expect(sql).toMatch(/ON CONFLICT \(source_namespace, source_id\)[\s\S]*DO UPDATE/i);
    expect(sql).toMatch(/text = EXCLUDED\.text/i);
    expect(sql).not.toMatch(/times_attempted\s*=/i);
    expect(sql).not.toMatch(/avg_score\s*=/i);
    expect(sql).not.toMatch(/is_active\s*=\s*EXCLUDED\.is_active/i);
  });
});
