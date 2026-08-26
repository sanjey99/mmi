import type { ScoreResult } from '../../types';

export interface LegacyScoringRequest {
  sessionId: string;
  questionId: string;
  answerText: string;
}

export class LegacyScoringError extends Error {
  readonly code: string;

  constructor(code: string, message = 'We could not score this response. Please try again.') {
    super(message);
    this.code = code;
    this.name = 'LegacyScoringError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_MESSAGES = Object.freeze({
  invalid_request: 'Check the station and response, then try again.',
  unauthorized: 'Sign in again before submitting this response.',
  submission_unavailable: 'This practice station is no longer available.',
  provider_not_configured: 'Scoring is not configured yet.',
  rate_limited: 'You have reached the scoring limit.',
  in_progress: 'This response is already being scored.',
  answer_conflict: 'This station already has a different submitted response.',
  provider_failed: 'The scoring provider is temporarily unavailable.',
  invalid_provider_response: 'The scorer returned an invalid response. Please retry.',
  persistence_failed: 'The result could not be saved. Please retry.',
  invalid_response: 'The saved score could not be verified.',
  request_failed: 'We could not score this response. Please try again.',
});

type SafeCode = keyof typeof SAFE_MESSAGES;
const safeCodes = new Set<SafeCode>(Object.keys(SAFE_MESSAGES) as SafeCode[]);

type InvokeFunction = (
  name: string,
  options: { body: Record<string, unknown> },
) => Promise<{ data: unknown | null; error: unknown }>;

function scoringError(code: SafeCode) {
  return new LegacyScoringError(code, SAFE_MESSAGES[code]);
}

function validateRequest(request: LegacyScoringRequest): LegacyScoringRequest {
  const answerText = request.answerText.trim();
  if (
    !UUID_PATTERN.test(request.sessionId)
    || !UUID_PATTERN.test(request.questionId)
    || answerText.length < 20
    || answerText.length > 3_000
    || answerText.includes('\0')
  ) {
    throw scoringError('invalid_request');
  }
  return { ...request, answerText };
}

function isScoreResult(value: unknown): value is ScoreResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const score = value as Record<string, unknown>;
  const dimensions = ['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness'];
  return dimensions.every(key => Number.isInteger(score[key]) && Number(score[key]) >= 1 && Number(score[key]) <= 5)
    && Number.isFinite(score.overall_pct) && Number(score.overall_pct) >= 0 && Number(score.overall_pct) <= 100
    && typeof score.ai_feedback === 'string' && score.ai_feedback.length > 0 && score.ai_feedback.length <= 2_000
    && typeof score.improvement_tip === 'string' && score.improvement_tip.length > 0 && score.improvement_tip.length <= 1_000;
}

async function resolveError(error: unknown): Promise<LegacyScoringError> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { code?: unknown };
      if (typeof payload.code === 'string' && safeCodes.has(payload.code as SafeCode)) {
        return scoringError(payload.code as SafeCode);
      }
    } catch {
      // The response body is untrusted. Fall through to the generic error.
    }
  }
  return scoringError('request_failed');
}

export function createLegacyScoringApi(invoke: InvokeFunction) {
  return {
    async scoreAnswer(request: LegacyScoringRequest): Promise<ScoreResult> {
      const validated = validateRequest(request);
      const result = await invoke('score-answer', { body: { ...validated } });
      if (result.error) throw await resolveError(result.error);
      if (!isScoreResult(result.data)) throw scoringError('invalid_response');
      return result.data;
    },
  };
}
