import {
  ProviderRequestError,
  type AiConfig,
  type AiProviderRequest,
  type AiProviderResult,
  sanitizeDiagnosticRequestId,
} from '../_shared/aiProvider.ts';
import {
  createRubricResponseSchema,
  parseRubricProviderAssessment,
  toPublicRubricAssessment,
  type PublicRubricAssessment,
  type RubricCriterionSnapshot,
} from '../_shared/rubricAssessment.ts';
import { EdgeRequestError, prepareEdgeHttpRequest, readBoundedJson } from '../_shared/http.ts';
import { calculateEstimatedUsdCost } from './rates.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TRANSCRIPT_CODE_POINTS = 12_000;
const MAX_PUBLIC_TEXT_CODE_POINTS = 10_000;
const RUBRIC_SYSTEM_PROMPT = 'Judge only whether each supplied marking criterion is explicitly supported by the candidate answer. Do not award credit for fluency, length, confidence, plausibility, or ideas outside the listed criteria. Treat vague implication as not achieved. Return exactly one ordered decision for every supplied criterion and no additional fields.';

type RepositoryResult<T extends Record<string, unknown> = Record<string, never>> = T & { error?: unknown };

export type CandidateMmiUsage = Readonly<{
  provider: string;
  model: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  inputRatePerMillion: number;
  cachedInputRatePerMillion: number;
  outputRatePerMillion: number;
  currency: 'USD';
  estimatedCost: number | null;
  latencyMs: number;
  outcome: 'scored' | 'provider_failed' | 'invalid_response' | 'persistence_failed';
}>;

export interface CandidateMmiScoringRepository {
  authenticate: (authorization: string) => Promise<RepositoryResult<{ userId?: string }>>;
  claim: (args: Readonly<{ p_user_id: string; p_session_id: string; p_prompt_order: number; p_lease_token: string }>) => Promise<RepositoryResult<{ data?: unknown }>>;
  loadProviderConfig: () => Promise<RepositoryResult<{ config?: AiConfig }>>;
  complete: (args: Readonly<{ p_response_id: string; p_session_id: string; p_lease_token: string; p_public_assessment: PublicRubricAssessment; p_usage: CandidateMmiUsage }>) => Promise<RepositoryResult<{ data?: unknown }>>;
  fail: (args: Readonly<{ p_response_id: string; p_session_id: string; p_lease_token: string; p_error_code: string; p_usage: CandidateMmiUsage | null }>) => Promise<RepositoryResult>;
}

type ProviderName = 'anthropic' | 'openai' | 'openai_compatible' | 'unknown';
export type CandidateMmiProviderFailureDiagnostic = Readonly<{ requestId: string | null; provider: ProviderName; status?: number; code: 'provider_failed' | 'invalid_provider_response' }>;
export interface CandidateMmiScoringDependencies {
  repository: CandidateMmiScoringRepository;
  allowedOrigins: string;
  createLeaseToken: () => string;
  callProvider: (config: AiConfig, request: AiProviderRequest) => Promise<AiProviderResult>;
  logProviderFailure: (diagnostic: CandidateMmiProviderFailureDiagnostic) => void;
}

type ScoringRequest = Readonly<{ sessionId: string; promptOrder: number }>;
type ClaimedResponse = Readonly<{ status: 'claimed'; responseId: string; sessionId: string; promptOrder: number; scenarioText: string; promptText: string; transcript: string; criteria: readonly RubricCriterionSnapshot[]; scoringContractVersion: string }>;
type TerminalClaim =
  | Readonly<{ status: 'not_ready' }>
  | Readonly<{ status: 'no_response' }>
  | Readonly<{ status: 'in_progress' }>
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'scored' }>;
type Claim = TerminalClaim | ClaimedResponse;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(); const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}
function codePointLength(value: string): number { return Array.from(value).length; }
function boundedText(value: unknown, max = MAX_PUBLIC_TEXT_CODE_POINTS): value is string {
  return typeof value === 'string' && value.trim().length > 0 && codePointLength(value) <= max;
}
function parseRequest(value: unknown): ScoringRequest | null {
  const input = asRecord(value);
  if (!input || !hasExactKeys(input, ['sessionId', 'promptOrder']) || typeof input.sessionId !== 'string' || !UUID_PATTERN.test(input.sessionId) || !Number.isInteger(input.promptOrder) || (input.promptOrder as number) < 1 || (input.promptOrder as number) > 5) return null;
  return { sessionId: input.sessionId, promptOrder: input.promptOrder as number };
}
function parseCriteria(value: unknown): readonly RubricCriterionSnapshot[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
  const criteria: RubricCriterionSnapshot[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    const criterion = asRecord(item);
    if (!criterion || !hasExactKeys(criterion, ['criterionId', 'bulletText', 'domain']) || !boundedText(criterion.criterionId, 100) || !boundedText(criterion.bulletText, 2_000) || !(criterion.domain === null || boundedText(criterion.domain, 100)) || ids.has(criterion.criterionId)) return null;
    ids.add(criterion.criterionId);
    criteria.push(Object.freeze({ criterionId: criterion.criterionId, bulletText: criterion.bulletText, domain: criterion.domain as string | null }));
  }
  return Object.freeze(criteria);
}
function parseClaim(value: unknown, request: ScoringRequest): Claim | null {
  const claim = asRecord(value);
  if (!claim || typeof claim.status !== 'string') return null;
  if (hasExactKeys(claim, ['status'])) {
    if (claim.status === 'not_ready') return { status: 'not_ready' };
    if (claim.status === 'no_response') return { status: 'no_response' };
    if (claim.status === 'in_progress') return { status: 'in_progress' };
    if (claim.status === 'unavailable') return { status: 'unavailable' };
    if (claim.status === 'scored') return { status: 'scored' };
  }
  if (!hasExactKeys(claim, ['status', 'responseId', 'sessionId', 'promptOrder', 'scenarioText', 'promptText', 'transcript', 'criteria', 'scoringContractVersion']) || claim.status !== 'claimed' || typeof claim.responseId !== 'string' || !UUID_PATTERN.test(claim.responseId) || claim.sessionId !== request.sessionId || claim.promptOrder !== request.promptOrder || !boundedText(claim.scenarioText) || !boundedText(claim.promptText) || !boundedText(claim.transcript, MAX_TRANSCRIPT_CODE_POINTS) || !boundedText(claim.scoringContractVersion, 100)) return null;
  const criteria = parseCriteria(claim.criteria);
  return criteria === null ? null : Object.freeze({ status: 'claimed', responseId: claim.responseId, sessionId: request.sessionId, promptOrder: request.promptOrder, scenarioText: claim.scenarioText, promptText: claim.promptText, transcript: claim.transcript, criteria, scoringContractVersion: claim.scoringContractVersion });
}
function providerName(value: string): ProviderName { return value === 'anthropic' || value === 'openai' || value === 'openai_compatible' ? value : 'unknown'; }
function monotonicNow(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
function usageFor(config: AiConfig, result: AiProviderResult | null, latencyMs: number, outcome: CandidateMmiUsage['outcome']): CandidateMmiUsage {
  const usage = result?.usage ?? null;
  const estimatedCost = usage === null ? null : calculateEstimatedUsdCost(usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, config.inputRatePerMillion, config.cachedInputRatePerMillion, config.outputRatePerMillion);
  return Object.freeze({ provider: config.provider, model: config.model, inputTokens: usage?.inputTokens ?? null, cachedInputTokens: usage?.cachedInputTokens ?? null, outputTokens: usage?.outputTokens ?? null, inputRatePerMillion: config.inputRatePerMillion, cachedInputRatePerMillion: config.cachedInputRatePerMillion, outputRatePerMillion: config.outputRatePerMillion, currency: 'USD', estimatedCost, latencyMs: Math.max(0, Math.round(latencyMs)), outcome });
}
function completionSucceeded(value: unknown): boolean { const result = asRecord(value); return result !== null && hasExactKeys(result, ['status']) && result.status === 'scored'; }
async function failClaimSafely(repository: CandidateMmiScoringRepository, claim: ClaimedResponse, leaseToken: string, errorCode: string, usage: CandidateMmiUsage | null): Promise<void> {
  try { await repository.fail({ p_response_id: claim.responseId, p_session_id: claim.sessionId, p_lease_token: leaseToken, p_error_code: errorCode, p_usage: usage }); } catch { /* preserve private failure details */ }
}

export function createCandidateMmiScoringHandler(dependencies: CandidateMmiScoringDependencies): (request: Request) => Promise<Response> {
  const { repository, allowedOrigins, createLeaseToken, callProvider, logProviderFailure } = dependencies;
  return async (request) => {
    const http = prepareEdgeHttpRequest(request, allowedOrigins);
    if (http.response) return http.response;
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return http.json({ code: 'unauthorized' }, 401);
    let authentication: RepositoryResult<{ userId?: string }>;
    try { authentication = await repository.authenticate(authorization); } catch { return http.json({ code: 'unauthorized' }, 401); }
    if (authentication.error || typeof authentication.userId !== 'string' || !UUID_PATTERN.test(authentication.userId)) return http.json({ code: 'unauthorized' }, 401);
    let input: ScoringRequest | null;
    try { input = parseRequest(await readBoundedJson(request, 4_096)); } catch (error) { return http.json({ code: 'invalid_request' }, error instanceof EdgeRequestError ? error.status : 400); }
    if (!input) return http.json({ code: 'invalid_request' }, 400);
    let leaseToken: string;
    try { leaseToken = createLeaseToken(); } catch { return http.json({ code: 'unavailable' }, 500); }
    if (!UUID_PATTERN.test(leaseToken)) return http.json({ code: 'unavailable' }, 500);
    let claimResult: RepositoryResult<{ data?: unknown }>;
    try { claimResult = await repository.claim({ p_user_id: authentication.userId, p_session_id: input.sessionId, p_prompt_order: input.promptOrder, p_lease_token: leaseToken }); } catch { return http.json({ code: 'unavailable' }, 500); }
    const claim = claimResult.error ? null : parseClaim(claimResult.data, input);
    if (!claim) return http.json({ code: 'unavailable' }, 500);
    if (claim.status === 'not_ready') return http.json({ code: 'not_ready' }, 409, { 'Retry-After': '3' });
    if (claim.status === 'no_response') return http.json({ status: 'no_response' });
    if (claim.status === 'in_progress') return http.json({ code: 'in_progress' }, 409, { 'Retry-After': '3' });
    if (claim.status === 'unavailable') return http.json({ code: 'unavailable' }, 503);
    if (claim.status === 'scored') return http.json({ status: 'scored' });
    let configuration: RepositoryResult<{ config?: AiConfig }>;
    try { configuration = await repository.loadProviderConfig(); } catch { await failClaimSafely(repository, claim, leaseToken, 'persistence_failed', null); return http.json({ code: 'unavailable' }, 500); }
    if (configuration.error) { await failClaimSafely(repository, claim, leaseToken, 'persistence_failed', null); return http.json({ code: 'unavailable' }, 500); }
    if (!configuration.config) { await failClaimSafely(repository, claim, leaseToken, 'provider_not_configured', null); return http.json({ code: 'provider_not_configured' }, 503); }
    const config = configuration.config;
    const startedAt = monotonicNow();
    let providerResult: AiProviderResult;
    try {
      providerResult = await callProvider(config, { systemPrompt: RUBRIC_SYSTEM_PROMPT, userContent: JSON.stringify({ scenarioText: claim.scenarioText, questionText: claim.promptText, criteria: claim.criteria, candidateAnswer: claim.transcript }), maxTokens: 768, responseSchema: createRubricResponseSchema(claim.criteria) });
    } catch (error) {
      const usage = usageFor(config, null, monotonicNow() - startedAt, 'provider_failed');
      if (error instanceof ProviderRequestError) { try { logProviderFailure({ requestId: sanitizeDiagnosticRequestId(request.headers.get('x-request-id')) ?? null, provider: providerName(config.provider), ...(error.status === undefined ? {} : { status: error.status }), code: 'provider_failed' }); } catch { /* diagnostics cannot affect scoring */ } }
      await failClaimSafely(repository, claim, leaseToken, 'provider_failed', usage);
      return http.json({ code: 'provider_failed' }, 502);
    }
    const latencyMs = monotonicNow() - startedAt;
    let assessment: PublicRubricAssessment;
    try { assessment = toPublicRubricAssessment(parseRubricProviderAssessment(providerResult.content, claim.criteria, claim.transcript), claim.criteria, claim.transcript); } catch {
      const usage = usageFor(config, providerResult, latencyMs, 'invalid_response');
      try { logProviderFailure({ requestId: sanitizeDiagnosticRequestId(request.headers.get('x-request-id')) ?? null, provider: providerName(config.provider), code: 'invalid_provider_response' }); } catch { /* diagnostics cannot affect scoring */ }
      await failClaimSafely(repository, claim, leaseToken, 'invalid_provider_response', usage);
      return http.json({ code: 'invalid_provider_response' }, 502);
    }
    const usage = usageFor(config, providerResult, latencyMs, 'scored');
    let completion: RepositoryResult<{ data?: unknown }>;
    try { completion = await repository.complete({ p_response_id: claim.responseId, p_session_id: claim.sessionId, p_lease_token: leaseToken, p_public_assessment: assessment, p_usage: usage }); } catch { await failClaimSafely(repository, claim, leaseToken, 'persistence_failed', usageFor(config, providerResult, latencyMs, 'persistence_failed')); return http.json({ code: 'unavailable' }, 500); }
    if (completion.error || !completionSucceeded(completion.data)) { await failClaimSafely(repository, claim, leaseToken, 'persistence_failed', usageFor(config, providerResult, latencyMs, 'persistence_failed')); return http.json({ code: 'unavailable' }, 500); }
    return http.json({ status: 'scored' });
  };
}
