import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ProviderRequestError,
  type AiConfig,
  type AiProviderRequest,
} from '../supabase/functions/_shared/aiProvider.ts';
import {
  getCurrentMmiRubric,
  getCurrentMmiScoringContract,
} from '../supabase/functions/_shared/mmiScoringContract.ts';
import {
  createCandidateMmiScoringHandler,
  type CandidateMmiScoringDependencies,
  type CandidateMmiScoringRepository,
} from '../supabase/functions/score-candidate-mmi-response/handler.ts';
import {
  CandidateMmiScoringError,
  createCandidateMmiScoringApi,
} from '../src/features/candidateMmi/scoringApi';

const allowedOrigin = 'https://preview.example.test';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = '11111111-1111-4111-8111-111111111111';
const responseId = '22222222-2222-4222-8222-222222222222';
const leaseToken = '33333333-3333-4333-8333-333333333333';
const transcript = 'I would prioritise patient safety, explain the options, and escalate any immediate risk.';
const promptText = 'How would you respond to this situation?';

const rubric = getCurrentMmiRubric();
const scoringContract = getCurrentMmiScoringContract();

const providerAssessment = Object.freeze({
  dimensions: {
    structure: { score: 4, evidenceReference: { start: 0, end: 1 } },
    ethics: { score: 4, evidenceReference: { start: 0, end: 1 } },
    communication: { score: 4, evidenceReference: { start: 0, end: 1 } },
    reflection: { score: 4, evidenceReference: { start: 0, end: 1 } },
    nhs_awareness: { score: 4, evidenceReference: { start: 0, end: 1 } },
  },
  rubricStrengthCodes: ['clear-priorities'],
  rubricImprovementCodes: ['explicit-plan'],
  safetyCriticalOmissionCodes: [],
  improvementFramework: 'sbar',
});

const publicAssessment = Object.freeze({
  dimensions: {
    structure: {
      score: 4,
      applicable: true,
      evidence: 'I',
      improvement: 'Make the safety-netting steps explicit, including when and how you would escalate.',
    },
    ethics: { score: 4, applicable: true, evidence: 'I', improvement: null },
    communication: { score: 4, applicable: true, evidence: 'I', improvement: null },
    reflection: { score: 4, applicable: true, evidence: 'I', improvement: null },
    nhs_awareness: { score: 4, applicable: true, evidence: 'I', improvement: null },
  },
  overallPct: 80,
  strengths: ['You set out the main priorities in a clear and logical order.'],
  improvements: ['Make the safety-netting steps explicit, including when and how you would escalate.'],
  improvementTip: 'Use SBAR to organise a concise escalation: situation, background, assessment, then recommendation.',
  rubricVersion: 2,
});

const providerConfig: AiConfig = Object.freeze({
  provider: 'anthropic',
  model: 'synthetic-model',
  apiKey: ['synthetic', 'test', 'value'].join('-'),
  baseUrl: null,
});

const claimed = Object.freeze({
  status: 'claimed',
  responseId,
  sessionId,
  promptOrder: 1,
  transcript,
  promptText,
});

function repository(
  overrides: Partial<CandidateMmiScoringRepository> = {},
): CandidateMmiScoringRepository {
  return {
    authenticate: vi.fn(async () => ({ userId })),
    claim: vi.fn(async () => ({ data: claimed })),
    loadProviderConfig: vi.fn(async () => ({ config: providerConfig })),
    complete: vi.fn(async () => ({ data: { status: 'scored' } })),
    fail: vi.fn(async () => ({})),
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<CandidateMmiScoringDependencies> = {},
): CandidateMmiScoringDependencies {
  return {
    repository: repository(),
    allowedOrigins: allowedOrigin,
    createLeaseToken: () => leaseToken,
    callProvider: vi.fn(async () => JSON.stringify(providerAssessment)),
    logProviderFailure: vi.fn(),
    ...overrides,
  };
}

function scoringRequest(
  body: string | undefined = JSON.stringify({ sessionId, promptOrder: 1 }),
  init: {
    method?: string;
    origin?: string | null;
    contentType?: string;
    authorization?: string;
    contentLength?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (init.origin !== null) headers.set('Origin', init.origin ?? allowedOrigin);
  if (init.contentType !== '') {
    headers.set('Content-Type', init.contentType ?? 'application/json');
  }
  if (init.authorization !== '') {
    headers.set('Authorization', init.authorization ?? 'Bearer valid-token');
  }
  if (init.contentLength) headers.set('Content-Length', init.contentLength);
  const method = init.method ?? 'POST';
  return new Request('http://localhost/functions/v1/score-candidate-mmi-response', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : body,
  });
}

describe('candidate MMI scoring handler security boundary', () => {
  it('applies origin, method, authentication, and bounded exact-body checks before claiming', async () => {
    const repo = repository();
    const handler = createCandidateMmiScoringHandler(
      dependencies({ repository: repo }),
    );

    const forbiddenOrigin = await handler(
      scoringRequest(undefined, { origin: 'https://attacker.example' }),
    );
    expect(forbiddenOrigin.status).toBe(403);

    const options = await handler(scoringRequest(undefined, { method: 'OPTIONS' }));
    expect(options.status).toBe(204);

    const missingAuth = await handler(
      scoringRequest(undefined, { authorization: '' }),
    );
    expect(missingAuth.status).toBe(401);

    const oversized = await handler(
      scoringRequest('{}', { contentLength: '4097' }),
    );
    expect(oversized.status).toBe(413);

    const expanded = await handler(
      scoringRequest(JSON.stringify({ sessionId, promptOrder: 1, transcript: 'browser text' })),
    );
    expect(expanded.status).toBe(400);
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('binds the verified user and secure lease token to the exact scoring claim', async () => {
    const repo = repository();
    const handler = createCandidateMmiScoringHandler(
      dependencies({ repository: repo }),
    );

    const response = await handler(scoringRequest());

    expect(response.status).toBe(200);
    expect(repo.authenticate).toHaveBeenCalledExactlyOnceWith('Bearer valid-token');
    expect(repo.claim).toHaveBeenCalledExactlyOnceWith({
      p_user_id: userId,
      p_session_id: sessionId,
      p_prompt_order: 1,
      p_lease_token: leaseToken,
    });
  });

  it.each(['no_response'] as const)(
    'returns terminal %s without loading config or calling a provider',
    async (status) => {
      const repo = repository({ claim: vi.fn(async () => ({ data: { status } })) });
      const callProvider = vi.fn();
      const response = await createCandidateMmiScoringHandler(
        dependencies({ repository: repo, callProvider }),
      )(scoringRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status });
      expect(repo.loadProviderConfig).not.toHaveBeenCalled();
      expect(callProvider).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['not_ready', 409],
    ['unavailable', 503],
  ] as const)('returns safe %s state before configuration or provider work', async (status, httpStatus) => {
    const repo = repository({ claim: vi.fn(async () => ({ data: { status } })) });
    const callProvider = vi.fn();
    const response = await createCandidateMmiScoringHandler(
      dependencies({ repository: repo, callProvider }),
    )(scoringRequest());

    expect(response.status).toBe(httpStatus);
    expect(await response.json()).toEqual({ code: status });
    expect(repo.loadProviderConfig).not.toHaveBeenCalled();
    expect(repo.complete).not.toHaveBeenCalled();
    expect(repo.fail).not.toHaveBeenCalled();
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('returns in-progress with a retry hint and no provider work', async () => {
    const repo = repository({
      claim: vi.fn(async () => ({ data: { status: 'in_progress' } })),
    });
    const callProvider = vi.fn();
    const response = await createCandidateMmiScoringHandler(
      dependencies({ repository: repo, callProvider }),
    )(scoringRequest());

    expect(response.status).toBe(409);
    expect(response.headers.get('Retry-After')).toBe('3');
    expect(await response.json()).toEqual({ code: 'in_progress' });
    expect(callProvider).not.toHaveBeenCalled();
  });

  it('returns only a validated stored public assessment without provider work', async () => {
    const repo = repository({
      claim: vi.fn(async () => ({
        data: { status: 'scored', assessment: publicAssessment },
      })),
    });
    const callProvider = vi.fn();
    const response = await createCandidateMmiScoringHandler(
      dependencies({ repository: repo, callProvider }),
    )(scoringRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'scored', assessment: publicAssessment });
    expect(callProvider).not.toHaveBeenCalled();

    const invalidRepo = repository({
      claim: vi.fn(async () => ({
        data: {
          status: 'scored',
          assessment: { ...publicAssessment, providerBody: 'private' },
        },
      })),
    });
    const invalid = await createCandidateMmiScoringHandler(
      dependencies({ repository: invalidRepo }),
    )(scoringRequest());
    expect(invalid.status).toBe(500);
    expect(await invalid.json()).toEqual({ code: 'unavailable' });
  });

  it('rejects database-supplied grading rules so only built-in criteria can reach the provider', async () => {
    const repo = repository({
      claim: vi.fn(async () => ({
        data: { ...claimed, rubric: { version: 999 } },
      })),
    });
    const callProvider = vi.fn();
    const response = await createCandidateMmiScoringHandler(
      dependencies({ repository: repo, callProvider }),
    )(scoringRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'unavailable' });
    expect(callProvider).not.toHaveBeenCalled();
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it('scores server-claimed text through built-in criteria and completes the matching lease', async () => {
    const repo = repository();
    const callProvider = vi.fn(
      async (_config: AiConfig, _request: AiProviderRequest) =>
        JSON.stringify(providerAssessment),
    );
    const response = await createCandidateMmiScoringHandler(
      dependencies({ repository: repo, callProvider }),
    )(scoringRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'scored', assessment: publicAssessment });
    expect(callProvider).toHaveBeenCalledTimes(1);
    const [config, providerRequest] = callProvider.mock.calls[0]!;
    expect(config).toEqual(providerConfig);
    expect(providerRequest.systemPrompt.toLowerCase()).toMatch(/accent/);
    expect(providerRequest.systemPrompt.toLowerCase()).toMatch(/delivery/);
    expect(providerRequest.systemPrompt.toLowerCase()).toMatch(/pace/);
    expect(providerRequest.systemPrompt.toLowerCase()).toMatch(/tone/);
    expect(providerRequest.systemPrompt.toLowerCase()).toMatch(/hesitation/);
    expect(providerRequest.systemPrompt.toLowerCase()).toMatch(/pronunciation/);
    const providerSchemaProperties = (
      providerRequest.responseSchema as {
        properties: Record<string, { items?: unknown }>;
      }
    ).properties;
    expect(providerSchemaProperties.rubricStrengthCodes?.items).toEqual({
      type: 'string',
      enum: [
        'clear-priorities',
        'balanced-ethical-reasoning',
        'patient-centred-language',
        'reflective-learning',
        'nhs-context',
      ],
    });
    expect(providerSchemaProperties.rubricImprovementCodes?.items).toEqual({
      type: 'string',
      enum: [
        'explicit-plan',
        'weigh-ethical-pillars',
        'check-understanding',
        'deepen-reflection',
        'connect-nhs-values',
      ],
    });
    expect(providerSchemaProperties.safetyCriticalOmissionCodes?.items).toEqual({
      type: 'string',
      enum: [
        'escalate-immediate-risk',
        'protect-confidentiality',
        'seek-senior-support',
      ],
    });
    const storedSchemaProperties = (
      scoringContract.responseSchema as {
        properties: Record<string, { items?: unknown }>;
      }
    ).properties;
    expect(storedSchemaProperties.rubricImprovementCodes?.items).not.toHaveProperty('enum');
    expect(JSON.parse(providerRequest.userContent)).toEqual({
      promptText,
      transcript,
      rubric,
      scoringContract,
    });
    expect(repo.complete).toHaveBeenCalledExactlyOnceWith({
      p_response_id: responseId,
      p_session_id: sessionId,
      p_lease_token: leaseToken,
      p_public_assessment: publicAssessment,
    });
  });

  it('logs only a safe schema-stage reason for invalid provider output', async () => {
    const repo = repository();
    const logProviderFailure = vi.fn();
    const response = await createCandidateMmiScoringHandler(
      dependencies({
        repository: repo,
        callProvider: vi.fn(async () => JSON.stringify({ private: transcript })),
        logProviderFailure,
      }),
    )(scoringRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'invalid_provider_response' });
    expect(repo.fail).toHaveBeenCalledExactlyOnceWith({
      p_response_id: responseId,
      p_session_id: sessionId,
      p_lease_token: leaseToken,
      p_error_code: 'invalid_provider_response',
    });
    expect(logProviderFailure).toHaveBeenCalledExactlyOnceWith({
      requestId: null,
      provider: 'anthropic',
      code: 'invalid_provider_response',
      stage: 'response_schema',
      reason: 'schema_mismatch',
    });
    const diagnostic = JSON.stringify(logProviderFailure.mock.calls);
    for (const privateValue of [transcript, promptText, providerConfig.apiKey]) {
      expect(diagnostic).not.toContain(privateValue);
    }
  });

  it('logs a safe contract reason when evidence positions exceed the transcript', async () => {
    const repo = repository();
    const logProviderFailure = vi.fn();
    const invalidEvidenceAssessment = {
      ...providerAssessment,
      dimensions: {
        ...providerAssessment.dimensions,
        structure: {
          score: 4,
          evidenceReference: { start: 0, end: 120 },
        },
      },
    };

    const response = await createCandidateMmiScoringHandler(
      dependencies({
        repository: repo,
        callProvider: vi.fn(async () => JSON.stringify(invalidEvidenceAssessment)),
        logProviderFailure,
      }),
    )(scoringRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'invalid_provider_response' });
    expect(logProviderFailure).toHaveBeenCalledExactlyOnceWith({
      requestId: null,
      provider: 'anthropic',
      code: 'invalid_provider_response',
      stage: 'contract_validation',
      reason: 'evidence_reference',
    });
    const diagnostic = JSON.stringify(logProviderFailure.mock.calls);
    for (const privateValue of [transcript, promptText, providerConfig.apiKey]) {
      expect(diagnostic).not.toContain(privateValue);
    }
  });

  it('emits only an allowlisted diagnostic for provider request failures', async () => {
    const repo = repository();
    const logProviderFailure = vi.fn();
    const response = await createCandidateMmiScoringHandler(
      dependencies({
        repository: repo,
        callProvider: vi.fn(async () => {
          throw new ProviderRequestError('http', {
            status: 503,
            providerRequestId: 'provider-private-id',
          });
        }),
        logProviderFailure,
      }),
    )(
      scoringRequest(undefined, {
        authorization: 'Bearer private-jwt',
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: 'provider_failed' });
    expect(logProviderFailure).toHaveBeenCalledExactlyOnceWith({
      requestId: null,
      provider: 'anthropic',
      status: 503,
      code: 'provider_failed',
    });
    const diagnostic = JSON.stringify(logProviderFailure.mock.calls);
    for (const privateValue of [transcript, promptText, 'private-jwt', 'provider-private-id', providerConfig.apiKey]) {
      expect(diagnostic).not.toContain(privateValue);
    }
  });

  it('fails an acquired lease when configuration or completion is unavailable', async () => {
    const configRepo = repository({
      loadProviderConfig: vi.fn(async () => ({})),
    });
    const configResponse = await createCandidateMmiScoringHandler(
      dependencies({ repository: configRepo }),
    )(scoringRequest());
    expect(configResponse.status).toBe(503);
    expect(await configResponse.json()).toEqual({ code: 'provider_not_configured' });
    expect(configRepo.fail).toHaveBeenCalledWith({
      p_response_id: responseId,
      p_session_id: sessionId,
      p_lease_token: leaseToken,
      p_error_code: 'provider_not_configured',
    });

    const completionRepo = repository({
      complete: vi.fn(async () => ({ error: new Error('private database detail') })),
    });
    const completionResponse = await createCandidateMmiScoringHandler(
      dependencies({ repository: completionRepo }),
    )(scoringRequest());
    expect(completionResponse.status).toBe(500);
    expect(await completionResponse.json()).toEqual({ code: 'unavailable' });
    expect(completionRepo.fail).toHaveBeenCalledWith({
      p_response_id: responseId,
      p_session_id: sessionId,
      p_lease_token: leaseToken,
      p_error_code: 'persistence_failed',
    });
  });
});

describe('candidate MMI browser scoring boundary', () => {
  it('sends only session identity and prompt order and validates the public result', async () => {
    const invoke = vi.fn(async () => ({
      data: { status: 'scored', assessment: publicAssessment },
      error: null,
    }));
    const api = createCandidateMmiScoringApi(invoke);

    await expect(api.scoreCandidateResponse(sessionId, 1)).resolves.toEqual({
      status: 'scored',
      assessment: publicAssessment,
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('score-candidate-mmi-response', {
      body: { sessionId, promptOrder: 1 },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain(transcript);
  });

  it('rejects invalid input and malformed success without invoking or rendering it', async () => {
    const invoke = vi.fn();
    const api = createCandidateMmiScoringApi(invoke);
    await expect(api.scoreCandidateResponse('not-a-uuid', 0 as never)).rejects.toBeInstanceOf(
      CandidateMmiScoringError,
    );
    expect(invoke).not.toHaveBeenCalled();

    const malformedApi = createCandidateMmiScoringApi(async () => ({
      data: {
        status: 'scored',
        assessment: { ...publicAssessment, transcript: 'private' },
      },
      error: null,
    }));
    await expect(malformedApi.scoreCandidateResponse(sessionId, 1)).rejects.toMatchObject({
      code: 'unavailable',
    } as CandidateMmiScoringError);
  });

  it.each([
    ['not_ready', 'AI scoring starts after the station is complete.'],
    ['in_progress', 'This response is already being scored.'],
    ['provider_not_configured', 'AI scoring is not configured yet.'],
    ['provider_failed', 'AI scoring is temporarily unavailable. Try again.'],
    ['invalid_provider_response', 'The AI scorer returned an invalid result. Try again.'],
    ['unauthorized', 'Sign in again before requesting feedback.'],
    ['unavailable', 'AI scoring is unavailable. Try again.'],
  ] as const)('maps allowlisted code %s to fixed copy', async (code, message) => {
    const context = new Response(JSON.stringify({ code, detail: transcript }), {
      status: 500,
    });
    const api = createCandidateMmiScoringApi(async () => ({
      data: null,
      error: { context },
    }));

    const error = await api.scoreCandidateResponse(sessionId, 1).catch((caught) => caught);
    expect(error).toBeInstanceOf(CandidateMmiScoringError);
    expect(error).toMatchObject({ code, message });
    expect(error.message).not.toContain(transcript);
  });

  it('maps unknown server bodies to unavailable without echoing them', async () => {
    const context = new Response(
      JSON.stringify({ code: 'private_database_error', detail: transcript }),
      { status: 500 },
    );
    const api = createCandidateMmiScoringApi(async () => ({
      data: null,
      error: { context },
    }));

    await expect(api.scoreCandidateResponse(sessionId, 1)).rejects.toMatchObject({
      code: 'unavailable',
      message: 'AI scoring is unavailable. Try again.',
    } as CandidateMmiScoringError);
  });

  it('keeps Deno wiring server-owned and leaves legacy scoring byte-for-byte untouched', () => {
    const index = readFileSync(
      resolve(process.cwd(), 'supabase/functions/score-candidate-mmi-response/index.ts'),
      'utf8',
    );
    expect(index).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
    expect(index).toContain("Deno.env.get('SUPABASE_ANON_KEY')");
    expect(index).toContain('auth.getUser()');
    expect(index).toContain("rpc('claim_candidate_mmi_response_scoring'");
    expect(index).toContain("rpc('complete_candidate_mmi_response_scoring'");
    expect(index).toContain("rpc('fail_candidate_mmi_response_scoring'");
    expect(index).toContain('callConfiguredProvider');
    expect(index).not.toMatch(/body[^;]*(?:transcript|promptText|rubric)/s);
    const supabaseConfig = readFileSync(
      resolve(process.cwd(), 'supabase/config.toml'),
      'utf8',
    );
    expect(supabaseConfig).toMatch(
      /\[functions\.score-candidate-mmi-response\]\s+verify_jwt\s*=\s*true/,
    );
    expect(
      readFileSync(resolve(process.cwd(), 'supabase/functions/score-answer/index.ts'), 'utf8'),
    ).not.toContain('score-candidate-mmi-response');
  });
});
