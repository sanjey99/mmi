import {
  ProviderRequestError,
  sanitizeDiagnosticRequestId,
  type AiConfig,
  type AiProviderRequest,
} from '../_shared/aiProvider.ts';
import {
  createMmiPublicOutputContext,
  MMI_DIMENSIONS,
  parseMmiRubric,
  toPublicMmiAssessment,
  type MmiAssessment,
  type MmiDimension,
  type MmiDimensionResult,
  type MmiRubric,
} from '../_shared/mmiContracts.ts';
import {
  getMmiScoringContract,
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

export interface CandidateMmiProviderFailureDiagnostic {
  requestId: string | null;
  provider: 'anthropic' | 'openai' | 'openai_compatible' | 'unknown';
  status?: number;
  code: 'provider_failed';
}

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
  rubric: unknown;
  scoringContract: unknown;
}>;

type CandidateMmiScoringClaim =
  | Readonly<{ status: 'no_response' }>
  | Readonly<{ status: 'feedback_unavailable' }>
  | Readonly<{ status: 'in_progress' }>
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
    (claim.status === 'no_response' ||
      claim.status === 'feedback_unavailable' ||
      claim.status === 'in_progress') &&
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
      'rubric',
      'scoringContract',
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
    rubric: claim.rubric,
    scoringContract: claim.scoringContract,
  };
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid JSON value');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = record(value);
  if (object === null) throw new Error('Invalid JSON value');
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function parsePinnedContract(value: unknown): MmiScoringContract {
  const snapshot = record(value);
  if (snapshot === null || typeof snapshot.version !== 'string') {
    throw new Error('Invalid scoring contract snapshot');
  }
  const pinned = getMmiScoringContract(snapshot.version);
  if (canonicalJson(snapshot) !== canonicalJson(pinned)) {
    throw new Error('Invalid scoring contract snapshot');
  }
  return pinned;
}

function parseProviderJson(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('Invalid provider response');
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('Invalid provider response');
  }
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

    if (claim.status === 'no_response' || claim.status === 'feedback_unavailable') {
      return http.json({ status: claim.status });
    }
    if (claim.status === 'in_progress') {
      return http.json({ code: 'in_progress' }, 409, { 'Retry-After': '3' });
    }
    if (claim.status === 'scored') {
      return http.json({ status: 'scored', assessment: claim.assessment });
    }

    let rubric: MmiRubric;
    let scoringContract: MmiScoringContract;
    try {
      scoringContract = parsePinnedContract(claim.scoringContract);
      rubric = parseMmiRubric(
        claim.rubric,
        scoringContract.studentFeedbackCatalog,
      );
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
      });
    } catch (error) {
      if (error instanceof ProviderRequestError) {
        const diagnostic: CandidateMmiProviderFailureDiagnostic = {
          requestId:
            sanitizeDiagnosticRequestId(request.headers.get('x-request-id')) ??
            null,
          provider: providerName(configuration.config.provider),
          code: 'provider_failed',
        };
        if (error.status !== undefined) diagnostic.status = error.status;
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
      const rawAssessment = parseProviderJson(providerPayload);
      if (!validateJsonSchema(rawAssessment, scoringContract.responseSchema)) {
        throw new Error('Invalid provider response');
      }
      const parsedProvider = parseProviderAssessmentForContract(
        rawAssessment,
        scoringContract,
        rubric,
        claim.transcript,
      );
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
