import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_PROVIDER_TIMEOUT_MS,
  MMI_SCORING_CLAIM_LEASE_MS,
  callConfiguredProvider,
  formatScoringUserContent,
  parseLegacyScoreResponse,
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
  ])('rejects literal non-public address %s', async (url) => {
    await expect(assertSafeProviderUrl(url, allowedHosts, publicRecords)).rejects.toThrow('AI_PROVIDER_URL_INVALID');
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
});

describe('callConfiguredProvider', () => {
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
});
