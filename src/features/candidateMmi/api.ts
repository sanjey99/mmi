import type { CandidateMmiPromptOrder } from './types';

export type CandidateMmiApiErrorKind = 'access_denied' | 'feature_disabled' | 'invalid_request' | 'invalid_response' | 'response_closed' | 'response_not_closed' | 'in_progress' | 'unavailable';
const errorMessages: Readonly<Record<CandidateMmiApiErrorKind, string>> = Object.freeze({
  access_denied: 'Candidate MMI access is denied.', feature_disabled: 'Candidate MMI is disabled.', invalid_request: 'Candidate MMI request is invalid.', invalid_response: 'Candidate MMI response is invalid.', response_closed: 'Candidate MMI response is closed.', response_not_closed: 'Candidate MMI response is not ready to close.', in_progress: 'Candidate MMI request is already in progress.', unavailable: 'Candidate MMI is unavailable.',
});
export class CandidateMmiApiError extends Error {
  readonly kind: CandidateMmiApiErrorKind;
  constructor(kind: CandidateMmiApiErrorKind) { super(errorMessages[kind]); this.name = 'CandidateMmiApiError'; this.kind = kind; }
}

export type CandidateMmiServerProjection =
  | Readonly<{ sessionId: string; stationId: string; serverNow: string; phase: 'scenario'; phaseStartedAt: string; phaseEndsAt: string; scenarioText: string }>
  | Readonly<{ sessionId: string; stationId: string; serverNow: string; phase: 'response'; phaseStartedAt: string; phaseEndsAt: string; promptOrder: CandidateMmiPromptOrder; promptText: string; draftTranscript: string; draftRevision: number; responseStatus: 'open' }>
  | Readonly<{ sessionId: string; stationId: string; serverNow: string; phase: 'completed' | 'abandoned'; phaseStartedAt: string; phaseEndsAt: string | null }>;
export type CandidateMmiCheckpoint = Readonly<{ sessionId: string; promptOrder: CandidateMmiPromptOrder; draftRevision: number; acceptedAt: string }>;
export type CandidateMmiScoringStatus = 'pending' | 'in_progress' | 'scored' | 'no_response' | 'feedback_unavailable' | 'failed';
export type CandidateMmiFinalization = Readonly<{ sessionId: string; promptOrder: CandidateMmiPromptOrder; responseState: 'response' | 'no_response'; finalizedAt: string; scoringStatus: CandidateMmiScoringStatus }>;
export type CandidateMmiDimension = 'structure' | 'ethics' | 'communication' | 'reflection' | 'nhs_awareness';
export type CandidateMmiPublicDimensionResult = Readonly<{ score: number | null; applicable: boolean; evidence: string | null; improvement: string | null }>;
export type CandidateMmiPublicAssessment = Readonly<{ dimensions: Readonly<Record<CandidateMmiDimension, CandidateMmiPublicDimensionResult>>; overallPct: number; strengths: readonly string[]; improvements: readonly string[]; improvementTip: string; rubricVersion: number }>;
export type CandidateMmiFeedback = Readonly<{ promptOrder: CandidateMmiPromptOrder; status: CandidateMmiScoringStatus; assessment: CandidateMmiPublicAssessment | null }>;
type CandidateMmiRpcResult = Readonly<{ data: unknown; error: Readonly<{ code?: string; message?: string }> | null }>;
export type CandidateMmiRpcClient = Readonly<{ rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<CandidateMmiRpcResult> }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATION_ID_PATTERN = /^MMI_[0-9]{3}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const scenarioKeys = ['phase', 'phaseEndsAt', 'phaseStartedAt', 'scenarioText', 'serverNow', 'sessionId', 'stationId'] as const;
const responseKeys = ['draftRevision', 'draftTranscript', 'phase', 'phaseEndsAt', 'phaseStartedAt', 'promptOrder', 'promptText', 'responseStatus', 'serverNow', 'sessionId', 'stationId'] as const;
const terminalKeys = ['phase', 'phaseEndsAt', 'phaseStartedAt', 'serverNow', 'sessionId', 'stationId'] as const;
const checkpointKeys = ['acceptedAt', 'draftRevision', 'promptOrder', 'sessionId'] as const;
const finalizationKeys = ['finalizedAt', 'promptOrder', 'responseState', 'scoringStatus', 'sessionId'] as const;
const feedbackKeys = ['assessment', 'promptOrder', 'status'] as const;
const assessmentKeys = ['dimensions', 'improvementTip', 'improvements', 'overallPct', 'rubricVersion', 'strengths'] as const;
const dimensionResultKeys = ['applicable', 'evidence', 'improvement', 'score'] as const;
const dimensions = ['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness'] as const;
const scoringStatuses = ['pending', 'in_progress', 'scored', 'no_response', 'feedback_unavailable', 'failed'] as const;

function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const actual = Object.keys(value).sort(); const sortedExpected = [...expected].sort(); return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]); }
function parseIsoTimestamp(value: unknown): Date | null { if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value)) return null; const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed : null; }
function codePointLength(value: string): number { return Array.from(value).length; }
function isPromptOrder(value: unknown): value is CandidateMmiPromptOrder { return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5; }
function isScoringStatus(value: unknown): value is CandidateMmiScoringStatus { return typeof value === 'string' && (scoringStatuses as readonly string[]).includes(value); }
function isValidBaseProjection(value: Record<string, unknown>): boolean { return typeof value.sessionId === 'string' && UUID_PATTERN.test(value.sessionId) && typeof value.stationId === 'string' && STATION_ID_PATTERN.test(value.stationId) && parseIsoTimestamp(value.serverNow) !== null && parseIsoTimestamp(value.phaseStartedAt) !== null; }
function hasDuration(startedAt: Date, endsAt: Date, seconds: number): boolean { return endsAt.getTime() - startedAt.getTime() === seconds * 1_000; }
function invalidResponse(): never { throw new CandidateMmiApiError('invalid_response'); }

function parseProjection(value: unknown): CandidateMmiServerProjection {
  const projection = record(value); if (projection === null || !isValidBaseProjection(projection) || typeof projection.phase !== 'string') return invalidResponse();
  const serverNow = parseIsoTimestamp(projection.serverNow)!; const phaseStartedAt = parseIsoTimestamp(projection.phaseStartedAt)!;
  if (projection.phase === 'scenario') {
    const phaseEndsAt = parseIsoTimestamp(projection.phaseEndsAt);
    if (!hasExactKeys(projection, scenarioKeys) || typeof projection.scenarioText !== 'string' || projection.scenarioText.length === 0 || phaseEndsAt === null || !hasDuration(phaseStartedAt, phaseEndsAt, 60) || serverNow < phaseStartedAt || serverNow >= phaseEndsAt) return invalidResponse();
    return Object.freeze({ sessionId: projection.sessionId as string, stationId: projection.stationId as string, serverNow: projection.serverNow as string, phase: 'scenario', phaseStartedAt: projection.phaseStartedAt as string, phaseEndsAt: projection.phaseEndsAt as string, scenarioText: projection.scenarioText });
  }
  if (projection.phase === 'response') {
    const phaseEndsAt = parseIsoTimestamp(projection.phaseEndsAt);
    if (!hasExactKeys(projection, responseKeys) || !isPromptOrder(projection.promptOrder) || typeof projection.promptText !== 'string' || projection.promptText.length === 0 || typeof projection.draftTranscript !== 'string' || codePointLength(projection.draftTranscript) > 12_000 || typeof projection.draftRevision !== 'number' || !Number.isInteger(projection.draftRevision) || projection.draftRevision < 0 || projection.responseStatus !== 'open' || phaseEndsAt === null || !hasDuration(phaseStartedAt, phaseEndsAt, 120) || serverNow < phaseStartedAt || serverNow >= phaseEndsAt) return invalidResponse();
    return Object.freeze({ sessionId: projection.sessionId as string, stationId: projection.stationId as string, serverNow: projection.serverNow as string, phase: 'response', phaseStartedAt: projection.phaseStartedAt as string, phaseEndsAt: projection.phaseEndsAt as string, promptOrder: projection.promptOrder, promptText: projection.promptText, draftTranscript: projection.draftTranscript, draftRevision: projection.draftRevision, responseStatus: 'open' });
  }
  if (projection.phase === 'completed') {
    if (!hasExactKeys(projection, terminalKeys) || projection.phaseEndsAt !== null || serverNow < phaseStartedAt) return invalidResponse();
    return Object.freeze({ sessionId: projection.sessionId as string, stationId: projection.stationId as string, serverNow: projection.serverNow as string, phase: 'completed', phaseStartedAt: projection.phaseStartedAt as string, phaseEndsAt: null });
  }
  if (projection.phase === 'abandoned') {
    const phaseEndsAt = parseIsoTimestamp(projection.phaseEndsAt);
    if (!hasExactKeys(projection, terminalKeys) || phaseEndsAt === null || phaseEndsAt.getTime() !== phaseStartedAt.getTime() || serverNow < phaseStartedAt) return invalidResponse();
    return Object.freeze({ sessionId: projection.sessionId as string, stationId: projection.stationId as string, serverNow: projection.serverNow as string, phase: 'abandoned', phaseStartedAt: projection.phaseStartedAt as string, phaseEndsAt: projection.phaseEndsAt as string });
  }
  return invalidResponse();
}
function parseCheckpoint(value: unknown, sessionId: string, promptOrder: CandidateMmiPromptOrder, revision: number): CandidateMmiCheckpoint { const result = record(value); if (result === null || !hasExactKeys(result, checkpointKeys) || result.sessionId !== sessionId || result.promptOrder !== promptOrder || result.draftRevision !== revision || parseIsoTimestamp(result.acceptedAt) === null) return invalidResponse(); return Object.freeze({ sessionId, promptOrder, draftRevision: revision, acceptedAt: result.acceptedAt as string }); }
function parseFinalization(value: unknown, sessionId: string, promptOrder: CandidateMmiPromptOrder): CandidateMmiFinalization { const result = record(value); if (result === null || !hasExactKeys(result, finalizationKeys) || result.sessionId !== sessionId || result.promptOrder !== promptOrder || (result.responseState !== 'response' && result.responseState !== 'no_response') || !isScoringStatus(result.scoringStatus) || parseIsoTimestamp(result.finalizedAt) === null) return invalidResponse(); return Object.freeze({ sessionId, promptOrder, responseState: result.responseState, finalizedAt: result.finalizedAt as string, scoringStatus: result.scoringStatus }); }
function parseAssessment(value: unknown): CandidateMmiPublicAssessment {
  const result = record(value); if (result === null || !hasExactKeys(result, assessmentKeys) || typeof result.overallPct !== 'number' || !Number.isInteger(result.overallPct) || result.overallPct < 0 || result.overallPct > 100 || typeof result.rubricVersion !== 'number' || !Number.isInteger(result.rubricVersion) || result.rubricVersion < 1 || typeof result.improvementTip !== 'string' || result.improvementTip.length === 0 || !Array.isArray(result.strengths) || !Array.isArray(result.improvements) || ![...result.strengths, ...result.improvements].every(item => typeof item === 'string')) return invalidResponse();
  const valueDimensions = record(result.dimensions); if (valueDimensions === null || !hasExactKeys(valueDimensions, dimensions)) return invalidResponse(); const parsedDimensions = {} as Record<CandidateMmiDimension, CandidateMmiPublicDimensionResult>;
  for (const dimension of dimensions) { const item = record(valueDimensions[dimension]); if (item === null || !hasExactKeys(item, dimensionResultKeys) || typeof item.applicable !== 'boolean' || !(item.score === null || (typeof item.score === 'number' && Number.isInteger(item.score) && item.score >= 1 && item.score <= 5)) || !(item.evidence === null || typeof item.evidence === 'string') || !(item.improvement === null || typeof item.improvement === 'string')) return invalidResponse(); parsedDimensions[dimension] = Object.freeze({ score: item.score as number | null, applicable: item.applicable, evidence: item.evidence as string | null, improvement: item.improvement as string | null }); }
  return Object.freeze({ dimensions: Object.freeze(parsedDimensions), overallPct: result.overallPct, strengths: Object.freeze([...result.strengths] as string[]), improvements: Object.freeze([...result.improvements] as string[]), improvementTip: result.improvementTip, rubricVersion: result.rubricVersion });
}
function parseFeedback(value: unknown): readonly CandidateMmiFeedback[] { if (!Array.isArray(value) || value.length !== 5) return invalidResponse(); return Object.freeze(value.map((entry, index) => { const row = record(entry); const promptOrder = (index + 1) as CandidateMmiPromptOrder; if (row === null || !hasExactKeys(row, feedbackKeys) || row.promptOrder !== promptOrder || !isScoringStatus(row.status) || (row.status === 'scored') !== (row.assessment !== null)) return invalidResponse(); return Object.freeze({ promptOrder, status: row.status, assessment: row.status === 'scored' ? parseAssessment(row.assessment) : null }); })); }
function mapRpcError(code: string | undefined, message: string | undefined): CandidateMmiApiError { if (code === '42501') return new CandidateMmiApiError('access_denied'); if (code === '22023') return new CandidateMmiApiError('invalid_request'); if (code === 'P0001' && message === 'feature_disabled') return new CandidateMmiApiError('feature_disabled'); if (code === 'P0001' && message === 'candidate_response_not_open') return new CandidateMmiApiError('response_closed'); if (code === 'P0001' && (message === 'candidate_response_deadline_not_reached' || message === 'candidate_feedback_not_ready')) return new CandidateMmiApiError('response_not_closed'); if (code === 'P0001' && message === 'stale_candidate_mmi_checkpoint') return new CandidateMmiApiError('in_progress'); return new CandidateMmiApiError('unavailable'); }

export function createCandidateMmiApi(rpc: CandidateMmiRpcClient) {
  async function request<T>(name: string, args: Record<string, unknown> | undefined, parser: (data: unknown) => T): Promise<T> { let result: CandidateMmiRpcResult; try { result = args === undefined ? await rpc.rpc(name) : await rpc.rpc(name, args); } catch { throw new CandidateMmiApiError('unavailable'); } if (result.error) throw mapRpcError(result.error.code, result.error.message); return parser(result.data); }
  return Object.freeze({
    start: (): Promise<CandidateMmiServerProjection> => request('start_candidate_mmi_station_session', undefined, parseProjection),
    refresh: (sessionId: string): Promise<CandidateMmiServerProjection> => UUID_PATTERN.test(sessionId) ? request('get_candidate_mmi_station_session', { p_session_id: sessionId }, parseProjection) : Promise.reject(new CandidateMmiApiError('invalid_request')),
    checkpoint: (sessionId: string, promptOrder: CandidateMmiPromptOrder, transcript: string, clientRevision: number): Promise<CandidateMmiCheckpoint> => !UUID_PATTERN.test(sessionId) || !isPromptOrder(promptOrder) || typeof transcript !== 'string' || codePointLength(transcript) > 12_000 || !Number.isInteger(clientRevision) || clientRevision < 0 ? Promise.reject(new CandidateMmiApiError('invalid_request')) : request('checkpoint_candidate_mmi_station_response', { p_session_id: sessionId, p_prompt_order: promptOrder, p_transcript: transcript, p_client_revision: clientRevision }, value => parseCheckpoint(value, sessionId, promptOrder, clientRevision)),
    finalize: (sessionId: string, promptOrder: CandidateMmiPromptOrder, finalizationKey: string): Promise<CandidateMmiFinalization> => !UUID_PATTERN.test(sessionId) || !isPromptOrder(promptOrder) || !UUID_PATTERN.test(finalizationKey) ? Promise.reject(new CandidateMmiApiError('invalid_request')) : request('finalize_candidate_mmi_station_response', { p_session_id: sessionId, p_prompt_order: promptOrder, p_finalization_key: finalizationKey }, value => parseFinalization(value, sessionId, promptOrder)),
    feedback: (sessionId: string): Promise<readonly CandidateMmiFeedback[]> => UUID_PATTERN.test(sessionId) ? request('get_candidate_mmi_station_feedback', { p_session_id: sessionId }, parseFeedback) : Promise.reject(new CandidateMmiApiError('invalid_request')),
    abandon: (sessionId: string): Promise<void> => UUID_PATTERN.test(sessionId) ? request('abandon_candidate_mmi_station_session', { p_session_id: sessionId }, () => undefined) : Promise.reject(new CandidateMmiApiError('invalid_request')),
  });
}
