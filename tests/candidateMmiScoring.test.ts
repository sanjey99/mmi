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
  { criterionId: 'CRIT_1', performanceLevel: 4, evidenceId: 'E1', justification: 'The answer identifies immediate risk and gives a clear protective response.' },
  { criterionId: 'CRIT_2', performanceLevel: 4, evidenceId: 'E1', justification: 'The answer explicitly protects confidentiality in the proposed response.' },
  { criterionId: 'CRIT_3', performanceLevel: 4, evidenceId: 'E1', justification: 'The answer names a supervisor as the appropriate escalation route.' },
  { criterionId: 'CRIT_4', performanceLevel: 0, evidenceId: null, justification: 'The answer does not describe documenting the action.' },
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
    expect(JSON.parse(request.userContent)).toEqual({ scenarioText: claimed.scenarioText, questionText: claimed.promptText, criteria: claimed.criteria, candidateAnswer: transcript, evidenceExcerpts: [{ evidenceId: 'E1', text: transcript }] });
    for (const label of ['Not demonstrated', 'Mentioned only', 'Basic demonstration', 'Good demonstration', 'Excellent demonstration']) {
      expect(request.systemPrompt).toContain(label);
    }
    expect(request.systemPrompt).toContain('justification');
    expect(request.systemPrompt).toContain('evidenceId');
    expect(request.systemPrompt).toContain('never return copied quotes or character offsets');
    expect(request.maxTokens).toBe(4_096);
    expect(request.responseSchema).toMatchObject({
      properties: { decisions: { items: { required: ['criterionId', 'performanceLevel', 'evidenceId', 'justification'], properties: { performanceLevel: { type: 'integer', enum: [0, 1, 2, 3, 4] }, justification: { type: 'string', minLength: 1, maxLength: 600 }, evidenceId: { anyOf: [{ type: 'string', enum: ['E1'] }, { type: 'null' }] } } } } },
    });
    expect(repo.complete).toHaveBeenCalledExactlyOnceWith({
      p_response_id: responseId, p_session_id: sessionId, p_lease_token: leaseToken,
      p_public_assessment: { schemaVersion: 4, questionScorePct: 75, criteria: providerAssessment.decisions.map(({ criterionId, performanceLevel, justification }) => ({
        criterionId, performanceLevel, weightPct: 25, evidenceQuote: performanceLevel > 0 ? transcript : null, justification,
      })) },
      p_usage: { provider: 'anthropic', model: 'synthetic-model', inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, inputRatePerMillion: 3, cachedInputRatePerMillion: 0.3, outputRatePerMillion: 15, currency: 'USD', estimatedCost: '0.00045600', latencyMs: expect.any(Number), outcome: 'scored' },
    });
    const persisted = JSON.stringify((repo.complete as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(persisted).toContain(transcript);
    expect(persisted).not.toContain('evidenceReference');
    expect(persisted).not.toContain('evidenceId');
    expect(persisted).not.toContain('evidenceExcerpts');
    expect(persisted).not.toContain('dimensions');
  });

  it('scales the bounded completion budget to large rubrics without changing public feedback', async () => {
    const largeCriteria = Array.from({ length: 20 }, (_, index) => ({ criterionId: `CRIT_${index + 1}`, bulletText: `Criterion ${index + 1}`, domain: null }));
    const repo = repository({ claim: vi.fn(async () => ({ data: { ...claimed, criteria: largeCriteria } })) });
    const callProvider = vi.fn(async (_config: AiConfig, _request: AiProviderRequest) => ({
      content: JSON.stringify({ decisions: largeCriteria.map(({ criterionId }) => ({ criterionId, performanceLevel: 0, evidenceId: null, justification: 'The answer does not demonstrate this criterion.' })) }),
      usage: null,
    }));
    const response = await createCandidateMmiScoringHandler(dependencies({ repository: repo, callProvider }))(scoringRequest());
    expect(response.status).toBe(200);
    expect(callProvider.mock.calls[0]?.[1]).toMatchObject({ maxTokens: 10_240 });
    expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({
      p_public_assessment: { schemaVersion: 4, questionScorePct: 0, criteria: largeCriteria.map(({ criterionId }) => ({ criterionId, performanceLevel: 0, weightPct: 5, evidenceQuote: null, justification: 'The answer does not demonstrate this criterion.' })) },
    }));
  });

  it('calculates partial marks on the five-level scale and retains the evidence for each score', async () => {
    const repo = repository();
    const levels = [0, 1, 2, 4];
    const decisions = providerAssessment.decisions.map((decision, index) => ({
      ...decision,
      performanceLevel: levels[index],
      evidenceId: index === 0 ? null : 'E1',
      justification: `Criterion ${index + 1} receives level ${levels[index]} based on the answer.`,
    }));
    const response = await createCandidateMmiScoringHandler(dependencies({
      repository: repo,
      callProvider: vi.fn(async () => ({ content: JSON.stringify({ decisions }), usage: null })),
    }))(scoringRequest());

    expect(response.status).toBe(200);
    expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({
      p_public_assessment: {
        schemaVersion: 4,
        questionScorePct: 43.75,
        criteria: decisions.map(({ criterionId, performanceLevel, justification }) => ({
          criterionId, performanceLevel, weightPct: 25,
          evidenceQuote: performanceLevel > 0 ? transcript : null, justification,
        })),
      },
    }));
  });

  it('asks the provider to cap vague intentions at mentioned only and explain the missing demonstration', async () => {
    const candidateTranscript = 'I would listen to the patient.';
    const repo = repository({ claim: vi.fn(async () => ({ data: { ...claimed, transcript: candidateTranscript } })) });
    const callProvider = vi.fn(async (_config: AiConfig, _request: AiProviderRequest) => ({
      content: JSON.stringify({ decisions: providerAssessment.decisions.map((decision) => ({
        ...decision, performanceLevel: 1, evidenceId: 'E1',
        justification: 'The answer mentions listening but gives no concrete question or response to a concern.',
      })) }), usage: null,
    }));
    const response = await createCandidateMmiScoringHandler(dependencies({ repository: repo, callProvider }))(scoringRequest());

    expect(response.status).toBe(200);
    const prompt = callProvider.mock.calls[0]?.[1].systemPrompt.toLowerCase();
    expect(prompt).toContain('mentioned only');
    expect(prompt).toContain('"i would listen to the patient" alone earns at most this level');
    expect(prompt).toContain('intention');
    expect(prompt).toContain('justification');
    expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({
      p_public_assessment: expect.objectContaining({ questionScorePct: 25 }),
    }));
  });

  it('allows level zero to cite a verified excerpt explaining why the criterion was not demonstrated', async () => {
    const repo = repository();
    const decisions = providerAssessment.decisions.map((decision) => ({
      ...decision, performanceLevel: 0, evidenceId: 'E1',
      justification: 'The quoted answer does not demonstrate the required action.',
    }));
    const response = await createCandidateMmiScoringHandler(dependencies({
      repository: repo,
      callProvider: vi.fn(async () => ({ content: JSON.stringify({ decisions }), usage: null })),
    }))(scoringRequest());

    expect(response.status).toBe(200);
    expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({
      p_public_assessment: {
        schemaVersion: 4, questionScorePct: 0,
        criteria: decisions.map(({ criterionId, performanceLevel, justification }) => ({
          criterionId, performanceLevel, weightPct: 25, evidenceQuote: transcript, justification,
        })),
      },
    }));
  });

  it('fails the whole assessment when provider evidence identifiers are fabricated, without persisting private evidence', async () => {
    const repo = repository();
    const invalidAssessment = { decisions: [{ ...providerAssessment.decisions[0], evidenceId: 'E999' }, ...providerAssessment.decisions.slice(1)] };
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
    expect(JSON.stringify((repo.fail as ReturnType<typeof vi.fn>).mock.calls)).not.toContain('E999');
    expect(JSON.stringify(logProviderFailure.mock.calls)).not.toContain(transcript);
    expect(JSON.stringify(logProviderFailure.mock.calls)).not.toContain('E999');
    expect(logProviderFailure).toHaveBeenCalledExactlyOnceWith({ requestId: null, provider: 'anthropic', code: 'invalid_provider_response', validationReason: 'evidence_unknown' });
  });

  it.each([
    ['envelope', '{"decisions":[', transcript],
    ['count', JSON.stringify({ decisions: providerAssessment.decisions.slice(0, 3) }), transcript],
    ['order', JSON.stringify({ decisions: [providerAssessment.decisions[1], providerAssessment.decisions[0], ...providerAssessment.decisions.slice(2)] }), transcript],
    ['envelope', JSON.stringify({ decisions: [{ ...providerAssessment.decisions[0], performanceLevel: 5 }, ...providerAssessment.decisions.slice(1)] }), transcript],
    ['envelope', JSON.stringify({ decisions: [{ ...providerAssessment.decisions[0], performanceLevel: 1.5 }, ...providerAssessment.decisions.slice(1)] }), transcript],
    ['envelope', JSON.stringify({ decisions: [{ ...providerAssessment.decisions[0], performanceLevel: '4' }, ...providerAssessment.decisions.slice(1)] }), transcript],
    ['envelope', JSON.stringify({ decisions: [{ ...providerAssessment.decisions[0], justification: '   ' }, ...providerAssessment.decisions.slice(1)] }), transcript],
    ['envelope', JSON.stringify({ decisions: [{ ...providerAssessment.decisions[0], justification: '😀'.repeat(601) }, ...providerAssessment.decisions.slice(1)] }), transcript],
    ['evidence_null', JSON.stringify({ decisions: [{ ...providerAssessment.decisions[0], evidenceId: null }, ...providerAssessment.decisions.slice(1)] }), transcript],
    ['evidence_unknown', JSON.stringify({ decisions: [{ ...providerAssessment.decisions[0], evidenceId: 1 }, ...providerAssessment.decisions.slice(1)] }), transcript],
    ['evidence_unknown', JSON.stringify({ decisions: [{ ...providerAssessment.decisions[0], evidenceId: 'E1 ' }, ...providerAssessment.decisions.slice(1)] }), transcript],
    ['envelope', JSON.stringify({ decisions: [{ ...providerAssessment.decisions[0], evidenceQuote: 'altered quote' }, ...providerAssessment.decisions.slice(1)] }), transcript],
  ])('logs only the bounded %s label while preserving the public error contract', async (validationReason, content, candidateTranscript) => {
    const repo = repository({ claim: vi.fn(async () => ({ data: { ...claimed, transcript: candidateTranscript } })) });
    const logProviderFailure = vi.fn();
    const response = await createCandidateMmiScoringHandler(dependencies({
      repository: repo,
      callProvider: vi.fn(async () => ({ content, usage: null })),
      logProviderFailure,
    }))(scoringRequest());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'invalid_provider_response' });
    expect(repo.complete).not.toHaveBeenCalled();
    expect(logProviderFailure).toHaveBeenCalledExactlyOnceWith({ requestId: null, provider: 'anthropic', code: 'invalid_provider_response', validationReason });
    expect(JSON.stringify(logProviderFailure.mock.calls)).not.toContain('CRIT_');
    expect(JSON.stringify(logProviderFailure.mock.calls)).not.toContain('evidenceQuote');
    expect(JSON.stringify(logProviderFailure.mock.calls)).not.toContain('evidenceId');
    expect(JSON.stringify(logProviderFailure.mock.calls)).not.toContain('identify immediate risk');
  });

  it('sends exact overlapping Unicode excerpts without offsets and accepts only their server identifiers', async () => {
    const candidateTranscript = `${'😀'.repeat(140)}I would listen carefully, identify risk, and escalate safely.${' café'.repeat(80)}`;
    const repo = repository({ claim: vi.fn(async () => ({ data: { ...claimed, transcript: candidateTranscript } })) });
    const callProvider = vi.fn(async (_config: AiConfig, _request: AiProviderRequest) => ({
      content: JSON.stringify({ decisions: [{ ...providerAssessment.decisions[0], evidenceId: 'E2' }, ...providerAssessment.decisions.slice(1)] }), usage: null,
    }));
    const response = await createCandidateMmiScoringHandler(dependencies({ repository: repo, callProvider }))(scoringRequest());
    expect(response.status).toBe(200);
    const request = callProvider.mock.calls[0]?.[1];
    const content = JSON.parse(request.userContent);
    expect(content.candidateAnswer).toBe(candidateTranscript);
    expect(content.evidenceExcerpts[1]).toEqual({ evidenceId: 'E2', text: Array.from(candidateTranscript).slice(150, 450).join('') });
    expect(content.evidenceExcerpts.every((excerpt: Record<string, unknown>) => Object.keys(excerpt).sort().join(',') === 'evidenceId,text')).toBe(true);
    expect(request.responseSchema).toMatchObject({ properties: { decisions: { items: { properties: { evidenceId: { anyOf: [{ enum: content.evidenceExcerpts.map((excerpt: { evidenceId: string }) => excerpt.evidenceId) }, { type: 'null' }] } } } } } });
    const assessment = (repo.complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].p_public_assessment;
    expect(assessment).toMatchObject({ schemaVersion: 4, questionScorePct: 75 });
    expect(assessment.criteria[0].evidenceQuote).toBe(content.evidenceExcerpts[1].text);
    expect(Array.from(assessment.criteria[0].evidenceQuote).length).toBe(300);
    expect(assessment.criteria[1].evidenceQuote).toBe(content.evidenceExcerpts[0].text);
    expect(assessment.criteria[3].evidenceQuote).toBeNull();
    expect(JSON.stringify(assessment)).not.toContain('evidenceId');
    expect(JSON.stringify(assessment)).not.toContain('evidenceReference');
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
