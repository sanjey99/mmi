import {
  ProviderRequestError,
  sanitizeDiagnosticRequestId,
  type AiConfig,
  type AiProviderRequest,
} from '../_shared/aiProvider.ts';
import {
  createMmiPublicOutputContext,
  MMI_DIMENSIONS,
  toPublicMmiAssessment,
  type MmiAssessment,
  type MmiDimension,
  type MmiDimensionResult,
  type MmiRubric,
} from '../_shared/mmiContracts.ts';
import {
  getCurrentMmiRubric,
  getCurrentMmiScoringContract,
  parseProviderAssessmentForContract,
  validateJsonSchema,
  type MmiScoringContract,
} from '../_shared/mmiScoringContract.ts';
import {
  EdgeRequestError,
  prepareEdgeHttpRequest,
  readBoundedJson,
} from '../_shared/http.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TRANSCRIPT_CODE_POINTS = 12_000;
const MAX_PUBLIC_TEXT_CODE_POINTS = 1_000;
const MAX_PUBLIC_TEXT_ITEMS = 20;
const SCORING_SYSTEM_SUFFIX =
  'Assess only the written transcript. Do not assess accent, delivery, pace, tone, hesitation, or pronunciation.';

type RepositoryResult<T extends Record<string, unknown> = Record<string, never>> =
  T & { error?: unknown };

export interface CandidateMmiScoringRepository {
  authenticate: (
    authorization: string,
  ) => Promise<RepositoryResult<{ userId?: string }>>;
  claim: (
    args: Readonly<{
      p_user_id: string;
      p_session_id: string;
      p_prompt_order: number;
      p_lease_token: string;
    }>,
  ) => Promise<RepositoryResult<{ data?: unknown }>>;
  loadProviderConfig: () => Promise<RepositoryResult<{ config?: AiConfig }>>;
  complete: (
    args: Readonly<{
      p_response_id: string;
      p_session_id: string;
      p_lease_token: string;
      p_public_assessment: MmiAssessment;
    }>,
  ) => Promise<RepositoryResult<{ data?: unknown }>>;
  fail: (
    args: Readonly<{
      p_response_id: string;
      p_session_id: string;
      p_lease_token: string;
      p_error_code: string;
    }>,
  ) => Promise<RepositoryResult>;
}

type CandidateMmiProvider =
  | 'anthropic'
  | 'openai'
  | 'openai_compatible'
  | 'unknown';

type CandidateMmiInvalidProviderResponseStage =
  | 'json_parse'
  | 'response_schema'
  | 'contract_validation'
  | 'public_mapping';

type CandidateMmiInvalidProviderResponseReason =
  | 'malformed_json'
  | 'schema_mismatch'
  | 'evidence_reference'
  | 'dimension_score'
  | 'rubric_strength_codes'
  | 'rubric_improvement_codes'
  | 'safety_codes'
  | 'improvement_framework'
  | 'other';

export type CandidateMmiProviderFailureDiagnostic =
  | Readonly<{
      requestId: string | null;
      provider: CandidateMmiProvider;
      status?: number;
      code: 'provider_failed';
    }>
  | Readonly<{
      requestId: string | null;
      provider: CandidateMmiProvider;
      code: 'invalid_provider_response';
      stage: CandidateMmiInvalidProviderResponseStage;
      reason: CandidateMmiInvalidProviderResponseReason;
    }>;

export interface CandidateMmiScoringDependencies {
  repository: CandidateMmiScoringRepository;
  allowedOrigins: string;
  createLeaseToken: () => string;
  callProvider: (
    config: AiConfig,
    request: AiProviderRequest,
  ) => Promise<unknown>;
  logProviderFailure: (
    diagnostic: CandidateMmiProviderFailureDiagnostic,
  ) => void;
}

type CandidateMmiScoringRequest = Readonly<{
  sessionId: string;
  promptOrder: number;
}>;

type ClaimedResponse = Readonly<{
  status: 'claimed';
  responseId: string;
  sessionId: string;
  promptOrder: number;
  transcript: string;
  promptText: string;
}>;

type CandidateMmiScoringClaim =
  | Readonly<{ status: 'not_ready' }>
  | Readonly<{ status: 'no_response' }>
  | Readonly<{ status: 'in_progress' }>
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'scored'; assessment: MmiAssessment }>
  | ClaimedResponse;

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isPublicText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    codePointLength(value) <= MAX_PUBLIC_TEXT_CODE_POINTS
  );
}

function parsePublicTextArray(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > MAX_PUBLIC_TEXT_ITEMS ||
    !value.every(isPublicText)
  ) {
    return null;
  }
  return [...value];
}

function parsePublicDimension(value: unknown): MmiDimensionResult | null {
  const dimension = record(value);
  if (
    dimension === null ||
    !hasExactKeys(dimension, [
      'score',
      'applicable',
      'evidence',
      'improvement',
    ]) ||
    typeof dimension.applicable !== 'boolean'
  ) {
    return null;
  }
  if (!dimension.applicable) {
    if (
      dimension.score !== null ||
      dimension.evidence !== null ||
      dimension.improvement !== null
    ) {
      return null;
    }
    return {
      score: null,
      applicable: false,
      evidence: null,
      improvement: null,
    };
  }
  if (
    typeof dimension.score !== 'number' ||
    !Number.isInteger(dimension.score) ||
    dimension.score < 1 ||
    dimension.score > 5 ||
    !(dimension.evidence === null || isPublicText(dimension.evidence)) ||
    !(dimension.improvement === null || isPublicText(dimension.improvement))
  ) {
    return null;
  }
  return {
    score: dimension.score as 1 | 2 | 3 | 4 | 5,
    applicable: true,
    evidence: dimension.evidence,
    improvement: dimension.improvement,
  };
}

function parsePublicAssessment(value: unknown): MmiAssessment | null {
  const assessment = record(value);
  if (
    assessment === null ||
    !hasExactKeys(assessment, [
      'dimensions',
      'overallPct',
      'strengths',
      'improvements',
      'improvementTip',
      'rubricVersion',
    ]) ||
    typeof assessment.overallPct !== 'number' ||
    !Number.isFinite(assessment.overallPct) ||
    assessment.overallPct < 0 ||
    assessment.overallPct > 100 ||
    typeof assessment.rubricVersion !== 'number' ||
    !Number.isInteger(assessment.rubricVersion) ||
    assessment.rubricVersion < 1 ||
    !isPublicText(assessment.improvementTip)
  ) {
    return null;
  }
  const rawDimensions = record(assessment.dimensions);
  if (rawDimensions === null || !hasExactKeys(rawDimensions, MMI_DIMENSIONS)) {
    return null;
  }
  const dimensions = {} as Record<MmiDimension, MmiDimensionResult>;
  for (const name of MMI_DIMENSIONS) {
    const parsed = parsePublicDimension(rawDimensions[name]);
    if (parsed === null) return null;
    dimensions[name] = parsed;
  }
  const strengths = parsePublicTextArray(assessment.strengths);
  const improvements = parsePublicTextArray(assessment.improvements);
  if (strengths === null || improvements === null) return null;
  return {
    dimensions,
    overallPct: assessment.overallPct,
    strengths,
    improvements,
    improvementTip: assessment.improvementTip,
    rubricVersion: assessment.rubricVersion,
  };
}

function parseRequest(value: unknown): CandidateMmiScoringRequest | null {
  const input = record(value);
  if (
    input === null ||
    !hasExactKeys(input, ['sessionId', 'promptOrder']) ||
    typeof input.sessionId !== 'string' ||
    !UUID_PATTERN.test(input.sessionId) ||
    typeof input.promptOrder !== 'number' ||
    !Number.isInteger(input.promptOrder) ||
    input.promptOrder < 1 ||
    input.promptOrder > 5
  ) {
    return null;
  }
  return { sessionId: input.sessionId, promptOrder: input.promptOrder };
}

function parseClaim(
  value: unknown,
  request: CandidateMmiScoringRequest,
): CandidateMmiScoringClaim | null {
  const claim = record(value);
  if (claim === null || typeof claim.status !== 'string') return null;
  if (
    (claim.status === 'not_ready' ||
      claim.status === 'no_response' ||
      claim.status === 'in_progress' ||
      claim.status === 'unavailable') &&
    hasExactKeys(claim, ['status'])
  ) {
    return { status: claim.status };
  }
  if (
    claim.status === 'scored' &&
    hasExactKeys(claim, ['status', 'assessment'])
  ) {
    const assessment = parsePublicAssessment(claim.assessment);
    return assessment === null ? null : { status: 'scored', assessment };
  }
  if (
    claim.status !== 'claimed' ||
    !hasExactKeys(claim, [
      'status',
      'responseId',
      'sessionId',
      'promptOrder',
      'transcript',
      'promptText',
    ]) ||
    typeof claim.responseId !== 'string' ||
    !UUID_PATTERN.test(claim.responseId) ||
    claim.sessionId !== request.sessionId ||
    claim.promptOrder !== request.promptOrder ||
    typeof claim.transcript !== 'string' ||
    claim.transcript.trim().length === 0 ||
    codePointLength(claim.transcript) > MAX_TRANSCRIPT_CODE_POINTS ||
    typeof claim.promptText !== 'string' ||
    claim.promptText.trim().length === 0 ||
    codePointLength(claim.promptText) > MAX_PUBLIC_TEXT_CODE_POINTS
  ) {
    return null;
  }
  return {
    status: 'claimed',
    responseId: claim.responseId,
    sessionId: request.sessionId,
    promptOrder: request.promptOrder,
    transcript: claim.transcript,
    promptText: claim.promptText,
  };
}

function parseProviderJson(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('Invalid provider response');
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('Invalid provider response');
  }
}

class InvalidProviderAssessmentError extends Error {
  readonly stage: CandidateMmiInvalidProviderResponseStage;
  readonly reason: CandidateMmiInvalidProviderResponseReason;

  constructor(
    stage: CandidateMmiInvalidProviderResponseStage,
    reason: CandidateMmiInvalidProviderResponseReason,
  ) {
    super('Invalid provider assessment');
    this.name = 'InvalidProviderAssessmentError';
    this.stage = stage;
    this.reason = reason;
  }
}

function contractValidationReason(
  error: unknown,
): CandidateMmiInvalidProviderResponseReason {
  if (!(error instanceof Error)) return 'other';
  if (error.message.startsWith('Invalid evidence reference')) {
    return 'evidence_reference';
  }
  if (error.message === 'Invalid provider score') return 'dimension_score';
  if (error.message.startsWith('Invalid rubric strength codes')) {
    return 'rubric_strength_codes';
  }
  if (
    error.message.startsWith('Invalid rubric improvement codes') ||
    error.message === 'Invalid provider improvements'
  ) {
    return 'rubric_improvement_codes';
  }
  if (error.message.startsWith('Invalid safety omission codes')) {
    return 'safety_codes';
  }
  if (error.message === 'Invalid improvement framework') {
    return 'improvement_framework';
  }
  return 'other';
}

function providerName(
  value: string,
): CandidateMmiProviderFailureDiagnostic['provider'] {
  if (value === 'anthropic' || value === 'openai' || value === 'openai_compatible') {
    return value;
  }
  return 'unknown';
}

function formatProviderContent(
  claim: ClaimedResponse,
  rubric: MmiRubric,
  scoringContract: MmiScoringContract,
): string {
  return JSON.stringify({
    promptText: claim.promptText,
    transcript: claim.transcript,
    rubric,
    scoringContract,
  });
}

function createProviderResponseSchema(
  scoringContract: MmiScoringContract,
  rubric: MmiRubric,
): Readonly<Record<string, unknown>> {
  const properties = record(scoringContract.responseSchema.properties);
  if (properties === null) throw new Error('Invalid scoring response schema');

  const criteria = Object.entries(rubric.criteria);
  const strengthCodes = criteria
    .filter(([, criterion]) => criterion.kind === 'strength')
    .map(([code]) => code);
  const improvementCodes = criteria
    .filter(([, criterion]) => criterion.kind === 'improvement')
    .map(([code]) => code);
  const safetyCodes = rubric.safetyCriticalItems.map((item) => item.id);

  const constrainCodeArray = (
    propertyName: string,
    codes: readonly string[],
  ): Readonly<Record<string, unknown>> => {
    const arraySchema = record(properties[propertyName]);
    if (arraySchema === null) throw new Error('Invalid scoring response schema');
    return {
      ...arraySchema,
      items: { type: 'string', enum: [...codes] },
    };
  };

  return {
    ...scoringContract.responseSchema,
    properties: {
      ...properties,
      rubricStrengthCodes: constrainCodeArray(
        'rubricStrengthCodes',
        strengthCodes,
      ),
      rubricImprovementCodes: constrainCodeArray(
        'rubricImprovementCodes',
        improvementCodes,
      ),
      safetyCriticalOmissionCodes: constrainCodeArray(
        'safetyCriticalOmissionCodes',
        safetyCodes,
      ),
    },
  };
}

function completionSucceeded(value: unknown): boolean {
  const result = record(value);
  return (
    result !== null &&
    hasExactKeys(result, ['status']) &&
    result.status === 'scored'
  );
}

async function failClaimSafely(
  repository: CandidateMmiScoringRepository,
  claim: ClaimedResponse,
  leaseToken: string,
  errorCode: string,
): Promise<void> {
  try {
    await repository.fail({
      p_response_id: claim.responseId,
      p_session_id: claim.sessionId,
      p_lease_token: leaseToken,
      p_error_code: errorCode,
    });
  } catch {
    // Failure cleanup is best effort; never expose private repository errors.
  }
}

export function createCandidateMmiScoringHandler(
  dependencies: CandidateMmiScoringDependencies,
): (request: Request) => Promise<Response> {
  const {
    repository,
    allowedOrigins,
    createLeaseToken,
    callProvider,
    logProviderFailure,
  } = dependencies;
  return async (request) => {
    const http = prepareEdgeHttpRequest(request, allowedOrigins);
    if (http.response) return http.response;
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return http.json({ code: 'unauthorized' }, 401);
    }

    let authentication: RepositoryResult<{ userId?: string }>;
    try {
      authentication = await repository.authenticate(authorization);
    } catch {
      return http.json({ code: 'unauthorized' }, 401);
    }
    if (
      authentication.error ||
      typeof authentication.userId !== 'string' ||
      !UUID_PATTERN.test(authentication.userId)
    ) {
      return http.json({ code: 'unauthorized' }, 401);
    }

    let rawBody: unknown;
    try {
      rawBody = await readBoundedJson(request, 4_096);
    } catch (error) {
      const status = error instanceof EdgeRequestError ? error.status : 400;
      return http.json({ code: 'invalid_request' }, status);
    }
    const input = parseRequest(rawBody);
    if (input === null) return http.json({ code: 'invalid_request' }, 400);

    let leaseToken: string;
    try {
      leaseToken = createLeaseToken();
    } catch {
      return http.json({ code: 'unavailable' }, 500);
    }
    if (!UUID_PATTERN.test(leaseToken)) {
      return http.json({ code: 'unavailable' }, 500);
    }

    let claimResult: RepositoryResult<{ data?: unknown }>;
    try {
      claimResult = await repository.claim({
        p_user_id: authentication.userId,
        p_session_id: input.sessionId,
        p_prompt_order: input.promptOrder,
        p_lease_token: leaseToken,
      });
    } catch {
      return http.json({ code: 'unavailable' }, 500);
    }
    if (claimResult.error) return http.json({ code: 'unavailable' }, 500);
    const claim = parseClaim(claimResult.data, input);
    if (claim === null) return http.json({ code: 'unavailable' }, 500);

    if (claim.status === 'not_ready') {
      return http.json({ code: 'not_ready' }, 409, { 'Retry-After': '3' });
    }
    if (claim.status === 'no_response') {
      return http.json({ status: 'no_response' });
    }
    if (claim.status === 'in_progress') {
      return http.json({ code: 'in_progress' }, 409, { 'Retry-After': '3' });
    }
    if (claim.status === 'unavailable') {
      return http.json({ code: 'unavailable' }, 503);
    }
    if (claim.status === 'scored') {
      return http.json({ status: 'scored', assessment: claim.assessment });
    }

    let rubric: MmiRubric;
    let scoringContract: MmiScoringContract;
    try {
      scoringContract = getCurrentMmiScoringContract();
      rubric = getCurrentMmiRubric();
    } catch {
      await failClaimSafely(repository, claim, leaseToken, 'persistence_failed');
      return http.json({ code: 'unavailable' }, 500);
    }

    let configuration: RepositoryResult<{ config?: AiConfig }>;
    try {
      configuration = await repository.loadProviderConfig();
    } catch {
      await failClaimSafely(repository, claim, leaseToken, 'persistence_failed');
      return http.json({ code: 'unavailable' }, 500);
    }
    if (configuration.error) {
      await failClaimSafely(repository, claim, leaseToken, 'persistence_failed');
      return http.json({ code: 'unavailable' }, 500);
    }
    if (configuration.config === undefined) {
      await failClaimSafely(
        repository,
        claim,
        leaseToken,
        'provider_not_configured',
      );
      return http.json({ code: 'provider_not_configured' }, 503);
    }

    let providerPayload: unknown;
    try {
      providerPayload = await callProvider(configuration.config, {
        systemPrompt: `${scoringContract.assessorInstructions} ${SCORING_SYSTEM_SUFFIX}`,
        userContent: formatProviderContent(claim, rubric, scoringContract),
        maxTokens: 768,
        responseSchema: createProviderResponseSchema(scoringContract, rubric),
      });
    } catch (error) {
      if (error instanceof ProviderRequestError) {
        const baseDiagnostic = {
          requestId:
            sanitizeDiagnosticRequestId(request.headers.get('x-request-id')) ??
            null,
          provider: providerName(configuration.config.provider),
          code: 'provider_failed',
        } as const;
        const diagnostic: CandidateMmiProviderFailureDiagnostic =
          error.status === undefined
            ? baseDiagnostic
            : { ...baseDiagnostic, status: error.status };
        try {
          logProviderFailure(diagnostic);
        } catch {
          // Diagnostics must never affect the response or leak private values.
        }
      }
      await failClaimSafely(repository, claim, leaseToken, 'provider_failed');
      return http.json({ code: 'provider_failed' }, 502);
    }

    let assessment: MmiAssessment;
    try {
      let rawAssessment: unknown;
      try {
        rawAssessment = parseProviderJson(providerPayload);
      } catch {
        throw new InvalidProviderAssessmentError('json_parse', 'malformed_json');
      }
      if (!validateJsonSchema(rawAssessment, scoringContract.responseSchema)) {
        throw new InvalidProviderAssessmentError(
          'response_schema',
          'schema_mismatch',
        );
      }
      let parsedProvider;
      try {
        parsedProvider = parseProviderAssessmentForContract(
          rawAssessment,
          scoringContract,
          rubric,
          claim.transcript,
        );
      } catch (error) {
        throw new InvalidProviderAssessmentError(
          'contract_validation',
          contractValidationReason(error),
        );
      }
      try {
        const publicContext = createMmiPublicOutputContext({
          rubric,
          scoringContractVersion: scoringContract.version,
          studentFeedbackCatalog: scoringContract.studentFeedbackCatalog,
        });
        assessment = toPublicMmiAssessment(
          parsedProvider,
          claim.transcript,
          publicContext,
        );
      } catch {
        throw new InvalidProviderAssessmentError('public_mapping', 'other');
      }
    } catch (error) {
      const invalidResponse = error instanceof InvalidProviderAssessmentError
        ? error
        : new InvalidProviderAssessmentError('public_mapping', 'other');
      try {
        logProviderFailure({
          requestId:
            sanitizeDiagnosticRequestId(request.headers.get('x-request-id')) ??
            null,
          provider: providerName(configuration.config.provider),
          code: 'invalid_provider_response',
          stage: invalidResponse.stage,
          reason: invalidResponse.reason,
        });
      } catch {
        // Diagnostics must never affect the response or leak private values.
      }
      await failClaimSafely(
        repository,
        claim,
        leaseToken,
        'invalid_provider_response',
      );
      return http.json({ code: 'invalid_provider_response' }, 502);
    }

    let completion: RepositoryResult<{ data?: unknown }>;
    try {
      completion = await repository.complete({
        p_response_id: claim.responseId,
        p_session_id: claim.sessionId,
        p_lease_token: leaseToken,
        p_public_assessment: assessment,
      });
    } catch {
      await failClaimSafely(repository, claim, leaseToken, 'persistence_failed');
      return http.json({ code: 'unavailable' }, 500);
    }
    if (completion.error || !completionSucceeded(completion.data)) {
      await failClaimSafely(repository, claim, leaseToken, 'persistence_failed');
      return http.json({ code: 'unavailable' }, 500);
    }
    return http.json({ status: 'scored', assessment });
  };
}
