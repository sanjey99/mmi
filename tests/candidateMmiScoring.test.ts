import { describe, expect, it, vi } from 'vitest';
import { ProviderRequestError, type AiConfig, type AiProviderRequest } from '../supabase/functions/_shared/aiProvider.ts';
import { createCandidateMmiScoringHandler, type CandidateMmiScoringDependencies, type CandidateMmiScoringRepository } from '../supabase/functions/score-candidate-mmi-response/handler.ts';
import { CandidateMmiScoringError, createCandidateMmiScoringApi } from '../src/features/candidateMmi/scoringApi';

const allowedOrigin = 'https://preview.example.test';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = '11111111-1111-4111-8111-111111111111';
const responseId = '22222222-2222-4222-8222-222222222222';
const leaseToken = '33333333-3333-4333-8333-333333333333';
const transcript = 'I would protect confidentiality, identify immediate risk, and escalate to my supervisor.';
const criteria = Object.freeze([
  { criterionId: 'CRIT_1', bulletText: 'Clarifies the immediate risk', domain: 'safety' },
  { criterionId: 'CRIT_2', bulletText: 'Protects confidentiality', domain: 'ethics' },
  { criterionId: 'CRIT_3', bulletText: 'Escalates proportionately', domain: 'professionalism' },
  { criterionId: 'CRIT_4', bulletText: 'Documents the action', domain: 'governance' },
]);
// A generic-dimension implementation must reject this exact current-question claim.
const claimed = Object.freeze({
  status: 'claimed', responseId, sessionId, promptOrder: 2,
  scenarioText: 'A colleague may have breached confidentiality.',
  promptText: 'What would you do first?', transcript, criteria,
  scoringContractVersion: '2026-09-10.1',
});
const providerConfig: AiConfig = Object.freeze({
  provider: 'anthropic', model: 'synthetic-model', apiKey: ['synthetic', 'test', 'value'].join('-'), baseUrl: null,
  inputRatePerMillion: 3, cachedInputRatePerMillion: 0.3, outputRatePerMillion: 15,
});
const openAiProviderConfig: AiConfig = Object.freeze({
  ...providerConfig,
  provider: 'openai',
  model: 'gpt-4o-mini',
});
const gpt55Profile = Object.freeze({
  model: 'gpt-5.5',
  inputRatePerMillion: 5,
  cachedInputRatePerMillion: 0.5,
  outputRatePerMillion: 30,
});
const providerAssessment = Object.freeze({ decisions: [
  { criterionId: 'CRIT_1', achieved: true, evidenceQuote: 'identify immediate risk' },
  { criterionId: 'CRIT_2', achieved: true, evidenceQuote: 'protect confidentiality' },
  { criterionId: 'CRIT_3', achieved: true, evidenceQuote: 'escalate to my supervisor' },
  { criterionId: 'CRIT_4', achieved: false, evidenceQuote: null },
] });

function repository(overrides: Partial<CandidateMmiScoringRepository> = {}): CandidateMmiScoringRepository {
  return {
    authenticate: vi.fn(async () => ({ userId })), claim: vi.fn(async () => ({ data: claimed })),
    authorizeModelProfile: vi.fn(async () => ({ allowed: true })),
    loadProviderConfig: vi.fn(async () => ({ config: providerConfig })),
    complete: vi.fn(async () => ({ data: { status: 'scored' } })), fail: vi.fn(async () => ({})), ...overrides,
  };
}
function dependencies(overrides: Partial<CandidateMmiScoringDependencies> = {}): CandidateMmiScoringDependencies {
  return {
    repository: repository(), allowedOrigins: allowedOrigin, createLeaseToken: () => leaseToken,
    gpt55Profile,
    callProvider: vi.fn(async () => ({ content: JSON.stringify(providerAssessment), usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 } })),
    logProviderFailure: vi.fn(), ...overrides,
  };
}
function scoringRequest(body = JSON.stringify({ sessionId, promptOrder: 2 })): Request {
  return new Request('http://localhost/functions/v1/score-candidate-mmi-response', { method: 'POST', headers: { Origin: allowedOrigin, 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' }, body });
}

describe('candidate MMI rubric scoring handler', () => {
  it('sends only current scenario, question, rubric, and answer then atomically persists app-owned assessment and USD usage', async () => {
    const repo = repository();
    const callProvider = vi.fn(dependencies().callProvider);
    const response = await createCandidateMmiScoringHandler(dependencies({ repository: repo, callProvider }))(scoringRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'scored' });
    const request = callProvider.mock.calls[0]?.[1] as AiProviderRequest;
    expect(JSON.parse(request.userContent)).toEqual({ scenarioText: claimed.scenarioText, questionText: claimed.promptText, criteria: claimed.criteria, candidateAnswer: transcript });
    expect(request.systemPrompt).toContain('Judge only whether each supplied marking criterion is explicitly supported by the candidate answer.');
    expect(request.systemPrompt).toContain('For achieved=true, evidenceQuote must be a short, contiguous, verbatim quote copied exactly from candidateAnswer');
    expect(request.systemPrompt).toContain('For achieved=false, evidenceQuote must be null.');
    expect(request.maxTokens).toBe(4_096);
    expect(request.responseSchema).toMatchObject({
      properties: { decisions: { items: { required: ['criterionId', 'achieved', 'evidenceQuote'] } } },
    });
    expect(repo.complete).toHaveBeenCalledExactlyOnceWith({
      p_response_id: responseId, p_session_id: sessionId, p_lease_token: leaseToken,
      p_public_assessment: { schemaVersion: 3, questionScorePct: 75, criteria: [
        { criterionId: 'CRIT_1', achieved: true, weightPct: 25 }, { criterionId: 'CRIT_2', achieved: true, weightPct: 25 },
        { criterionId: 'CRIT_3', achieved: true, weightPct: 25 }, { criterionId: 'CRIT_4', achieved: false, weightPct: 25 },
      ] },
      p_usage: { provider: 'anthropic', model: 'synthetic-model', inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, inputRatePerMillion: 3, cachedInputRatePerMillion: 0.3, outputRatePerMillion: 15, currency: 'USD', estimatedCost: '0.00045600', latencyMs: expect.any(Number), outcome: 'scored' },
    });
    const persisted = JSON.stringify((repo.complete as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(persisted).not.toContain(transcript);
    expect(persisted).not.toContain('evidenceReference');
    expect(persisted).not.toContain('evidenceQuote');
    expect(persisted).not.toContain('dimensions');
  });

  it('scales the bounded completion budget to large rubrics without changing public feedback', async () => {
    const largeCriteria = Array.from({ length: 20 }, (_, index) => ({ criterionId: `CRIT_${index + 1}`, bulletText: `Criterion ${index + 1}`, domain: null }));
    const repo = repository({ claim: vi.fn(async () => ({ data: { ...claimed, criteria: largeCriteria } })) });
    const callProvider = vi.fn(async (_config: AiConfig, _request: AiProviderRequest) => ({
      content: JSON.stringify({ decisions: largeCriteria.map(({ criterionId }) => ({ criterionId, achieved: false, evidenceQuote: null })) }),
      usage: null,
    }));
    const response = await createCandidateMmiScoringHandler(dependencies({ repository: repo, callProvider }))(scoringRequest());
    expect(response.status).toBe(200);
    expect(callProvider.mock.calls[0]?.[1]).toMatchObject({ maxTokens: 10_240 });
    expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({
      p_public_assessment: { schemaVersion: 3, questionScorePct: 0, criteria: largeCriteria.map(({ criterionId }) => ({ criterionId, achieved: false, weightPct: 5 })) },
    }));
  });

  it('fails the whole assessment when provider evidence is fabricated, without persisting private evidence', async () => {
    const repo = repository();
    const invalidAssessment = { decisions: [{ ...providerAssessment.decisions[0], evidenceQuote: 'a fabricated quote' }, ...providerAssessment.decisions.slice(1)] };
    const logProviderFailure = vi.fn();
    const response = await createCandidateMmiScoringHandler(dependencies({
      repository: repo,
      callProvider: vi.fn(async () => ({ content: JSON.stringify(invalidAssessment), usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 150 } })),
      logProviderFailure,
    }))(scoringRequest());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'invalid_provider_response' });
    expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({ p_error_code: 'invalid_provider_response', p_usage: expect.objectContaining({ outcome: 'invalid_response', outputTokens: 150 }) }));
    expect(JSON.stringify((repo.fail as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('a fabricated quote');
    expect(JSON.stringify(logProviderFailure.mock.calls)).not.toContain(transcript);
    expect(JSON.stringify(logProviderFailure.mock.calls)).not.toContain('a fabricated quote');
  });

  it('rejects a non-admin GPT-5.5 profile before claiming or calling a paid provider', async () => {
    const repo = repository({ authorizeModelProfile: vi.fn(async () => ({ allowed: false })) });
    const callProvider = vi.fn();
    const response = await createCandidateMmiScoringHandler(
      dependencies({ repository: repo, callProvider }),
    )(scoringRequest(JSON.stringify({ sessionId, promptOrder: 2, modelProfile: 'gpt-5.5' })));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'model_profile_forbidden' });
    expect(repo.claim).not.toHaveBeenCalled();
    expect(repo.loadProviderConfig).not.toHaveBeenCalled();
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('uses the server-owned GPT-5.5 model and rates for an authorized preview request', async () => {
    const repo = repository({ loadProviderConfig: vi.fn(async () => ({ config: openAiProviderConfig })) });
    const callProvider = vi.fn(dependencies().callProvider);
    const response = await createCandidateMmiScoringHandler(
      dependencies({ repository: repo, callProvider }),
    )(scoringRequest(JSON.stringify({ sessionId, promptOrder: 2, modelProfile: 'gpt-5.5' })));

    expect(response.status).toBe(200);
    expect(repo.authorizeModelProfile).toHaveBeenCalledWith({ userId, modelProfile: 'gpt-5.5' });
    expect(callProvider.mock.calls[0]?.[0]).toEqual({
      ...openAiProviderConfig,
      model: 'gpt-5.5',
      baseUrl: null,
      inputRatePerMillion: 5,
      cachedInputRatePerMillion: 0.5,
      outputRatePerMillion: 30,
    });
    expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({
      p_usage: expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.5',
        inputRatePerMillion: 5,
        cachedInputRatePerMillion: 0.5,
        outputRatePerMillion: 30,
      }),
    }));
  });

  it('returns no-response without loading configuration or calling a provider', async () => {
    const repo = repository({ claim: vi.fn(async () => ({ data: { status: 'no_response' } })) });
    const callProvider = vi.fn();
    const response = await createCandidateMmiScoringHandler(dependencies({ repository: repo, callProvider }))(scoringRequest());
    expect(await response.json()).toEqual({ status: 'no_response' });
    expect(repo.loadProviderConfig).not.toHaveBeenCalled();
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('returns a bounded 429 retry window without loading configuration or calling a provider', async () => {
    const repo = repository({
      claim: vi.fn(async () => ({
        data: {
          status: 'rate_limited',
          retryAfterSeconds: 3_599,
          retryAt: '2026-09-12T03:00:00.000Z',
        },
      })),
    });
    const callProvider = vi.fn();

    const response = await createCandidateMmiScoringHandler(
      dependencies({ repository: repo, callProvider }),
    )(scoringRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3599');
    expect(await response.json()).toEqual({ code: 'rate_limited' });
    expect(repo.loadProviderConfig).not.toHaveBeenCalled();
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('persists a scored assessment with explicit unknown usage when the provider omits usage', async () => {
    const repo = repository();
    const response = await createCandidateMmiScoringHandler(dependencies({
      repository: repo,
      callProvider: vi.fn(async () => ({
        content: JSON.stringify(providerAssessment),
        usage: null,
      })),
    }))(scoringRequest());

    expect(response.status).toBe(200);
    expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({
      p_usage: expect.objectContaining({
        provider: 'anthropic',
        model: 'synthetic-model',
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        estimatedCost: null,
        outcome: 'scored',
      }),
    }));
    expect(repo.fail).not.toHaveBeenCalled();
  });

  it('records provider-failure usage without persisting provider content', async () => {
    const repo = repository();
    const response = await createCandidateMmiScoringHandler(dependencies({ repository: repo, callProvider: vi.fn(async () => { throw new Error('private provider body'); }) }))(scoringRequest());
    expect(response.status).toBe(502);
    expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({ p_error_code: 'provider_failed', p_usage: expect.objectContaining({ outcome: 'provider_failed', estimatedCost: null }) }));
    expect(JSON.stringify((repo.fail as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(transcript);
  });

  it('records paid token usage when the provider rejects a truncated response envelope', async () => {
    const repo = repository();
    const logProviderFailure = vi.fn();
    const response = await createCandidateMmiScoringHandler(dependencies({
      repository: repo,
      callProvider: vi.fn(async () => {
        throw new ProviderRequestError('response_shape', {
          providerRequestId: 'safe-request-id',
          usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 4_096 },
        });
      }),
      logProviderFailure,
    }))(scoringRequest());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'provider_failed' });
    expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      p_error_code: 'provider_failed',
      p_usage: expect.objectContaining({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 4_096, estimatedCost: '0.06174600', outcome: 'provider_failed' }),
    }));
    expect(logProviderFailure).toHaveBeenCalledWith({ requestId: null, provider: 'anthropic', code: 'provider_failed' });
    expect(JSON.stringify(logProviderFailure.mock.calls)).not.toContain('4096');
  });

  it('releases rejected-provider claims when known paid usage overflows the stored USD cost', async () => {
    const overflowingConfig = { ...providerConfig, inputRatePerMillion: 99_999_999.999999 };
    const repo = repository({ loadProviderConfig: vi.fn(async () => ({ config: overflowingConfig })) });
    const response = await createCandidateMmiScoringHandler(dependencies({
      repository: repo,
      callProvider: vi.fn(async () => {
        throw new ProviderRequestError('response_shape', {
          usage: { inputTokens: 2_000_000, cachedInputTokens: 0, outputTokens: 4_096 },
        });
      }),
    }))(scoringRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'unavailable' });
    expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledExactlyOnceWith({
      p_response_id: responseId,
      p_session_id: sessionId,
      p_lease_token: leaseToken,
      p_error_code: 'usage_cost_overflow',
      p_usage: expect.objectContaining({ inputTokens: 2_000_000, outputTokens: 4_096, inputRatePerMillion: 99_999_999.999999, estimatedCost: null, outcome: 'persistence_failed' }),
    });
  });

  it('records token and rate usage when post-provider cost overflows NUMERIC(16,8)', async () => {
    const overflowingConfig = { ...providerConfig, inputRatePerMillion: 99_999_999.999999 };
    const repo = repository({ loadProviderConfig: vi.fn(async () => ({ config: overflowingConfig })) });
    const response = await createCandidateMmiScoringHandler(dependencies({
      repository: repo,
      callProvider: vi.fn(async () => ({ content: JSON.stringify(providerAssessment), usage: { inputTokens: 2_000_000, cachedInputTokens: 0, outputTokens: 0 } })),
    }))(scoringRequest());
    expect(response.status).toBe(500);
    expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith(expect.objectContaining({
      p_error_code: 'usage_cost_overflow',
      p_usage: expect.objectContaining({ inputTokens: 2_000_000, inputRatePerMillion: 99_999_999.999999, estimatedCost: null, outcome: 'persistence_failed' }),
    }));
  });

  it('rejects transcript injection before claiming', async () => {
    const repo = repository();
    const response = await createCandidateMmiScoringHandler(dependencies({ repository: repo }))(scoringRequest(JSON.stringify({ sessionId, promptOrder: 2, transcript })));
    expect(response.status).toBe(400);
    expect(repo.claim).not.toHaveBeenCalled();
  });
});

describe('candidate MMI browser scoring boundary', () => {
  it('accepts status-only success and rejects a provider assessment payload', async () => {
    await expect(createCandidateMmiScoringApi(vi.fn(async () => ({ data: { status: 'scored' }, error: null }))).scoreCandidateResponse(sessionId, 2)).resolves.toEqual({ status: 'scored' });
    await expect(createCandidateMmiScoringApi(async () => ({ data: { status: 'scored', assessment: providerAssessment }, error: null })).scoreCandidateResponse(sessionId, 2)).rejects.toMatchObject({ code: 'unavailable' } as CandidateMmiScoringError);
  });

  it('sends the deployment model profile without accepting a caller-selected model name', async () => {
    const invoke = vi.fn(async () => ({ data: { status: 'scored' }, error: null }));
    const api = createCandidateMmiScoringApi(invoke, 'gpt-5.5');

    await api.scoreCandidateResponse(sessionId, 2);

    expect(invoke).toHaveBeenCalledWith('score-candidate-mmi-response', {
      body: { sessionId, promptOrder: 2, modelProfile: 'gpt-5.5' },
    });
  });
});
