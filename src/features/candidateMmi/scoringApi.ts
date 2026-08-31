import type { CandidateMmiPublicAssessment } from './api';
import type { CandidateMmiPromptOrder } from './types';
import { MMI_DIMENSIONS } from '../mmi/types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PUBLIC_TEXT_CODE_POINTS = 1_000;
const MAX_PUBLIC_TEXT_ITEMS = 20;

const SAFE_MESSAGES = Object.freeze({
  feature_disabled: 'Candidate MMI scoring is disabled.',
  invalid_request: 'Candidate MMI scoring request is invalid.',
  in_progress: 'This response is already being scored.',
  feedback_unavailable: 'Feedback is unavailable for this response.',
  provider_not_configured: 'Scoring is not configured yet.',
  provider_failed: 'The scoring provider is temporarily unavailable.',
  invalid_provider_response:
    'The scorer returned an invalid response. Please retry.',
  unauthorized: 'Sign in again before requesting feedback.',
  unavailable: 'Candidate MMI scoring is unavailable.',
});

export type CandidateMmiScoringErrorCode = keyof typeof SAFE_MESSAGES;

export class CandidateMmiScoringError extends Error {
  readonly code: CandidateMmiScoringErrorCode;

  constructor(code: CandidateMmiScoringErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'CandidateMmiScoringError';
    this.code = code;
  }
}

export type CandidateMmiScoringResult =
  | Readonly<{
      status: 'scored';
      assessment: CandidateMmiPublicAssessment;
    }>
  | Readonly<{ status: 'no_response' | 'feedback_unavailable' }>;

export type CandidateMmiInvoke = (
  name: string,
  options: Readonly<{ body: Record<string, unknown> }>,
) => PromiseLike<Readonly<{ data: unknown; error: unknown }>>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

function isPublicTextArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_PUBLIC_TEXT_ITEMS &&
    value.every(isPublicText)
  );
}

function isPublicDimension(value: unknown): boolean {
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
    return false;
  }
  if (!dimension.applicable) {
    return (
      dimension.score === null &&
      dimension.evidence === null &&
      dimension.improvement === null
    );
  }
  return (
    typeof dimension.score === 'number' &&
    Number.isInteger(dimension.score) &&
    dimension.score >= 1 &&
    dimension.score <= 5 &&
    (dimension.evidence === null || isPublicText(dimension.evidence)) &&
    (dimension.improvement === null || isPublicText(dimension.improvement))
  );
}

function isPublicAssessment(
  value: unknown,
): value is CandidateMmiPublicAssessment {
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
    !isPublicText(assessment.improvementTip) ||
    !isPublicTextArray(assessment.strengths) ||
    !isPublicTextArray(assessment.improvements)
  ) {
    return false;
  }
  const dimensions = record(assessment.dimensions);
  return (
    dimensions !== null &&
    hasExactKeys(dimensions, MMI_DIMENSIONS) &&
    MMI_DIMENSIONS.every((name) => isPublicDimension(dimensions[name]))
  );
}

function parseSuccess(value: unknown): CandidateMmiScoringResult {
  const result = record(value);
  if (
    result !== null &&
    hasExactKeys(result, ['status']) &&
    (result.status === 'no_response' ||
      result.status === 'feedback_unavailable')
  ) {
    return Object.freeze({ status: result.status });
  }
  if (
    result !== null &&
    hasExactKeys(result, ['status', 'assessment']) &&
    result.status === 'scored' &&
    isPublicAssessment(result.assessment)
  ) {
    return Object.freeze({
      status: 'scored',
      assessment: result.assessment,
    });
  }
  throw new CandidateMmiScoringError('unavailable');
}

async function resolveInvokeError(error: unknown): Promise<CandidateMmiScoringError> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const payload = (await context.clone().json()) as { code?: unknown };
      if (
        typeof payload.code === 'string' &&
        Object.prototype.hasOwnProperty.call(SAFE_MESSAGES, payload.code) &&
        payload.code !== 'invalid_request'
      ) {
        return new CandidateMmiScoringError(
          payload.code as CandidateMmiScoringErrorCode,
        );
      }
    } catch {
      // Untrusted error bodies fall through to the generic safe error.
    }
  }
  return new CandidateMmiScoringError('unavailable');
}

export function createCandidateMmiScoringApi(invoke: CandidateMmiInvoke) {
  return Object.freeze({
    async scoreCandidateResponse(
      sessionId: string,
      promptOrder: CandidateMmiPromptOrder,
    ): Promise<CandidateMmiScoringResult> {
      if (
        !UUID_PATTERN.test(sessionId) ||
        !Number.isInteger(promptOrder) ||
        promptOrder < 1 ||
        promptOrder > 5
      ) {
        throw new CandidateMmiScoringError('invalid_request');
      }

      let result: Readonly<{ data: unknown; error: unknown }>;
      try {
        result = await invoke('score-candidate-mmi-response', {
          body: { sessionId, promptOrder },
        });
      } catch {
        throw new CandidateMmiScoringError('unavailable');
      }
      if (result.error) throw await resolveInvokeError(result.error);
      return parseSuccess(result.data);
    },
  });
}
