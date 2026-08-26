import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const policyMigration = join(
  process.cwd(),
  'supabase/migrations/20260805010000_ai_key_function_only_writes.sql',
);
const edgeFunction = join(
  process.cwd(),
  'supabase/functions/manage-ai-key/index.ts',
);
const edgeHandler = join(
  process.cwd(),
  'supabase/functions/manage-ai-key/handler.ts',
);
const scoreAnswerFunction = join(
  process.cwd(),
  'supabase/functions/score-answer/index.ts',
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

  it('uses the shared exact-origin and bounded-JSON Edge boundary', async () => {
    const source = `${await readFile(edgeFunction, 'utf8')}\n${await readFile(edgeHandler, 'utf8')}`;

    expect(source).toContain('prepareEdgeHttpRequest');
    expect(source).toContain('readBoundedJson');
    expect(source).toContain('EdgeRequestError');
    expect(source).toContain("Deno.env.get('APP_ALLOWED_ORIGINS')");
    expect(source).not.toContain("'Access-Control-Allow-Origin': '*'");
    expect(source).not.toMatch(/await\s+req\.json\s*\(/);
  });

  it('loads ai_api_key only in the server-side scoring configuration query', async () => {
    const source = await readFile(scoreAnswerFunction, 'utf8');
    const keyReferences = [...source.matchAll(/ai_api_key/g)].map((match) => match.index ?? -1);
    const serviceClientReference = source.indexOf('const serviceClient = createClient');

    expect(keyReferences).toHaveLength(3);
    expect(keyReferences.every((index) => index > serviceClientReference)).toBe(true);
    expect(source).toMatch(/\.in\('key', \['ai_provider', 'ai_model', 'ai_base_url', 'ai_api_key'\]\)/);
  });
});
