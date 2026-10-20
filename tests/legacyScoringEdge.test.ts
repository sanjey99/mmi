import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as providerModule from '../supabase/functions/_shared/aiProvider';
import * as profileModule from '../supabase/functions/_shared/aiModelProfile';
import * as legacyModule from '../supabase/functions/_shared/legacyScoring';
import * as httpModule from '../supabase/functions/_shared/http';
import * as ratesModule from '../supabase/functions/score-candidate-mmi-response/rates';

const edgeSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/score-answer/index.ts'),
  'utf8',
);
const storeSource = readFileSync(
  resolve(process.cwd(), 'src/stores/practiceStore.ts'),
  'utf8',
);
const sessionSource = readFileSync(
  resolve(process.cwd(), 'app/practice/session.tsx'),
  'utf8',
);

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = '11111111-1111-4111-8111-111111111111';
const questionId = '22222222-2222-4222-8222-222222222222';
const score = { structure: 3, ethics: 3, communication: 3, reflection: 3, nhs_awareness: 3,
  overall_pct: 60, ai_feedback: 'The response gives a clear and proportionate explanation.',
  improvement_tip: 'Explain how you would check the patient understands.' };

function legacyEntrypoint(profile: unknown = { is_admin: false }, profileError: unknown = null, signedIn = true) {
  const getUser = vi.fn(async () => ({ data: { user: signedIn ? { id: userId, user_metadata: { is_admin: true } } : null }, error: null }));
  const maybeSingle = vi.fn(async () => ({ data: profile, error: profileError }));
  const profileEquals = vi.fn(() => ({ maybeSingle }));
  const readConfig = vi.fn(async () => ({ data: [
    { key: 'ai_provider', value: 'anthropic' }, { key: 'ai_model', value: 'synthetic-model' },
    { key: 'ai_api_key', value: 'synthetic-provider-key' },
  ], error: null }));
  const from = vi.fn((table: string) => {
    if (table === 'profiles') return { select: () => ({ eq: profileEquals }) };
    if (table === 'app_config') return { select: () => ({ in: readConfig }) };
    throw new Error('Unexpected table');
  });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_legacy_scoring') return { data: { status: 'acquired',
      claim_id: '33333333-3333-4333-8333-333333333333', lease_token: args.p_lease_token,
      question_text: 'How would you respond to an upset patient?' }, error: null };
    if (name === 'complete_legacy_scoring') return { data: score, error: null };
    throw new Error('Unexpected RPC');
  });
  const callProvider = vi.fn(async (_config: providerModule.AiConfig, _request: providerModule.AiProviderRequest) => ({ content: JSON.stringify(score), usage: null }));
  const createClient = vi.fn((_url: string, key: string) => key === 'synthetic-anon-key'
    ? { auth: { getUser } } : { from, rpc });
  const environment: Record<string, string> = { APP_ALLOWED_ORIGINS: 'https://preview.example.test',
    SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_ANON_KEY: 'synthetic-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' };
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const modules: Record<string, unknown> = {
    'https://esm.sh/@supabase/supabase-js@2': { createClient },
    '../_shared/aiProvider.ts': { ...providerModule, callConfiguredProvider: callProvider },
    '../_shared/aiModelProfile.ts': profileModule,
    '../_shared/legacyScoring.ts': legacyModule,
    '../_shared/http.ts': httpModule,
    '../score-candidate-mmi-response/rates.ts': ratesModule,
  };
  // Execute the real Edge entrypoint with its remote SDK and paid provider
  // replaced. This exercises ordering without a network request or refactor.
  runInNewContext(ts.transpileModule(edgeSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    exports: {}, crypto: globalThis.crypto,
    Deno: { env: { get: (name: string) => environment[name] },
      serve: (callback: (request: Request) => Promise<Response>) => { handler = callback; } },
    require: (name: string) => { if (!(name in modules)) throw new Error('Unexpected import'); return modules[name]; },
    console: { error: vi.fn() },
  });
  if (!handler) throw new Error('Legacy entrypoint did not register');
  const invoke = (extra: Record<string, unknown> = {}) => handler!(new Request('https://functions.example.test/score-answer', {
    method: 'POST', headers: { Authorization: 'Bearer synthetic-user-token', Origin: 'https://preview.example.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, questionId, answerText: 'I would ask the patient what worries them and explain my reasoning.', ...extra }),
  }));
  return { invoke, from, profileEquals, readConfig, rpc, callProvider };
}

describe('legacy paid scoring administrator boundary', () => {
  it.each(['default', 'gpt-5.5'])('rejects ordinary accounts for %s before config, claims, or provider calls', async modelProfile => {
    const edge = legacyEntrypoint();
    const response = await edge.invoke({ modelProfile });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'legacy_scoring_forbidden' });
    expect(edge.from).toHaveBeenCalledExactlyOnceWith('profiles');
    expect(edge.profileEquals).toHaveBeenCalledExactlyOnceWith('id', userId);
    expect(edge.readConfig).not.toHaveBeenCalled();
    expect(edge.rpc).not.toHaveBeenCalled();
    expect(edge.callProvider).not.toHaveBeenCalled();
  });

  it.each([null, { is_admin: null }, { is_admin: 'true' }])('fails closed without an exact stored administrator flag', async profile => {
    const edge = legacyEntrypoint(profile);
    expect((await edge.invoke()).status).toBe(403);
    expect(edge.readConfig).not.toHaveBeenCalled();
    expect(edge.rpc).not.toHaveBeenCalled();
    expect(edge.callProvider).not.toHaveBeenCalled();
  });

  it('fails closed with a safe error if administrator verification fails', async () => {
    const edge = legacyEntrypoint({ is_admin: true }, { message: 'private database details' });
    const response = await edge.invoke();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'persistence_failed' });
    expect(edge.readConfig).not.toHaveBeenCalled();
    expect(edge.rpc).not.toHaveBeenCalled();
    expect(edge.callProvider).not.toHaveBeenCalled();
  });

  it('requires a verified authenticated account before querying administrator status', async () => {
    const edge = legacyEntrypoint({ is_admin: true }, null, false);
    expect((await edge.invoke()).status).toBe(401);
    expect(edge.from).not.toHaveBeenCalled();
    expect(edge.rpc).not.toHaveBeenCalled();
    expect(edge.callProvider).not.toHaveBeenCalled();
  });

  it('keeps the existing administrator claim, authoritative prompt, provider, and completion path', async () => {
    const edge = legacyEntrypoint({ is_admin: true });
    const response = await edge.invoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(score);
    expect(edge.readConfig).toHaveBeenCalledOnce();
    expect(edge.rpc.mock.calls.map(([name]) => name)).toEqual(['claim_legacy_scoring', 'complete_legacy_scoring']);
    expect(edge.rpc.mock.calls[0]?.[1]).toMatchObject({ p_user_id: userId, p_session_id: sessionId, p_question_id: questionId });
    expect(edge.callProvider).toHaveBeenCalledOnce();
    expect(edge.callProvider.mock.calls[0]?.[1]).toMatchObject({ userContent: expect.stringContaining('How would you respond to an upset patient?') });
  });
});

describe('server-owned legacy scoring edge contract', () => {
  it('accepts a bounded body without caller-supplied identity or question text', () => {
    expect(edgeSource).toContain('readBoundedJson');
    expect(edgeSource).toContain('sessionId');
    expect(edgeSource).toContain('questionId');
    expect(edgeSource).toContain('answerText');
    expect(edgeSource).not.toMatch(/body[^;]*questionText/s);
    expect(edgeSource).not.toMatch(/body[^;]*userId/s);
  });

  it('claims before the provider, uses the authoritative prompt, and completes or fails through RPCs', () => {
    const configuration = edgeSource.indexOf(".from('app_config')");
    const claim = edgeSource.indexOf("rpc('claim_legacy_scoring'");
    const provider = edgeSource.indexOf('await callConfiguredProvider');
    const complete = edgeSource.indexOf("rpc('complete_legacy_scoring'");

    expect(configuration).toBeGreaterThan(0);
    expect(claim).toBeGreaterThan(configuration);
    expect(provider).toBeGreaterThan(claim);
    expect(complete).toBeGreaterThan(provider);
    expect(edgeSource).toContain('claim.question_text');
    expect(edgeSource).toContain("rpc('fail_legacy_scoring'");
  });

  it('emits only the allowlisted provider-failure diagnostic while retaining public error classifications', () => {
    expect(edgeSource).toContain('ProviderRequestError');
    expect(edgeSource).toContain('providerFailureDiagnostic');
    expect(edgeSource).toContain("request.headers.get('x-request-id')");
    expect(edgeSource).toContain("'invalid_provider_response'");
    expect(edgeSource).toContain("'provider_failed'");
    expect(edgeSource).toMatch(/console\.error\(providerFailureDiagnostic\(/);
    expect(edgeSource).not.toMatch(/console\.error\([^)]*error/);
  });

  it('parses provider content while deliberately retaining no token usage in legacy scoring', () => {
    expect(edgeSource).toContain('parseLegacyScoreResponse(providerResult.content)');
    expect(edgeSource).not.toMatch(/providerResult\.usage/);
  });

  it('removes direct answer, score, session-finalisation, and streak writes from the client store', () => {
    expect(storeSource).not.toMatch(/from\('answers'\)[\s\S]{0,180}\.insert\(/);
    expect(storeSource).not.toMatch(/from\('scores'\)[\s\S]{0,180}\.insert\(/);
    expect(storeSource).not.toContain("rpc('update_streak'");
    expect(storeSource).not.toMatch(/from\('mock_sessions'\)[\s\S]{0,180}\.update\(\{ total_score_pct/);
  });

  it('retires the legacy session UI and redirects every visit to the single MMI practice entry', () => {
    expect(sessionSource).toContain("router.replace('/(tabs)/practice')");
    expect(sessionSource).toContain('Opening MMI practice');
    expect(sessionSource).not.toMatch(/LegacyScoringError|scoreAnswer|Submit answer|TextInput/);
  });
});
