import type { CandidateMmiPromptOrder } from './types';
import { deployedAiModelProfile, type AiModelProfile } from '../../lib/aiModelProfile';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_MESSAGES = Object.freeze({
  invalid_request: 'AI scoring request is invalid.', not_ready: 'AI scoring starts after the station is complete.',
  in_progress: 'This response is already being scored.', provider_not_configured: 'AI scoring is not configured yet.',
  model_profile_forbidden: 'This AI model preview is available only to administrators.',
  provider_failed: 'AI scoring is temporarily unavailable. Try again.', invalid_provider_response: 'The AI scorer returned an invalid result. Try again.',
  unauthorized: 'Sign in again before requesting feedback.', unavailable: 'AI scoring is unavailable. Try again.',
});
export type CandidateMmiScoringErrorCode = keyof typeof SAFE_MESSAGES;
export class CandidateMmiScoringError extends Error {
  readonly code: CandidateMmiScoringErrorCode;
  constructor(code: CandidateMmiScoringErrorCode) { super(SAFE_MESSAGES[code]); this.name = 'CandidateMmiScoringError'; this.code = code; }
}
export type CandidateMmiScoringResult = Readonly<{ status: 'scored' | 'no_response' }>;
export type CandidateMmiInvoke = (name: string, options: Readonly<{ body: Record<string, unknown> }>) => PromiseLike<Readonly<{ data: unknown; error: unknown }>>;
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function parseSuccess(value: unknown): CandidateMmiScoringResult {
  const result = record(value);
  if (result && Object.keys(result).length === 1 && (result.status === 'scored' || result.status === 'no_response')) return Object.freeze({ status: result.status });
  throw new CandidateMmiScoringError('unavailable');
}
async function resolveInvokeError(error: unknown): Promise<CandidateMmiScoringError> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) try {
    const payload = await context.clone().json() as { code?: unknown };
    if (typeof payload.code === 'string' && Object.prototype.hasOwnProperty.call(SAFE_MESSAGES, payload.code) && payload.code !== 'invalid_request') return new CandidateMmiScoringError(payload.code as CandidateMmiScoringErrorCode);
  } catch { /* untrusted body remains unavailable */ }
  return new CandidateMmiScoringError('unavailable');
}
export function createCandidateMmiScoringApi(
  invoke: CandidateMmiInvoke,
  modelProfile: AiModelProfile = deployedAiModelProfile,
) {
  return Object.freeze({
    async scoreCandidateResponse(sessionId: string, promptOrder: CandidateMmiPromptOrder): Promise<CandidateMmiScoringResult> {
      if (!UUID_PATTERN.test(sessionId) || !Number.isInteger(promptOrder) || promptOrder < 1 || promptOrder > 5) throw new CandidateMmiScoringError('invalid_request');
      let result: Readonly<{ data: unknown; error: unknown }>;
      try { result = await invoke('score-candidate-mmi-response', { body: { sessionId, promptOrder, modelProfile } }); } catch { throw new CandidateMmiScoringError('unavailable'); }
      if (result.error) throw await resolveInvokeError(result.error);
      return parseSuccess(result.data);
    },
  });
}
