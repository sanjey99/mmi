import { supabase } from '../../lib/supabase';

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
  constructor(readonly code: string, message: string) {
    super(message);
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

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { code?: string }>(name, { body });
  const code = data?.code;
  if (error || code) {
    throw new MmiApiError(code ?? 'request_failed', messageFor(code ?? 'request_failed'));
  }
  if (!data) throw new MmiApiError('empty_response', messageFor('empty_response'));
  return data;
}

export async function startMmiAttempt(request: StartMmiAttemptRequest): Promise<StartMmiAttemptResponse> {
  validateStartRequest(request);
  return invoke<StartMmiAttemptResponse>('start-mmi-attempt', request);
}

export async function getMmiAttempt(attemptId: string): Promise<GetMmiAttemptResponse> {
  if (!attemptId.trim()) throw new MmiApiError('invalid_request', messageFor('invalid_request'));
  return invoke<GetMmiAttemptResponse>('get-mmi-attempt', { attemptId });
}

export async function revealMmiPrompt(attemptId: string): Promise<{ prompt?: SafeMmiPrompt; remainingSeconds?: number }> {
  if (!attemptId.trim()) throw new MmiApiError('invalid_request', messageFor('invalid_request'));
  return invoke('reveal-mmi-prompt', { attemptId });
}

export async function abandonMmiAttempt(attemptId: string): Promise<void> {
  if (!attemptId.trim()) throw new MmiApiError('invalid_request', messageFor('invalid_request'));
  await invoke<Record<string, never>>('abandon-mmi-attempt', { attemptId });
}
