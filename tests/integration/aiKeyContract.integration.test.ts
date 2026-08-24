import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const testAiKey = process.env.SUPABASE_TEST_AI_KEY;
const enabled = Boolean(url && anonKey && serviceRoleKey);

type TestUser = { id: string; client: SupabaseClient; accessToken: string };

const run = describe.runIf(enabled);
const suffix = randomUUID().slice(0, 8);
const password = `Test-${randomUUID()}-Aa1!`;
let service: SupabaseClient;
let student: TestUser;
let admin: TestUser;

async function createUser(isAdmin: boolean): Promise<TestUser> {
  const email = `integration-${isAdmin ? 'admin' : 'student'}-${suffix}@example.test`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('Unable to create test user');

  const { error: profileError } = await service.from('profiles').upsert({
    id: data.user.id,
    full_name: 'Integration Test',
    is_admin: isAdmin,
  });
  if (profileError) throw profileError;

  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) throw signInError ?? new Error('Unable to sign in test user');
  return { id: data.user.id, client, accessToken: signIn.session.access_token };
}

async function invoke(token: string, functionName: string, body: unknown) {
  return fetch(`${url}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: { apikey: anonKey!, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

run('AI key contract (isolated Supabase project only)', () => {
  beforeAll(async () => {
    service = createClient(url!, serviceRoleKey!, { auth: { persistSession: false } });
    student = await createUser(false);
    admin = await createUser(true);
  });

  afterAll(async () => {
    await Promise.all([student, admin].filter(Boolean).map(({ id }) => service.auth.admin.deleteUser(id)));
  });

  it('prevents a non-admin from reading or replacing the AI key', async () => {
    const read = await student.client.from('app_config').select('key, value').eq('key', 'ai_api_key');
    expect(read.data).toEqual([]);

    const write = await student.client.from('app_config').upsert({ key: 'ai_api_key', value: 'blocked' });
    expect(write.error).not.toBeNull();

    const response = await invoke(student.accessToken, 'manage-ai-key', { apiKey: 'blocked' });
    expect(response.status).toBe(403);
  });

  it('allows an admin to replace the key through the function but never read it', async () => {
    const directRead = await admin.client.from('app_config').select('key, value').eq('key', 'ai_api_key');
    expect(directRead.data).toEqual([]);

    const directWrite = await admin.client.from('app_config').upsert({ key: 'ai_api_key', value: 'blocked' });
    expect(directWrite.error).not.toBeNull();

    const response = await invoke(admin.accessToken, 'manage-ai-key', { apiKey: testAiKey ?? 'integration-only-key' });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(testAiKey ?? 'integration-only-key');
  });

  it.runIf(Boolean(testAiKey))('scores an answer after an admin key replacement', async () => {
    const response = await invoke(student.accessToken, 'score-answer', {
      questionText: 'Why do you want to study medicine?',
      answerText: 'I want to study medicine because I value compassionate, evidence-based care and lifelong learning.',
    });
    expect(response.status).toBe(200);
    expect((await response.json()).overall_pct).toEqual(expect.any(Number));
  });
});
