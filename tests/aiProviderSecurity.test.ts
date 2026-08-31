import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_PROVIDER_TIMEOUT_MS,
  MAX_AI_FEEDBACK_LENGTH,
  MAX_IMPROVEMENT_TIP_LENGTH,
  MMI_SCORING_CLAIM_LEASE_MS,
  callConfiguredProvider,
  formatScoringUserContent,
  parseLegacyScoreResponse,
  ProviderRequestError,
  providerFailureDiagnostic,
} from '../supabase/functions/_shared/aiProvider';
import { assertSafeProviderUrl } from '../supabase/functions/_shared/providerUrl';

const publicRecords = async () => ['104.18.12.123'];
const allowedHosts = new Set(['api.anthropic.com', 'api.openai.com', 'provider.example.test']);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assertSafeProviderUrl', () => {
  it.each([
    'http://localhost',
    'https://127.0.0.1',
    'https://10.0.0.8',
    'https://172.16.0.1',
    'https://192.168.1.8',
    'https://169.254.169.254',
    'https://[::1]',
    'https://[fc00::1]',
    'https://[fe80::1]',
    'https://[::ffff:7f00:1]',
    'https://[fec0::1]',
    'https://192.0.2.1',
    'https://198.51.100.1',
    'https://203.0.113.1',
    'http://provider.example.test',
    'https://user:pass@provider.example.test',
    'https://provider.example.test/v1?endpoint=override',
    'https://provider.example.test/v1#fragment',
  ])('rejects literal non-public address %s', async (url) => {
    const literalHost = new URL(url).hostname.replace(/^\[|\]$/g, '');
    await expect(assertSafeProviderUrl(
      url,
      new Set([...allowedHosts, literalHost]),
      publicRecords,
    )).rejects.toThrow('AI_PROVIDER_URL_INVALID');
  });

  it('rejects an allowed hostname when either DNS record resolves to a private address', async () => {
    const resolveDns = vi.fn(async (_hostname: string, recordType: 'A' | 'AAAA') => (
      recordType === 'A' ? ['104.18.12.123'] : ['fe80::1']
    ));

    await expect(assertSafeProviderUrl('https://provider.example.test/v1', allowedHosts, resolveDns))
      .rejects.toThrow('AI_PROVIDER_URL_INVALID');
    expect(resolveDns).toHaveBeenCalledWith('provider.example.test', 'A');
    expect(resolveDns).toHaveBeenCalledWith('provider.example.test', 'AAAA');
  });

  it('rejects public hostnames that are absent from the server-owned allowlist', async () => {
    await expect(assertSafeProviderUrl('https://public.example.test', allowedHosts, publicRecords))
      .rejects.toThrow('AI_PROVIDER_URL_INVALID');
  });

  it('permits an allowlisted HTTPS hostname with public A and AAAA records only on port 443', async () => {
    const resolveDns = vi.fn(async (_hostname: string, recordType: 'A' | 'AAAA') => (
      recordType === 'A' ? ['104.18.12.123'] : ['2606:4700::6812:c7b']
    ));

    await expect(assertSafeProviderUrl('https://provider.example.test/v1', allowedHosts, resolveDns))
      .resolves.toBeInstanceOf(URL);
    await expect(assertSafeProviderUrl('https://provider.example.test:8443/v1', allowedHosts, resolveDns))
      .rejects.toThrow('AI_PROVIDER_URL_INVALID');
  });

  it.each([
    '100.64.0.1',
    '192.0.0.1',
    '192.88.99.1',
    '198.18.0.1',
    '240.0.0.1',
    '2001:db8::1',
    '::ffff:7f00:1',
    '::ffff:8.8.8.8',
    '::192.0.2.1',
    '3fff::1',
    '5f00::1',
    'fec0::1',
  ])('rejects a non-global DNS result %s', async (record) => {
    await expect(assertSafeProviderUrl(
      'https://provider.example.test/v1',
      allowedHosts,
      async () => [record],
    )).rejects.toThrow('AI_PROVIDER_URL_INVALID');
  });

  it('fails closed when DNS returns no records or rejects a record lookup', async () => {
    await expect(assertSafeProviderUrl('https://provider.example.test/v1', allowedHosts, async () => []))
      .rejects.toThrow('AI_PROVIDER_URL_INVALID');
    await expect(assertSafeProviderUrl('https://provider.example.test/v1', allowedHosts, async () => {
      throw new Error('resolver unavailable');
    })).rejects.toThrow('AI_PROVIDER_URL_INVALID');
  });
});

describe('callConfiguredProvider', () => {
  it('fails closed before DNS or fetch for an unrecognized provider without serializing sensitive configuration', async () => {
    const fetchSpy = vi.fn();
    const resolveDns = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Deno', { resolveDns, env: { get: () => undefined } });

    const configProviderSentinel = 'openai-typo-provider-sentinel';
    const apiKeySentinel = ['api', 'key', 'sentinel'].join('-');
    const systemPromptSentinel = 'system-prompt-sentinel';
    const answerPromptSentinel = 'answer-prompt-sentinel';
    const error = await callConfiguredProvider(
      {
        provider: configProviderSentinel,
        apiKey: apiKeySentinel,
        model: 'model-sentinel',
        baseUrl: 'https://provider.example.test/v1',
      },
      { systemPrompt: systemPromptSentinel, userContent: answerPromptSentinel, maxTokens: 32 },
    ).then(() => undefined, (caught) => caught);

    expect(error).toBeInstanceOf(ProviderRequestError);
    if (!(error instanceof ProviderRequestError)) throw new Error('Expected a ProviderRequestError');
    expect(error).toMatchObject({ stage: 'configuration' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resolveDns).not.toHaveBeenCalled();

    const serialized = JSON.stringify({
      error,
      diagnostic: providerFailureDiagnostic('fn_req-123', configProviderSentinel, error),
    });
    expect(providerFailureDiagnostic('fn_req-123', configProviderSentinel, error)).toEqual({
      functionRequestId: 'fn_req-123',
      provider: 'unknown',
      stage: 'configuration',
    });
    for (const sentinel of [configProviderSentinel, apiKeySentinel, systemPromptSentinel, answerPromptSentinel]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('uses the pinned OpenAI endpoint without DNS when the direct provider is selected', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'provider response' } }],
    })));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Deno', { env: { get: () => undefined } });

    await expect(callConfiguredProvider(
      { provider: 'openai', apiKey: 'test-key', model: 'gpt-4o-mini', baseUrl: 'https://ignored.example.test' },
      { systemPrompt: 'trusted', userContent: 'untrusted', maxTokens: 32 },
    )).resolves.toBe('provider response');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });

  it('uses the pinned Anthropic endpoint without DNS when the direct provider is selected', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      content: [{ text: 'provider response' }],
    })));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Deno', { env: { get: () => undefined } });

    await expect(callConfiguredProvider(
      { provider: 'anthropic', apiKey: 'test-key', model: 'claude-test', baseUrl: 'https://ignored.example.test' },
      { systemPrompt: 'trusted', userContent: 'untrusted', maxTokens: 32 },
    )).resolves.toBe('provider response');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });

  it('uses a redirect-rejecting 60-second request and keeps credentials and prompts out of thrown errors', async () => {
    const fetchSpy = vi.fn(async () => new Response('provider body containing credentials', { status: 502 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Deno', { resolveDns: publicRecords, env: { get: () => undefined } });

    const apiKey = ['credential', 'do', 'not', 'log'].join('-');
    const untrustedPrompt = 'untrusted prompt <ignore previous instructions>';
    const error = await callConfiguredProvider(
      { provider: 'anthropic', apiKey, model: 'claude-test', baseUrl: null },
      { systemPrompt: 'trusted system instructions', userContent: untrustedPrompt, maxTokens: 321 },
    ).then(() => undefined, (caught) => caught as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('AI_PROVIDER_REQUEST_FAILED');
    expect(error?.message).not.toContain(apiKey);
    expect(error?.message).not.toContain(untrustedPrompt);
    expect(error?.message).not.toContain('provider body');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });

  it('serializes question and answer as independently delimited data rather than part of the system prompt', () => {
    expect(formatScoringUserContent('Why medicine?', 'I value evidence-based care.')).toBe(
      'QUESTION_JSON:\n"Why medicine?"\n\nSTUDENT_ANSWER_JSON:\n"I value evidence-based care."',
    );
  });

  it('requires an Edge allowlist secret before a custom OpenAI-compatible provider can receive credentials', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'provider response' } }],
    })));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Deno', {
      resolveDns: publicRecords,
      env: { get: () => undefined },
    });
    const customConfig = {
      provider: 'openai_compatible',
      apiKey: ['custom', 'provider', 'key'].join('-'),
      model: 'custom-model',
      baseUrl: 'https://provider.example.test/v1',
    };
    const providerRequest = { systemPrompt: 'trusted', userContent: 'untrusted', maxTokens: 32 };

    await expect(callConfiguredProvider(customConfig, providerRequest)).rejects.toThrow('AI_PROVIDER_REQUEST_FAILED');
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.stubGlobal('Deno', {
      resolveDns: publicRecords,
      env: { get: (name: string) => name === 'AI_PROVIDER_ALLOWED_HOSTS' ? 'provider.example.test' : undefined },
    });
    await expect(callConfiguredProvider(customConfig, providerRequest)).resolves.toBe('provider response');
  });

  it('does not fetch when a final DNS revalidation observes a rebinding to a non-global address', async () => {
    const resolveDns = vi.fn()
      .mockResolvedValueOnce(['104.18.12.123'])
      .mockResolvedValueOnce(['2606:4700::6812:c7b'])
      .mockResolvedValueOnce(['127.0.0.1'])
      .mockResolvedValueOnce(['2606:4700::6812:c7b']);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Deno', {
      resolveDns,
      env: { get: (name: string) => name === 'AI_PROVIDER_ALLOWED_HOSTS' ? 'provider.example.test' : undefined },
    });

    await expect(callConfiguredProvider(
      {
        provider: 'openai_compatible',
        apiKey: ['test', 'key'].join('-'),
        model: 'custom-model',
        baseUrl: 'https://provider.example.test/v1',
      },
      { systemPrompt: 'trusted', userContent: 'untrusted', maxTokens: 32 },
    )).rejects.toThrow('AI_PROVIDER_REQUEST_FAILED');
    expect(resolveDns).toHaveBeenCalledTimes(4);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed at DNS preflight without fetching for a custom provider when DNS is unavailable', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Deno', {
      env: { get: (name: string) => name === 'AI_PROVIDER_ALLOWED_HOSTS' ? 'provider.example.test' : undefined },
    });

    const error = await callConfiguredProvider(
      { provider: 'openai_compatible', apiKey: 'test-key', model: 'custom-model', baseUrl: 'https://provider.example.test/v1' },
      { systemPrompt: 'trusted', userContent: 'untrusted', maxTokens: 32 },
    ).then(() => undefined, (caught) => caught);

    expect(error).toMatchObject({ name: 'ProviderRequestError', stage: 'dns_preflight' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'network failures',
      response: undefined,
      expected: { stage: 'network' },
    },
    {
      name: 'HTTP failures with a valid provider request id',
      response: new Response('provider-body-sentinel', { status: 401, headers: { 'x-request-id': 'req_ABC-123' } }),
      expected: { stage: 'http', status: 401, providerRequestId: 'req_ABC-123' },
    },
    {
      name: 'successful envelopes missing provider content',
      response: new Response(JSON.stringify({ unexpected: 'provider-body-sentinel' }), {
        status: 200,
        headers: { 'x-request-id': 'req_shape-123' },
      }),
      expected: { stage: 'response_shape', providerRequestId: 'req_shape-123' },
    },
  ])('returns only a sanitized diagnostic for $name', async ({ response, expected }) => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (response) return response;
      throw new Error('network-sentinel');
    }));
    vi.stubGlobal('Deno', { env: { get: () => undefined } });

    const error = await callConfiguredProvider(
      { provider: 'openai', apiKey: ['api', 'key', 'sentinel'].join('-'), model: 'gpt-4o-mini', baseUrl: null },
      { systemPrompt: 'system-prompt-sentinel', userContent: 'answer-prompt-sentinel', maxTokens: 32 },
    ).then(() => undefined, (caught) => caught);

    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error).toMatchObject(expected);
    const serialized = JSON.stringify(providerFailureDiagnostic('fn_req-123', 'openai', error as ProviderRequestError));
    for (const sentinel of ['api-key-sentinel', 'system-prompt-sentinel', 'answer-prompt-sentinel', 'network-sentinel', 'provider-body-sentinel']) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('rejects malformed or oversized request identifiers from provider and function headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('body', {
      status: 401,
      headers: { 'x-request-id': 'x'.repeat(200) },
    })));
    vi.stubGlobal('Deno', { env: { get: () => undefined } });

    const error = await callConfiguredProvider(
      { provider: 'openai', apiKey: 'test-key', model: 'gpt-4o-mini', baseUrl: null },
      { systemPrompt: 'trusted', userContent: 'untrusted', maxTokens: 32 },
    ).then(() => undefined, (caught) => caught as ProviderRequestError);

    expect(error).toBeInstanceOf(ProviderRequestError);
    if (!(error instanceof ProviderRequestError)) throw new Error('Expected a ProviderRequestError');
    expect(error).toMatchObject({ stage: 'http', status: 401, providerRequestId: undefined });
    expect(providerFailureDiagnostic(`bad\n${'x'.repeat(200)}`, 'openai', error)).toEqual({
      provider: 'openai',
      stage: 'http',
      status: 401,
    });
  });

  it('keeps the provider timeout comfortably below the scoring-claim lease', () => {
    expect(AI_PROVIDER_TIMEOUT_MS).toBe(60_000);
    expect(MMI_SCORING_CLAIM_LEASE_MS).toBe(180_000);
    expect(AI_PROVIDER_TIMEOUT_MS * 2).toBeLessThan(MMI_SCORING_CLAIM_LEASE_MS);
  });

  it('rejects malformed provider JSON instead of clamping or defaulting the legacy five-dimension response', () => {
    expect(() => parseLegacyScoreResponse(JSON.stringify({
      structure: 4,
      ethics: 3,
      communication: 4,
      reflection: 3,
      nhs_awareness: '2',
      overall_pct: 64,
      ai_feedback: 'Feedback',
      improvement_tip: 'Use SPAR.',
    }))).toThrow('AI_PROVIDER_RESPONSE_INVALID');
  });

  it('preserves the legacy five-dimension response shape for valid provider JSON', () => {
    expect(parseLegacyScoreResponse(JSON.stringify({
      structure: 4,
      ethics: 3,
      communication: 4,
      reflection: 3,
      nhs_awareness: 2,
      overall_pct: 64,
      ai_feedback: 'Your answer is clear.',
      improvement_tip: 'Use SPAR.',
    }))).toEqual({
      structure: 4,
      ethics: 3,
      communication: 4,
      reflection: 3,
      nhs_awareness: 2,
      overall_pct: 64,
      ai_feedback: 'Your answer is clear.',
      improvement_tip: 'Use SPAR.',
    });
  });

  it('rejects a provider-authored overall percentage that disagrees with the five dimensions', () => {
    expect(() => parseLegacyScoreResponse(JSON.stringify({
      structure: 4,
      ethics: 3,
      communication: 4,
      reflection: 3,
      nhs_awareness: 2,
      overall_pct: 99,
      ai_feedback: 'Your answer is clear.',
      improvement_tip: 'Use SPAR.',
    }))).toThrow('AI_PROVIDER_RESPONSE_INVALID');
  });

  it.each([
    { ai_feedback: '   ', improvement_tip: 'Use SPAR.' },
    { ai_feedback: 'Feedback', improvement_tip: '  Use SPAR.' },
    { ai_feedback: 'x'.repeat(MAX_AI_FEEDBACK_LENGTH + 1), improvement_tip: 'Use SPAR.' },
    { ai_feedback: 'Feedback', improvement_tip: 'x'.repeat(MAX_IMPROVEMENT_TIP_LENGTH + 1) },
  ])('rejects untrimmed, empty, or oversized provider feedback text', (text) => {
    expect(() => parseLegacyScoreResponse(JSON.stringify({
      structure: 4,
      ethics: 3,
      communication: 4,
      reflection: 3,
      nhs_awareness: 2,
      overall_pct: 64,
      ...text,
    }))).toThrow('AI_PROVIDER_RESPONSE_INVALID');
  });
});
