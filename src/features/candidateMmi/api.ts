import type { CandidateMmiPracticeScope, CandidateMmiPromptOrder } from './types';

export type CandidateMmiApiErrorKind =
  | 'access_denied'
  | 'invalid_request'
  | 'invalid_response'
  | 'response_closed'
  | 'response_not_closed'
  | 'in_progress'
  | 'unavailable';
const errorMessages: Readonly<Record<CandidateMmiApiErrorKind, string>> =
  Object.freeze({
    access_denied: 'Candidate MMI access is denied.',
    invalid_request: 'Candidate MMI request is invalid.',
    invalid_response: 'Candidate MMI response is invalid.',
    response_closed: 'Candidate MMI response is closed.',
    response_not_closed: 'Candidate MMI response is not ready to close.',
    in_progress: 'Candidate MMI request is already in progress.',
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
      draftTranscript: string;
      draftRevision: number;
      responseStatus: 'open';
    }>
  | Readonly<{
      sessionId: string;
      stationId: string;
      serverNow: string;
      phase: 'completed' | 'abandoned';
      phaseStartedAt: string;
      phaseEndsAt: string | null;
    }>;
export type CandidateMmiCheckpoint = Readonly<{
  sessionId: string;
  promptOrder: CandidateMmiPromptOrder;
  draftRevision: number;
  acceptedAt: string;
}>;
export type CandidateMmiScoringStatus =
  | 'pending'
  | 'in_progress'
  | 'scored'
  | 'no_response'
  | 'feedback_unavailable'
  | 'failed';
export type CandidateMmiFinalization = Readonly<{
  sessionId: string;
  promptOrder: CandidateMmiPromptOrder;
  responseState: 'response' | 'no_response';
  finalizedAt: string;
  scoringStatus: CandidateMmiScoringStatus;
}>;
type CandidateMmiLegacyAssessment = Readonly<{
  schemaVersion?: never;
  overallPct: number;
  rubricVersion: number;
}>;
export type CandidateMmiCriterionResult = Readonly<{
  criterionId: string;
  achieved: boolean;
  weightPct: number;
  bulletText: string;
  domain: string | null;
}>;
export type CandidateMmiPublicAssessment = Readonly<{
  schemaVersion: 3;
  questionScorePct: number;
  criteria: readonly CandidateMmiCriterionResult[];
}>;
export type CandidateMmiFeedbackAssessment =
  | CandidateMmiLegacyAssessment
  | CandidateMmiPublicAssessment;
export type CandidateMmiFeedback = Readonly<{
  promptOrder: CandidateMmiPromptOrder;
  status: CandidateMmiScoringStatus;
  legacy: boolean;
  assessment: CandidateMmiFeedbackAssessment | null;
}>;
export type CandidateMmiPracticeOptions = Readonly<{
  targetUniversity: string | null;
  targetTag: string | null;
  targetCount: number;
  allCount: number;
}>;
export type CandidateMmiStationResult = Readonly<{
  sessionId: string;
  stationId: string;
  status: 'completed' | 'awaiting_scoring' | 'abandoned';
  overallPct: number | null;
  feedback: readonly CandidateMmiFeedback[];
}>;
export type CandidateMmiDomainAttainment = Readonly<{
  domain: string;
  achieved: number;
  total: number;
  pct: number;
}>;
export type CandidateMmiHistoryItem = Readonly<{
  sessionId: string;
  stationId: string;
  scope: CandidateMmiPracticeScope;
  targetUniversity: string | null;
  startedAt: string;
  completedAt: string | null;
  status: 'completed' | 'awaiting_scoring' | 'abandoned';
  overallPct: number | null;
  domainAttainment: readonly CandidateMmiDomainAttainment[];
}>;
type CandidateMmiRpcResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string; message?: string }> | null;
}>;
export type CandidateMmiRpcClient = Readonly<{
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<CandidateMmiRpcResult>;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATION_ID_PATTERN = /^MMI_[0-9]{3}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const scenarioKeys = [
  'phase',
  'phaseEndsAt',
  'phaseStartedAt',
  'scenarioText',
  'serverNow',
  'sessionId',
  'stationId',
] as const;
const responseKeys = [
  'draftRevision',
  'draftTranscript',
  'phase',
  'phaseEndsAt',
  'phaseStartedAt',
  'promptOrder',
  'promptText',
  'responseStatus',
  'serverNow',
  'sessionId',
  'stationId',
] as const;
const terminalKeys = [
  'phase',
  'phaseEndsAt',
  'phaseStartedAt',
  'serverNow',
  'sessionId',
  'stationId',
] as const;
const checkpointKeys = [
  'acceptedAt',
  'draftRevision',
  'promptOrder',
  'sessionId',
] as const;
const finalizationKeys = [
  'finalizedAt',
  'promptOrder',
  'responseState',
  'scoringStatus',
  'sessionId',
] as const;
const feedbackKeys = ['assessment', 'legacy', 'promptOrder', 'status'] as const;
const rubricAssessmentKeys = ['criteria', 'questionScorePct', 'schemaVersion'] as const;
const rubricCriterionKeys = ['achieved', 'bulletText', 'criterionId', 'domain', 'weightPct'] as const;
const legacyAssessmentKeys = ['overallPct', 'rubricVersion'] as const;
const practiceOptionKeys = ['allCount', 'targetCount', 'targetTag', 'targetUniversity'] as const;
const resultKeys = ['feedback', 'overallPct', 'sessionId', 'stationId', 'status'] as const;
const historyKeys = ['completedAt', 'domainAttainment', 'overallPct', 'scope', 'sessionId', 'startedAt', 'stationId', 'status', 'targetUniversity'] as const;
const attainmentKeys = ['achieved', 'domain', 'pct', 'total'] as const;
const scoringStatuses = [
  'pending',
  'in_progress',
  'scored',
  'no_response',
  'feedback_unavailable',
  'failed',
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}
function parseIsoTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_PATTERN.test(value))
    return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function codePointLength(value: string): number {
  return Array.from(value).length;
}
function isPublicText(value: unknown, maximumCodePoints = 1_000): value is string {
  return (
    typeof value === 'string' &&
    codePointLength(value) <= maximumCodePoints &&
    value.trim().length > 0
  );
}
function isPromptOrder(value: unknown): value is CandidateMmiPromptOrder {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  );
}
function isScoringStatus(value: unknown): value is CandidateMmiScoringStatus {
  return (
    typeof value === 'string' &&
    (scoringStatuses as readonly string[]).includes(value)
  );
}
function isPracticeScope(value: unknown): value is CandidateMmiPracticeScope {
  return value === 'target' || value === 'all';
}
function isBoundedWhole(value: unknown, maximum = 1_000_000): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
}
function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}
function isValidBaseProjection(value: Record<string, unknown>): boolean {
  return (
    typeof value.sessionId === 'string' &&
    UUID_PATTERN.test(value.sessionId) &&
    typeof value.stationId === 'string' &&
    STATION_ID_PATTERN.test(value.stationId) &&
    parseIsoTimestamp(value.serverNow) !== null &&
    parseIsoTimestamp(value.phaseStartedAt) !== null
  );
}
function hasDuration(startedAt: Date, endsAt: Date, seconds: number): boolean {
  return endsAt.getTime() - startedAt.getTime() === seconds * 1_000;
}
function invalidResponse(): never {
  throw new CandidateMmiApiError('invalid_response');
}

function parseProjection(value: unknown): CandidateMmiServerProjection {
  const projection = record(value);
  if (
    projection === null ||
    !isValidBaseProjection(projection) ||
    typeof projection.phase !== 'string'
  )
    return invalidResponse();
  const serverNow = parseIsoTimestamp(projection.serverNow)!;
  const phaseStartedAt = parseIsoTimestamp(projection.phaseStartedAt)!;
  if (projection.phase === 'scenario') {
    const phaseEndsAt = parseIsoTimestamp(projection.phaseEndsAt);
    if (
      !hasExactKeys(projection, scenarioKeys) ||
      typeof projection.scenarioText !== 'string' ||
      projection.scenarioText.length === 0 ||
      phaseEndsAt === null ||
      !hasDuration(phaseStartedAt, phaseEndsAt, 60) ||
      serverNow < phaseStartedAt ||
      serverNow >= phaseEndsAt
    )
      return invalidResponse();
    return Object.freeze({
      sessionId: projection.sessionId as string,
      stationId: projection.stationId as string,
      serverNow: projection.serverNow as string,
      phase: 'scenario',
      phaseStartedAt: projection.phaseStartedAt as string,
      phaseEndsAt: projection.phaseEndsAt as string,
      scenarioText: projection.scenarioText,
    });
  }
  if (projection.phase === 'response') {
    const phaseEndsAt = parseIsoTimestamp(projection.phaseEndsAt);
    if (
      !hasExactKeys(projection, responseKeys) ||
      !isPromptOrder(projection.promptOrder) ||
      typeof projection.promptText !== 'string' ||
      projection.promptText.length === 0 ||
      typeof projection.draftTranscript !== 'string' ||
      codePointLength(projection.draftTranscript) > 12_000 ||
      typeof projection.draftRevision !== 'number' ||
      !Number.isInteger(projection.draftRevision) ||
      projection.draftRevision < 0 ||
      projection.responseStatus !== 'open' ||
      phaseEndsAt === null ||
      !hasDuration(phaseStartedAt, phaseEndsAt, 120) ||
      serverNow < phaseStartedAt ||
      serverNow >= phaseEndsAt
    )
      return invalidResponse();
    return Object.freeze({
      sessionId: projection.sessionId as string,
      stationId: projection.stationId as string,
      serverNow: projection.serverNow as string,
      phase: 'response',
      phaseStartedAt: projection.phaseStartedAt as string,
      phaseEndsAt: projection.phaseEndsAt as string,
      promptOrder: projection.promptOrder,
      promptText: projection.promptText,
      draftTranscript: projection.draftTranscript,
      draftRevision: projection.draftRevision,
      responseStatus: 'open',
    });
  }
  if (projection.phase === 'completed') {
    if (
      !hasExactKeys(projection, terminalKeys) ||
      projection.phaseEndsAt !== null ||
      serverNow < phaseStartedAt
    )
      return invalidResponse();
    return Object.freeze({
      sessionId: projection.sessionId as string,
      stationId: projection.stationId as string,
      serverNow: projection.serverNow as string,
      phase: 'completed',
      phaseStartedAt: projection.phaseStartedAt as string,
      phaseEndsAt: null,
    });
  }
  if (projection.phase === 'abandoned') {
    const phaseEndsAt = parseIsoTimestamp(projection.phaseEndsAt);
    if (
      !hasExactKeys(projection, terminalKeys) ||
      phaseEndsAt === null ||
      phaseEndsAt.getTime() !== phaseStartedAt.getTime() ||
      serverNow < phaseStartedAt
    )
      return invalidResponse();
    return Object.freeze({
      sessionId: projection.sessionId as string,
      stationId: projection.stationId as string,
      serverNow: projection.serverNow as string,
      phase: 'abandoned',
      phaseStartedAt: projection.phaseStartedAt as string,
      phaseEndsAt: projection.phaseEndsAt as string,
    });
  }
  return invalidResponse();
}
function parseCheckpoint(
  value: unknown,
  sessionId: string,
  promptOrder: CandidateMmiPromptOrder,
  revision: number,
): CandidateMmiCheckpoint {
  const result = record(value);
  if (
    result === null ||
    !hasExactKeys(result, checkpointKeys) ||
    result.sessionId !== sessionId ||
    result.promptOrder !== promptOrder ||
    result.draftRevision !== revision ||
    parseIsoTimestamp(result.acceptedAt) === null
  )
    return invalidResponse();
  return Object.freeze({
    sessionId,
    promptOrder,
    draftRevision: revision,
    acceptedAt: result.acceptedAt as string,
  });
}
function parseFinalization(
  value: unknown,
  sessionId: string,
  promptOrder: CandidateMmiPromptOrder,
): CandidateMmiFinalization {
  const result = record(value);
  if (
    result === null ||
    !hasExactKeys(result, finalizationKeys) ||
    result.sessionId !== sessionId ||
    result.promptOrder !== promptOrder ||
    (result.responseState !== 'response' &&
      result.responseState !== 'no_response') ||
    !isScoringStatus(result.scoringStatus) ||
    parseIsoTimestamp(result.finalizedAt) === null
  )
    return invalidResponse();
  return Object.freeze({
    sessionId,
    promptOrder,
    responseState: result.responseState,
    finalizedAt: result.finalizedAt as string,
    scoringStatus: result.scoringStatus,
  });
}
function parseLegacyAssessment(value: unknown): CandidateMmiLegacyAssessment {
  const result = record(value);
  if (
    result === null ||
    !hasExactKeys(result, legacyAssessmentKeys) ||
    typeof result.overallPct !== 'number' ||
    !Number.isFinite(result.overallPct) ||
    result.overallPct < 0 ||
    result.overallPct > 100 ||
    typeof result.rubricVersion !== 'number' ||
    !Number.isInteger(result.rubricVersion) || result.rubricVersion < 1
  )
    return invalidResponse();
  return Object.freeze({
    overallPct: result.overallPct,
    rubricVersion: result.rubricVersion,
  });
}
export function parseCandidateAssessment(value: unknown): CandidateMmiPublicAssessment {
  const result = record(value);
  if (
    result === null || !hasExactKeys(result, rubricAssessmentKeys) ||
    result.schemaVersion !== 3 || typeof result.questionScorePct !== 'number' ||
    !Number.isFinite(result.questionScorePct) || result.questionScorePct < 0 ||
    result.questionScorePct > 100 || !Array.isArray(result.criteria) ||
    result.criteria.length < 1 || result.criteria.length > 20
  ) return invalidResponse();
  const criteria = result.criteria.map((value) => {
    const criterion = record(value);
    if (
      criterion === null || !hasExactKeys(criterion, rubricCriterionKeys) ||
      !isPublicText(criterion.criterionId, 100) || typeof criterion.achieved !== 'boolean' ||
      typeof criterion.weightPct !== 'number' || !Number.isFinite(criterion.weightPct) ||
      criterion.weightPct <= 0 || criterion.weightPct > 100 ||
      !isPublicText(criterion.bulletText, 2_000) ||
      (criterion.domain !== null && !isPublicText(criterion.domain, 100))
    ) return invalidResponse();
    return Object.freeze({
      criterionId: criterion.criterionId, achieved: criterion.achieved,
      weightPct: criterion.weightPct, bulletText: criterion.bulletText,
      domain: criterion.domain,
    });
  });
  const totalWeight = criteria.reduce((total, criterion) => total + criterion.weightPct, 0);
  const achievedWeight = criteria.reduce(
    (total, criterion) => total + (criterion.achieved ? criterion.weightPct : 0),
    0,
  );
  if (
    new Set(criteria.map((criterion) => criterion.criterionId)).size !== criteria.length ||
    Math.abs(totalWeight - 100) > 0.01 ||
    Math.abs(achievedWeight - result.questionScorePct) > 0.01
  ) return invalidResponse();
  return Object.freeze({
    schemaVersion: 3,
    questionScorePct: result.questionScorePct,
    criteria: Object.freeze(criteria),
  });
}
function parseFeedback(value: unknown): readonly CandidateMmiFeedback[] {
  if (!Array.isArray(value) || value.length !== 5) return invalidResponse();
  return Object.freeze(
    value.map((entry, index) => {
      const row = record(entry);
      const promptOrder = (index + 1) as CandidateMmiPromptOrder;
      if (
        row === null ||
        !hasExactKeys(row, feedbackKeys) ||
        row.promptOrder !== promptOrder ||
        !isScoringStatus(row.status) ||
        typeof row.legacy !== 'boolean' ||
        (row.status === 'scored' && row.assessment === null) ||
        (row.status !== 'scored' && row.status !== 'no_response' && row.assessment !== null) ||
        (row.status !== 'scored' && row.legacy)
      )
        return invalidResponse();
      return Object.freeze({
        promptOrder,
        status: row.status,
        legacy: row.legacy,
        assessment:
          row.status === 'scored'
            ? row.legacy
              ? parseLegacyAssessment(row.assessment)
              : parseCandidateAssessment(row.assessment)
            : row.status === 'no_response'
              ? row.assessment === null ? null : parseCandidateAssessment(row.assessment)
              : null,
      });
    }),
  );
}
function parsePracticeOptions(value: unknown): CandidateMmiPracticeOptions {
  const options = record(value);
  if (
    options === null || !hasExactKeys(options, practiceOptionKeys) ||
    !isBoundedWhole(options.targetCount) || !isBoundedWhole(options.allCount) ||
    options.targetCount > options.allCount ||
    (options.targetUniversity !== null && !isPublicText(options.targetUniversity, 100)) ||
    (options.targetTag !== null && !isPublicText(options.targetTag, 100)) ||
    ((options.targetUniversity === null) !== (options.targetTag === null))
  ) return invalidResponse();
  return Object.freeze({
    targetUniversity: options.targetUniversity,
    targetTag: options.targetTag,
    targetCount: options.targetCount,
    allCount: options.allCount,
  });
}
function parseStationResult(value: unknown): CandidateMmiStationResult {
  const result = record(value);
  if (
    result === null || !hasExactKeys(result, resultKeys) ||
    typeof result.sessionId !== 'string' || !UUID_PATTERN.test(result.sessionId) ||
    typeof result.stationId !== 'string' || !STATION_ID_PATTERN.test(result.stationId) ||
    (result.status !== 'completed' && result.status !== 'awaiting_scoring' && result.status !== 'abandoned') ||
    (result.overallPct !== null && !isScore(result.overallPct)) ||
    !Array.isArray(result.feedback)
  ) return invalidResponse();
  const feedback = parseFeedback(result.feedback);
  if (result.status === 'completed' && result.overallPct === null) return invalidResponse();
  if (result.status !== 'completed' && result.overallPct !== null) return invalidResponse();
  return Object.freeze({
    sessionId: result.sessionId,
    stationId: result.stationId,
    status: result.status,
    overallPct: result.overallPct,
    feedback,
  });
}
function parseHistory(value: unknown): readonly CandidateMmiHistoryItem[] {
  if (!Array.isArray(value) || value.length > 100) return invalidResponse();
  return Object.freeze(value.map((value) => {
    const item = record(value);
    if (
      item === null || !hasExactKeys(item, historyKeys) ||
      typeof item.sessionId !== 'string' || !UUID_PATTERN.test(item.sessionId) ||
      typeof item.stationId !== 'string' || !STATION_ID_PATTERN.test(item.stationId) ||
      !isPracticeScope(item.scope) ||
      (item.targetUniversity !== null && !isPublicText(item.targetUniversity, 100)) ||
      parseIsoTimestamp(item.startedAt) === null ||
      (item.completedAt !== null && parseIsoTimestamp(item.completedAt) === null) ||
      (item.status !== 'completed' && item.status !== 'awaiting_scoring' && item.status !== 'abandoned') ||
      (item.overallPct !== null && !isScore(item.overallPct)) ||
      !Array.isArray(item.domainAttainment) || item.domainAttainment.length > 50
    ) return invalidResponse();
    if ((item.status === 'completed') !== (item.overallPct !== null)) return invalidResponse();
    const domainAttainment = item.domainAttainment.map((value) => {
      const attainment = record(value);
      if (
        attainment === null || !hasExactKeys(attainment, attainmentKeys) ||
        !isPublicText(attainment.domain, 100) || !isBoundedWhole(attainment.achieved, 100) ||
        !isBoundedWhole(attainment.total, 100) || attainment.total < 1 ||
        attainment.achieved > attainment.total || !isScore(attainment.pct) ||
        Math.abs(attainment.pct - (attainment.achieved / attainment.total) * 100) > 0.01
      ) return invalidResponse();
      return Object.freeze({
        domain: attainment.domain,
        achieved: attainment.achieved,
        total: attainment.total,
        pct: attainment.pct,
      });
    });
    return Object.freeze({
      sessionId: item.sessionId,
      stationId: item.stationId,
      scope: item.scope,
      targetUniversity: item.targetUniversity,
      startedAt: item.startedAt as string,
      completedAt: item.completedAt as string | null,
      status: item.status as CandidateMmiHistoryItem['status'],
      overallPct: item.overallPct,
      domainAttainment: Object.freeze(domainAttainment),
    });
  }));
}
function mapRpcError(
  code: string | undefined,
  message: string | undefined,
): CandidateMmiApiError {
  if (code === '42501') return new CandidateMmiApiError('access_denied');
  if (code === '22023') return new CandidateMmiApiError('invalid_request');
  if (code === 'P0001' && message === 'candidate_response_not_open')
    return new CandidateMmiApiError('response_closed');
  if (
    code === 'P0001' &&
    (message === 'candidate_response_deadline_not_reached' ||
      message === 'candidate_feedback_not_ready')
  )
    return new CandidateMmiApiError('response_not_closed');
  if (code === 'P0001' && message === 'stale_candidate_mmi_checkpoint')
    return new CandidateMmiApiError('in_progress');
  return new CandidateMmiApiError('unavailable');
}

export function createCandidateMmiApi(rpc: CandidateMmiRpcClient) {
  async function request<T>(
    name: string,
    args: Record<string, unknown> | undefined,
    parser: (data: unknown) => T,
  ): Promise<T> {
    let result: CandidateMmiRpcResult;
    try {
      result =
        args === undefined ? await rpc.rpc(name) : await rpc.rpc(name, args);
    } catch {
      throw new CandidateMmiApiError('unavailable');
    }
    if (result.error)
      throw mapRpcError(result.error.code, result.error.message);
    return parser(result.data);
  }
  return Object.freeze({
    practiceOptions: (): Promise<CandidateMmiPracticeOptions> =>
      request('get_candidate_mmi_practice_options', undefined, parsePracticeOptions),
    start: (scope?: CandidateMmiPracticeScope): Promise<CandidateMmiServerProjection> =>
      scope !== undefined && !isPracticeScope(scope)
        ? Promise.reject(new CandidateMmiApiError('invalid_request'))
        : request(
            'start_candidate_mmi_station_session',
            scope === undefined ? undefined : { p_scope: scope },
            parseProjection,
          ),
    refresh: (sessionId: string): Promise<CandidateMmiServerProjection> =>
      UUID_PATTERN.test(sessionId)
        ? request(
            'get_candidate_mmi_station_session',
            { p_session_id: sessionId },
            parseProjection,
          )
        : Promise.reject(new CandidateMmiApiError('invalid_request')),
    checkpoint: (
      sessionId: string,
      promptOrder: CandidateMmiPromptOrder,
      transcript: string,
      clientRevision: number,
    ): Promise<CandidateMmiCheckpoint> =>
      !UUID_PATTERN.test(sessionId) ||
      !isPromptOrder(promptOrder) ||
      typeof transcript !== 'string' ||
      codePointLength(transcript) > 12_000 ||
      !Number.isInteger(clientRevision) ||
      clientRevision < 0
        ? Promise.reject(new CandidateMmiApiError('invalid_request'))
        : request(
            'checkpoint_candidate_mmi_station_response',
            {
              p_session_id: sessionId,
              p_prompt_order: promptOrder,
              p_transcript: transcript,
              p_client_revision: clientRevision,
            },
            (value) =>
              parseCheckpoint(value, sessionId, promptOrder, clientRevision),
          ),
    finalize: (
      sessionId: string,
      promptOrder: CandidateMmiPromptOrder,
      finalizationKey: string,
    ): Promise<CandidateMmiFinalization> =>
      !UUID_PATTERN.test(sessionId) ||
      !isPromptOrder(promptOrder) ||
      !UUID_PATTERN.test(finalizationKey)
        ? Promise.reject(new CandidateMmiApiError('invalid_request'))
        : request(
            'finalize_candidate_mmi_station_response',
            {
              p_session_id: sessionId,
              p_prompt_order: promptOrder,
              p_finalization_key: finalizationKey,
            },
            (value) => parseFinalization(value, sessionId, promptOrder),
          ),
    feedback: (sessionId: string): Promise<readonly CandidateMmiFeedback[]> =>
      UUID_PATTERN.test(sessionId)
        ? request(
            'get_candidate_mmi_station_feedback',
            { p_session_id: sessionId },
            parseFeedback,
          )
        : Promise.reject(new CandidateMmiApiError('invalid_request')),
    result: (sessionId: string): Promise<CandidateMmiStationResult> =>
      UUID_PATTERN.test(sessionId)
        ? request('get_candidate_mmi_station_result', { p_session_id: sessionId }, parseStationResult)
        : Promise.reject(new CandidateMmiApiError('invalid_request')),
    history: (limit = 20): Promise<readonly CandidateMmiHistoryItem[]> =>
      !Number.isInteger(limit) || limit < 1 || limit > 100
        ? Promise.reject(new CandidateMmiApiError('invalid_request'))
        : request('list_candidate_mmi_history', { p_limit: limit }, parseHistory),
    abandon: (sessionId: string): Promise<void> =>
      UUID_PATTERN.test(sessionId)
        ? request(
            'abandon_candidate_mmi_station_session',
            { p_session_id: sessionId },
            () => undefined,
          )
        : Promise.reject(new CandidateMmiApiError('invalid_request')),
  });
}
