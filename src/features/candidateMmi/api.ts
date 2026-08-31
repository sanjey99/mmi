import type { CandidateMmiPromptOrder } from './types';

export type CandidateMmiApiErrorKind =
  | 'access_denied'
  | 'feature_disabled'
  | 'invalid_request'
  | 'invalid_response'
  | 'unavailable';

const errorMessages: Readonly<Record<CandidateMmiApiErrorKind, string>> = Object.freeze({
  access_denied: 'Candidate MMI access is denied.',
  feature_disabled: 'Candidate MMI is disabled.',
  invalid_request: 'Candidate MMI request is invalid.',
  invalid_response: 'Candidate MMI response is invalid.',
  unavailable: 'Candidate MMI is unavailable.',
});

export class CandidateMmiApiError extends Error {
  readonly kind: CandidateMmiApiErrorKind;

  constructor(kind: CandidateMmiApiErrorKind) {
    super(errorMessages[kind]);
    this.name = 'CandidateMmiApiError';
    this.kind = kind;
  }
}

export type CandidateMmiServerProjection =
  | Readonly<{
    sessionId: string;
    stationId: string;
    serverNow: string;
    phase: 'scenario';
    phaseStartedAt: string;
    phaseEndsAt: string;
    scenarioText: string;
  }>
  | Readonly<{
    sessionId: string;
    stationId: string;
    serverNow: string;
    phase: 'response';
    phaseStartedAt: string;
    phaseEndsAt: string;
    promptOrder: CandidateMmiPromptOrder;
    promptText: string;
  }>
  | Readonly<{
    sessionId: string;
    stationId: string;
    serverNow: string;
    phase: 'completed' | 'abandoned';
    phaseStartedAt: string;
    phaseEndsAt: string | null;
  }>;

type CandidateMmiRpcResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string; message?: string }> | null;
}>;

export type CandidateMmiRpcClient = Readonly<{
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<CandidateMmiRpcResult>;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATION_ID_PATTERN = /^MMI_[0-9]{3}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const scenarioKeys = ['phase', 'phaseEndsAt', 'phaseStartedAt', 'scenarioText', 'serverNow', 'sessionId', 'stationId'] as const;
const responseKeys = ['phase', 'phaseEndsAt', 'phaseStartedAt', 'promptOrder', 'promptText', 'serverNow', 'sessionId', 'stationId'] as const;
const terminalKeys = ['phase', 'phaseEndsAt', 'phaseStartedAt', 'serverNow', 'sessionId', 'stationId'] as const;

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected.slice().sort()[index]);
}

function parseIsoTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

type CandidateMmiBaseProjection = Readonly<{
  sessionId: string;
  stationId: string;
  serverNow: string;
  phaseStartedAt: string;
}>;

function isValidBaseProjection(value: Record<string, unknown>): value is Record<string, unknown> & CandidateMmiBaseProjection {
  return typeof value.sessionId === 'string'
    && UUID_PATTERN.test(value.sessionId)
    && typeof value.stationId === 'string'
    && STATION_ID_PATTERN.test(value.stationId)
    && parseIsoTimestamp(value.serverNow) !== null
    && parseIsoTimestamp(value.phaseStartedAt) !== null;
}

function hasDuration(startedAt: Date, endsAt: Date, seconds: number): boolean {
  return endsAt.getTime() - startedAt.getTime() === seconds * 1_000;
}

function parseProjection(value: unknown): CandidateMmiServerProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CandidateMmiApiError('invalid_response');
  const projection = value as Record<string, unknown>;
  if (!isValidBaseProjection(projection) || typeof projection.phase !== 'string') {
    throw new CandidateMmiApiError('invalid_response');
  }
  const serverNow = parseIsoTimestamp(projection.serverNow)!;
  const phaseStartedAt = parseIsoTimestamp(projection.phaseStartedAt)!;

  if (projection.phase === 'scenario') {
    const phaseEndsAt = parseIsoTimestamp(projection.phaseEndsAt);
    if (!hasExactKeys(projection, scenarioKeys)
      || typeof projection.scenarioText !== 'string'
      || projection.scenarioText.length === 0
      || phaseEndsAt === null
      || !hasDuration(phaseStartedAt, phaseEndsAt, 60)
      || serverNow < phaseStartedAt
      || serverNow >= phaseEndsAt) throw new CandidateMmiApiError('invalid_response');
    return Object.freeze({
      sessionId: projection.sessionId,
      stationId: projection.stationId,
      serverNow: projection.serverNow,
      phase: 'scenario',
      phaseStartedAt: projection.phaseStartedAt,
      phaseEndsAt: projection.phaseEndsAt as string,
      scenarioText: projection.scenarioText,
    });
  }

  if (projection.phase === 'response') {
    const phaseEndsAt = parseIsoTimestamp(projection.phaseEndsAt);
    const promptOrder = projection.promptOrder;
    if (!hasExactKeys(projection, responseKeys)
      || typeof promptOrder !== 'number'
      || !Number.isInteger(promptOrder)
      || promptOrder < 1
      || promptOrder > 5
      || typeof projection.promptText !== 'string'
      || projection.promptText.length === 0
      || phaseEndsAt === null
      || !hasDuration(phaseStartedAt, phaseEndsAt, 120)
      || serverNow < phaseStartedAt
      || serverNow >= phaseEndsAt) throw new CandidateMmiApiError('invalid_response');
    return Object.freeze({
      sessionId: projection.sessionId,
      stationId: projection.stationId,
      serverNow: projection.serverNow,
      phase: 'response',
      phaseStartedAt: projection.phaseStartedAt,
      phaseEndsAt: projection.phaseEndsAt as string,
      promptOrder: promptOrder as CandidateMmiPromptOrder,
      promptText: projection.promptText,
    });
  }

  if (projection.phase === 'completed') {
    if (!hasExactKeys(projection, terminalKeys)
      || projection.phaseEndsAt !== null
      || serverNow < phaseStartedAt) throw new CandidateMmiApiError('invalid_response');
    return Object.freeze({
      sessionId: projection.sessionId,
      stationId: projection.stationId,
      serverNow: projection.serverNow,
      phase: 'completed',
      phaseStartedAt: projection.phaseStartedAt,
      phaseEndsAt: null,
    });
  }

  if (projection.phase === 'abandoned') {
    const phaseEndsAt = parseIsoTimestamp(projection.phaseEndsAt);
    if (!hasExactKeys(projection, terminalKeys)
      || phaseEndsAt === null
      || phaseEndsAt.getTime() !== phaseStartedAt.getTime()
      || serverNow < phaseStartedAt) throw new CandidateMmiApiError('invalid_response');
    return Object.freeze({
      sessionId: projection.sessionId,
      stationId: projection.stationId,
      serverNow: projection.serverNow,
      phase: 'abandoned',
      phaseStartedAt: projection.phaseStartedAt,
      phaseEndsAt: projection.phaseEndsAt as string,
    });
  }

  throw new CandidateMmiApiError('invalid_response');
}

function mapRpcError(code: string | undefined, message: string | undefined): CandidateMmiApiError {
  if (code === '42501') return new CandidateMmiApiError('access_denied');
  if (code === 'P0001' && message === 'feature_disabled') return new CandidateMmiApiError('feature_disabled');
  if (code === '22023') return new CandidateMmiApiError('invalid_request');
  return new CandidateMmiApiError('unavailable');
}

export function createCandidateMmiApi(rpc: CandidateMmiRpcClient) {
  async function requestProjection(name: string, args?: Record<string, unknown>): Promise<CandidateMmiServerProjection> {
    let result: CandidateMmiRpcResult;
    try {
      result = args === undefined ? await rpc.rpc(name) : await rpc.rpc(name, args);
    } catch {
      throw new CandidateMmiApiError('unavailable');
    }
    if (result.error) throw mapRpcError(result.error.code, result.error.message);
    return parseProjection(result.data);
  }

  return Object.freeze({
    start: (): Promise<CandidateMmiServerProjection> => requestProjection('start_candidate_mmi_station_session'),
    refresh: (sessionId: string): Promise<CandidateMmiServerProjection> => {
      if (!UUID_PATTERN.test(sessionId)) return Promise.reject(new CandidateMmiApiError('invalid_request'));
      return requestProjection('get_candidate_mmi_station_session', { p_session_id: sessionId });
    },
    abandon: async (sessionId: string): Promise<void> => {
      if (!UUID_PATTERN.test(sessionId)) throw new CandidateMmiApiError('invalid_request');
      let result: CandidateMmiRpcResult;
      try {
        result = await rpc.rpc('abandon_candidate_mmi_station_session', { p_session_id: sessionId });
      } catch {
        throw new CandidateMmiApiError('unavailable');
      }
      if (result.error) throw mapRpcError(result.error.code, result.error.message);
    },
  });
}
