import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260825001000_cofounder_preview_question_api.sql'),
  'utf8',
);
const questionService = readFileSync(
  resolve(process.cwd(), 'src/lib/questions.ts'),
  'utf8',
);

describe('legacy question API SQL policy', () => {
  it('stages named RPCs without prematurely cutting over direct browser table access', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain("SET LOCAL lock_timeout = '5s'");
    expect(migration).toContain("SET LOCAL statement_timeout = '30s'");
    expect(migration).toContain("to_regprocedure('public.list_legacy_questions(public.question_category,public.question_difficulty,text,integer)')");
    expect(migration).toContain("to_regprocedure('public.get_legacy_question(uuid)')");
    expect(migration).toContain("to_regprocedure('public.get_legacy_question_counts()')");
    expect(migration).toContain("to_regprocedure('public.create_legacy_questions(jsonb)')");
    expect(migration).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
    expect(migration).not.toMatch(/REVOKE ALL ON TABLE public\.questions FROM/i);
    expect(migration).toMatch(/FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.list_legacy_questions/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_legacy_question\(uuid\)/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_legacy_question_counts\(\)/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_legacy_questions\(jsonb\)/i);
    expect(questionService).not.toMatch(/\.from\(['"]questions['"]\)/);
  });

  it('keeps every callable function hardened and student reads active-only', () => {
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(4);
    expect(migration.match(/SET search_path = pg_catalog, public/g)).toHaveLength(4);
    expect(migration).toMatch(/WHERE q\.is_active IS TRUE/g);
    const studentFunctionPrefix = migration.split(
      'CREATE FUNCTION public.create_legacy_questions',
    )[0];
    expect(studentFunctionPrefix).not.toMatch(/guidance_notes/i);
  });

  it('checks authentication and profile admin status inside the create transaction', () => {
    expect(migration).toMatch(/v_user_id uuid := auth\.uid\(\)/i);
    expect(migration).toMatch(/p\.id = v_user_id[\s\S]*p\.is_admin IS TRUE/i);
    expect(migration).toMatch(/jsonb_array_length\(p_rows\) BETWEEN 1 AND 500/i);
    expect(migration).toMatch(/jsonb_typeof\(v_row->'is_active'\) <> 'boolean'/i);
    expect(migration).toMatch(/jsonb_typeof\(v_row->'is_mmi_suitable'\) <> 'boolean'/i);
    expect(migration).toMatch(/p_rows IS NULL[\s\S]*jsonb_typeof\(p_rows\) <> 'array'/i);
  });
});
