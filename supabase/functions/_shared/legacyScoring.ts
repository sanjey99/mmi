export interface LegacyScoringRequest {
  sessionId: string;
  questionId: string;
  answerText: string;
}

export type LegacyClaim =
  | { status: 'acquired'; claim_id: string; lease_token: string; question_text: string }
  | { status: 'in_progress' }
  | { status: 'succeeded'; result: Record<string, unknown> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RPC_CODES = new Set([
  'answer_conflict',
  'invalid_request',
  'in_progress',
  'persistence_failed',
  'rate_limited',
  'submission_unavailable',
]);

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseLegacyScoringRequest(value: unknown): LegacyScoringRequest {
  const record = objectRecord(value);
  const expected = ['sessionId', 'questionId', 'answerText'];
  if (!record || Object.keys(record).length !== expected.length || expected.some(key => !(key in record))) {
    throw new Error('invalid_request');
  }
  const { sessionId, questionId, answerText } = record;
  if (
    typeof sessionId !== 'string'
    || typeof questionId !== 'string'
    || typeof answerText !== 'string'
    || !UUID_PATTERN.test(sessionId)
    || !UUID_PATTERN.test(questionId)
    || answerText !== answerText.trim()
    || answerText.length < 20
    || answerText.length > 3_000
    || answerText.includes('\0')
  ) {
    throw new Error('invalid_request');
  }
  return { sessionId, questionId, answerText };
}

export async function hashLegacyAnswer(answerText: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(answerText));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function readLegacyClaim(value: unknown): LegacyClaim {
  const record = objectRecord(value);
  if (!record || typeof record.status !== 'string') throw new Error('persistence_failed');
  if (record.status === 'in_progress' && Object.keys(record).length === 1) {
    return { status: 'in_progress' };
  }
  if (
    record.status === 'acquired'
    && typeof record.claim_id === 'string'
    && UUID_PATTERN.test(record.claim_id)
    && typeof record.lease_token === 'string'
    && UUID_PATTERN.test(record.lease_token)
    && typeof record.question_text === 'string'
    && record.question_text.length > 0
    && record.question_text.length <= 2_000
  ) {
    return {
      status: 'acquired',
      claim_id: record.claim_id,
      lease_token: record.lease_token,
      question_text: record.question_text,
    };
  }
  const result = objectRecord(record.result);
  if (record.status === 'succeeded' && result) return { status: 'succeeded', result };
  throw new Error('persistence_failed');
}

export function safeLegacyRpcCode(error: unknown): string {
  const message = objectRecord(error)?.message;
  return typeof message === 'string' && SAFE_RPC_CODES.has(message)
    ? message
    : 'persistence_failed';
}
