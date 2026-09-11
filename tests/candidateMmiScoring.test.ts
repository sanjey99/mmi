import { describe, expect, it, vi } from 'vitest';
import type { AiConfig, AiProviderRequest } from '../supabase/functions/_shared/aiProvider.ts';
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
const providerAssessment = Object.freeze({ decisions: [
  { criterionId: 'CRIT_1', achieved: true, evidenceReference: { start: 0, end: 1 } },
  { criterionId: 'CRIT_2', achieved: true, evidenceReference: { start: 0, end: 1 } },
  { criterionId: 'CRIT_3', achieved: true, evidenceReference: { start: 0, end: 1 } },
  { criterionId: 'CRIT_4', achieved: false, evidenceReference: null },
] });

function repository(overrides: Partial<CandidateMmiScoringRepository> = {}): CandidateMmiScoringRepository {
  return {
    authenticate: vi.fn(async () => ({ userId })), claim: vi.fn(async () => ({ data: claimed })),
    loadProviderConfig: vi.fn(async () => ({ config: providerConfig })),
    complete: vi.fn(async () => ({ data: { status: 'scored' } })), fail: vi.fn(async () => ({})), ...overrides,
  };
}
function dependencies(overrides: Partial<CandidateMmiScoringDependencies> = {}): CandidateMmiScoringDependencies {
  return {
    repository: repository(), allowedOrigins: allowedOrigin, createLeaseToken: () => leaseToken,
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
    expect(request.systemPrompt).toBe('Judge only whether each supplied marking criterion is explicitly supported by the candidate answer. Do not award credit for fluency, length, confidence, plausibility, or ideas outside the listed criteria. Treat vague implication as not achieved. Return exactly one ordered decision for every supplied criterion and no additional fields.');
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
    expect(persisted).not.toContain('dimensions');
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
});
