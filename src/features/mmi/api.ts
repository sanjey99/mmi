
export type MmiStationKind = 'standard' | 'roleplay';

export type StartMmiAttemptRequest =
  | { stationKind: 'standard'; stationId: string; privacyNoticeVersion: string }
  | { stationKind: 'roleplay'; stationId: string; privacyNoticeVersion: string };

export interface SafeMmiStationBrief {
  content_version: string;
  station_kind: MmiStationKind;
  station_id: string;
  title: string;
  category: string;
  topic: string;
  difficulty: string;
  university_tags: string[];
  prep_time_sec: number;
  prompt_count: number;
  student_brief: string;
  opening_line: string | null;
}

export interface SafeMmiPrompt {
  order: number;
  text: string;
  timeLimitSec: number;
}

export interface SafeMmiFeedback {
  overallPct: number;
  dimensionResults: Record<string, unknown>;
  strengths: string[] | null;
  improvements: string[] | null;
  improvementTip: string | null;
  freeTextPurgedAt: string | null;
}

export interface SafeMmiAttempt {
  id: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  phase: 'preparing' | 'prompt_active' | 'awaiting_continue' | 'final_feedback';
  preparationEndsAt: string | null;
  currentPromptOrder: number;
  expectedPromptCount: number;
  station: SafeMmiStationBrief;
}

export interface StartMmiAttemptResponse {
  attempt: SafeMmiAttempt;
}

export interface GetMmiAttemptResponse {
  attempt: SafeMmiAttempt;
  remainingSeconds?: number;
  prompt?: SafeMmiPrompt;
  feedback?: SafeMmiFeedback;
  summaryAvailable?: boolean;
}

export class MmiApiError extends Error {
  readonly code: string;
  readonly remainingSeconds?: number;
  constructor(code: string, message: string, remainingSeconds?: number) {
    super(message);
    this.code = code;
    this.remainingSeconds = remainingSeconds;
    this.name = 'MmiApiError';
  }
}

const safeMessages: Record<string, string> = {
  attempt_not_found: 'This MMI attempt is unavailable.',
  completed_attempt: 'Completed attempts cannot be abandoned.',
  invalid_request: 'Please check the station details and try again.',
  invalid_attempt_phase: 'This attempt is not ready for that action.',
  preparation_in_progress: 'Preparation is still in progress.',
  privacy_notice_not_current: 'Please review the current privacy notice before starting.',
  station_not_found: 'This station is unavailable.',
};

function messageFor(code: string) {
  return safeMessages[code] ?? 'We could not complete that MMI request. Please try again.';
}

function validateStartRequest(request: StartMmiAttemptRequest) {
  if (!request || (request.stationKind !== 'standard' && request.stationKind !== 'roleplay')
    || !request.stationId.trim() || !request.privacyNoticeVersion.trim()) {
    throw new MmiApiError('invalid_request', messageFor('invalid_request'));
  }
}

const safeCodes = new Set(Object.keys(safeMessages));

export async function resolveMmiFunctionResult<T>(result: { data: T | null; error: unknown }, allowNoContent = false): Promise<T | undefined> {
  if (!result.error) {
    if (result.data === null && allowNoContent) return undefined;
    if (result.data !== null) return result.data;
    throw new MmiApiError('empty_response', messageFor('empty_response'));
  }
  const context = (result.error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json() as { code?: unknown; remainingSeconds?: unknown };
      const code = typeof payload.code === 'string' && safeCodes.has(payload.code) ? payload.code : 'request_failed';
      const remaining = payload.remainingSeconds;
      const remainingSeconds = code === 'preparation_in_progress' && typeof remaining === 'number' && Number.isInteger(remaining) && remaining >= 0 && remaining <= 3_600 ? remaining : undefined;
      throw new MmiApiError(code, messageFor(code), remainingSeconds);
    } catch (error) { if (error instanceof MmiApiError) throw error; }
  }
  throw new MmiApiError('request_failed', messageFor('request_failed'));
}

async function invoke<T>(name: string, body: Record<string, unknown>, allowNoContent = false): Promise<T | undefined> {
  const { supabase } = await import('../../lib/supabase');
  return resolveMmiFunctionResult(await supabase.functions.invoke<T>(name, { body }), allowNoContent);
}

export async function startMmiAttempt(request: StartMmiAttemptRequest): Promise<StartMmiAttemptResponse> {
  validateStartRequest(request);
  return (await invoke<StartMmiAttemptResponse>('start-mmi-attempt', request))!;
}

export async function getMmiAttempt(attemptId: string): Promise<GetMmiAttemptResponse> {
  if (!attemptId.trim()) throw new MmiApiError('invalid_request', messageFor('invalid_request'));
  return (await invoke<GetMmiAttemptResponse>('get-mmi-attempt', { attemptId }))!;
}

export async function revealMmiPrompt(attemptId: string): Promise<{ prompt?: SafeMmiPrompt; remainingSeconds?: number }> {
  if (!attemptId.trim()) throw new MmiApiError('invalid_request', messageFor('invalid_request'));
  return (await invoke<{ prompt?: SafeMmiPrompt; remainingSeconds?: number }>('reveal-mmi-prompt', { attemptId }))!;
}

export async function abandonMmiAttempt(attemptId: string): Promise<void> {
  if (!attemptId.trim()) throw new MmiApiError('invalid_request', messageFor('invalid_request'));
  await invoke<Record<string, never>>('abandon-mmi-attempt', { attemptId }, true);
}
