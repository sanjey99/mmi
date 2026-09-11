import type {
  AdminMmiAiConfig,
  AdminMmiAiConfigInput,
  AdminMmiAssessmentDetail,
  AdminMmiAssessmentFilters,
  AdminMmiAssessmentList,
  AdminMmiAssessmentPurpose,
  AdminMmiContentStatus,
  AdminMmiDashboard,
  AdminMmiDifficulty,
  AdminMmiMutationConfirmation,
  AdminMmiPageFilters,
  AdminMmiPanel,
  AdminMmiPanelList,
  AdminMmiProvider,
  AdminMmiRpcClient,
  AdminMmiRpcResult,
  AdminMmiStationDetail,
  AdminMmiStationDraft,
  AdminMmiStationFilters,
  AdminMmiStationList,
  AdminMmiUsage,
  AdminMmiUsageFilters,
  AdminMmiUsageRow,
} from './types';
import { validateStationDraft } from './validation';

export type AdminMmiApiErrorKind =
  | 'access_denied'
  | 'invalid_request'
  | 'invalid_response'
  | 'version_conflict'
  | 'unavailable';

const messages: Readonly<Record<AdminMmiApiErrorKind, string>> = Object.freeze({
  access_denied: 'Admin MMI access is denied.',
  invalid_request: 'Admin MMI request is invalid.',
  invalid_response: 'Admin MMI response is invalid.',
  version_conflict: 'This content changed. Reload it before saving again.',
  unavailable: 'Admin MMI operations are unavailable.',
});

export class AdminMmiApiError extends Error {
  readonly kind: AdminMmiApiErrorKind;
  constructor(kind: AdminMmiApiErrorKind) {
    super(messages[kind]);
    this.name = 'AdminMmiApiError';
    this.kind = kind;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,7})\.\d{8}$/;
const providers = new Set<AdminMmiProvider>(['anthropic', 'openai', 'openai_compatible']);
const difficulties = new Set<AdminMmiDifficulty>(['foundation', 'intermediate', 'advanced']);
const statuses = new Set<AdminMmiContentStatus>(['draft', 'published', 'archived']);
const purposes = new Set<AdminMmiAssessmentPurpose>(['scoring_review', 'support', 'cost_review', 'quality_audit']);
const outcomes = new Set<AdminMmiUsageRow['outcome']>(['scored', 'provider_failed', 'invalid_response', 'persistence_failed']);

function invalidResponse(): never { throw new AdminMmiApiError('invalid_response'); }
function invalidRequest(): never { throw new AdminMmiApiError('invalid_request'); }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalidResponse();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalidResponse();
}
function hasForbiddenKey(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKey(item, seen));
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return normalized.includes('transcript')
      || normalized.includes('answertext')
      || normalized.includes('evidence')
      || /raw.*response/.test(normalized)
      || normalized.includes('apikey')
      || hasForbiddenKey(nested, seen);
  });
}
function safeResponse(value: unknown): void {
  if (hasForbiddenKey(value)) invalidResponse();
}
function text(value: unknown, maximum = 1_000, allowEmpty = false): string {
  if (typeof value !== 'string' || Array.from(value).length > maximum || (!allowEmpty && value.trim().length === 0)) return invalidResponse();
  return value;
}
function nullableText(value: unknown, maximum = 1_000): string | null {
  return value === null ? null : text(value, maximum);
}
function whole(value: unknown, maximum = 1_000_000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) return invalidResponse();
  return value;
}
function positiveWhole(value: unknown, maximum = 1_000_000): number {
  const parsed = whole(value, maximum);
  if (parsed < 1) invalidResponse();
  return parsed;
}
function decimal(value: unknown, maximum = 100): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) return invalidResponse();
  return value;
}
function uuid(value: unknown): string {
  const parsed = text(value, 36);
  if (!UUID_PATTERN.test(parsed)) invalidResponse();
  return parsed;
}
function sourceId(value: unknown): string {
  const parsed = text(value, 100);
  if (!SOURCE_ID_PATTERN.test(parsed)) invalidResponse();
  return parsed;
}
function timestamp(value: unknown): string {
  const parsed = text(value, 40);
  if (!ISO_TIMESTAMP_PATTERN.test(parsed) || !Number.isFinite(new Date(parsed).getTime())) invalidResponse();
  return parsed;
}
function money(value: unknown): string {
  const parsed = text(value, 17);
  if (!MONEY_PATTERN.test(parsed)) invalidResponse();
  return parsed;
}
function optionalMoney(value: unknown): string | null { return value === null ? null : money(value); }
function provider(value: unknown): AdminMmiProvider {
  if (typeof value !== 'string' || !providers.has(value as AdminMmiProvider)) return invalidResponse();
  return value as AdminMmiProvider;
}
function difficulty(value: unknown): AdminMmiDifficulty {
  if (typeof value !== 'string' || !difficulties.has(value as AdminMmiDifficulty)) return invalidResponse();
  return value as AdminMmiDifficulty;
}
function status(value: unknown): AdminMmiContentStatus {
  if (typeof value !== 'string' || !statuses.has(value as AdminMmiContentStatus)) return invalidResponse();
  return value as AdminMmiContentStatus;
}
function outcome(value: unknown): AdminMmiUsageRow['outcome'] {
  if (typeof value !== 'string' || !outcomes.has(value as AdminMmiUsageRow['outcome'])) return invalidResponse();
  return value as AdminMmiUsageRow['outcome'];
}
function stringArray(value: unknown, maximumItems = 100): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) return invalidResponse();
  const parsed = value.map((item) => text(item, 100));
  if (new Set(parsed).size !== parsed.length) invalidResponse();
  return Object.freeze(parsed);
}
function nullableTokens(value: unknown): number | null { return value === null ? null : whole(value, Number.MAX_SAFE_INTEGER); }

function parseDashboard(value: unknown): AdminMmiDashboard {
  safeResponse(value);
  const root = record(value); exact(root, ['ai', 'contentHealth', 'stationCounts', 'universityCounts', 'usage']);
  const counts = record(root.stationCounts); exact(counts, ['archived', 'draft', 'published']);
  const health = record(root.contentHealth); exact(health, ['criterionCount', 'invalidStationCount', 'questionCount', 'stationCount']);
  const ai = record(root.ai); exact(ai, ['isConfigured', 'model', 'provider']);
  const usage = record(root.usage); exact(usage, ['callCount', 'failureCount', 'knownCost', 'unknownCostCount']);
  if (!Array.isArray(root.universityCounts) || root.universityCounts.length > 200 || typeof ai.isConfigured !== 'boolean') invalidResponse();
  const universityCounts = root.universityCounts.map((entry) => {
    const row = record(entry); exact(row, ['count', 'tag']);
    return Object.freeze({ tag: text(row.tag, 100), count: whole(row.count) });
  });
  return Object.freeze({
    stationCounts: Object.freeze({ draft: whole(counts.draft), published: whole(counts.published), archived: whole(counts.archived) }),
    universityCounts: Object.freeze(universityCounts),
    contentHealth: Object.freeze({ stationCount: whole(health.stationCount), questionCount: whole(health.questionCount), criterionCount: whole(health.criterionCount), invalidStationCount: whole(health.invalidStationCount) }),
    ai: Object.freeze({ provider: provider(ai.provider), model: text(ai.model, 200), isConfigured: ai.isConfigured }),
    usage: Object.freeze({ callCount: whole(usage.callCount), knownCost: money(usage.knownCost), unknownCostCount: whole(usage.unknownCostCount), failureCount: whole(usage.failureCount) }),
  });
}

function parseStationRaw(value: unknown, mode: 'draft' | 'publish'): AdminMmiStationDraft {
  const root = record(value); exact(root, ['category', 'difficulty', 'expectedVersion', 'imageUrl', 'prepTimeSec', 'questions', 'scenarioText', 'stationId', 'topic', 'universityTags']);
  if (!Array.isArray(root.questions) || root.questions.length > 5) invalidResponse();
  const questions = root.questions.map((entry) => {
    const question = record(entry); exact(question, ['criteria', 'modelAnswerCached', 'order', 'questionText', 'subQuestionId', 'timeLimitSec']);
    if (!Array.isArray(question.criteria) || question.criteria.length > 20) invalidResponse();
    const criteria = question.criteria.map((entry) => {
      const criterion = record(entry); exact(criterion, ['bulletText', 'criterionId', 'domain', 'order', 'sourceWeight']);
      return Object.freeze({
        criterionId: sourceId(criterion.criterionId), order: positiveWhole(criterion.order, 20),
        bulletText: text(criterion.bulletText, 2_000), domain: nullableText(criterion.domain, 100),
        sourceWeight: decimal(criterion.sourceWeight, 1_000_000),
      });
    });
    if (question.timeLimitSec !== 120) invalidResponse();
    return Object.freeze({
      subQuestionId: sourceId(question.subQuestionId), order: positiveWhole(question.order, 5),
      questionText: text(question.questionText, 10_000, mode === 'draft'), timeLimitSec: 120 as const,
      modelAnswerCached: nullableText(question.modelAnswerCached, 20_000), criteria: Object.freeze(criteria),
    });
  });
  if (root.prepTimeSec !== 60 || (root.expectedVersion !== null && (!Number.isSafeInteger(root.expectedVersion) || Number(root.expectedVersion) < 1))) invalidResponse();
  const candidate: AdminMmiStationDraft = {
    stationId: sourceId(root.stationId), expectedVersion: root.expectedVersion as number | null,
    category: text(root.category, 100, mode === 'draft'), topic: text(root.topic, 100, mode === 'draft'),
    difficulty: difficulty(root.difficulty), universityTags: stringArray(root.universityTags), prepTimeSec: 60,
    imageUrl: nullableText(root.imageUrl, 2_000), scenarioText: text(root.scenarioText, 10_000, mode === 'draft'),
    questions: Object.freeze(questions),
  };
  const validation = validateStationDraft(candidate, mode);
  if (validation.issues.length > 0) invalidResponse();
  return validation.value;
}

function parseStationList(value: unknown): AdminMmiStationList {
  safeResponse(value);
  const root = record(value); exact(root, ['items', 'total']);
  if (!Array.isArray(root.items) || root.items.length > 100) invalidResponse();
  const items = root.items.map((entry) => {
    const row = record(entry); exact(row, ['category', 'contentVersion', 'criterionCount', 'difficulty', 'isComplete', 'prepTimeSec', 'questionCount', 'stationId', 'status', 'topic', 'universityTags', 'updatedAt']);
    if (typeof row.isComplete !== 'boolean') invalidResponse();
    return Object.freeze({
      stationId: sourceId(row.stationId), category: text(row.category, 100), topic: text(row.topic, 100),
      difficulty: difficulty(row.difficulty), universityTags: stringArray(row.universityTags), prepTimeSec: positiveWhole(row.prepTimeSec, 3_600),
      status: status(row.status), contentVersion: positiveWhole(row.contentVersion), questionCount: whole(row.questionCount, 20),
      criterionCount: whole(row.criterionCount, 400), isComplete: row.isComplete, updatedAt: timestamp(row.updatedAt),
    });
  });
  return Object.freeze({ items: Object.freeze(items), total: whole(root.total) });
}

function parseStationDetail(value: unknown): AdminMmiStationDetail {
  safeResponse(value);
  const root = record(value); exact(root, ['contentVersion', 'station', 'status']);
  const contentVersion = positiveWhole(root.contentVersion);
  const currentStatus = status(root.status);
  const station = parseStationRaw(root.station, currentStatus === 'published' ? 'publish' : 'draft');
  if (station.expectedVersion !== contentVersion) invalidResponse();
  return Object.freeze({ station, status: currentStatus, contentVersion });
}

function parsePanel(value: unknown): AdminMmiPanel {
  const row = record(value); exact(row, ['difficulty', 'modelAnswerCached', 'notes', 'questionId', 'questionText', 'stationType', 'status', 'topic', 'universityTags', 'updatedAt']);
  return Object.freeze({
    questionId: sourceId(row.questionId), questionText: text(row.questionText, 10_000), stationType: text(row.stationType, 100),
    topic: text(row.topic, 100), difficulty: difficulty(row.difficulty), universityTags: stringArray(row.universityTags),
    notes: nullableText(row.notes, 20_000), modelAnswerCached: nullableText(row.modelAnswerCached, 20_000),
    status: status(row.status), updatedAt: timestamp(row.updatedAt),
  });
}
function parsePanelList(value: unknown): AdminMmiPanelList {
  safeResponse(value);
  const root = record(value); exact(root, ['items', 'total']);
  if (!Array.isArray(root.items) || root.items.length > 100) invalidResponse();
  return Object.freeze({ items: Object.freeze(root.items.map(parsePanel)), total: whole(root.total) });
}

function parseAiConfig(value: unknown): AdminMmiAiConfig {
  safeResponse(value);
  const root = record(value); exact(root, ['baseUrl', 'cachedInputRatePerMillion', 'inputRatePerMillion', 'isConfigured', 'model', 'outputRatePerMillion', 'provider', 'updatedAt']);
  if (typeof root.isConfigured !== 'boolean') invalidResponse();
  return Object.freeze({
    provider: provider(root.provider), model: text(root.model, 200), baseUrl: nullableText(root.baseUrl, 2_000),
    inputRatePerMillion: decimal(root.inputRatePerMillion, 99_999_999.999999),
    cachedInputRatePerMillion: decimal(root.cachedInputRatePerMillion, 99_999_999.999999),
    outputRatePerMillion: decimal(root.outputRatePerMillion, 99_999_999.999999),
    isConfigured: root.isConfigured, updatedAt: timestamp(root.updatedAt),
  });
}

function parseUsage(value: unknown): AdminMmiUsage {
  safeResponse(value);
  const root = record(value); exact(root, ['rows', 'summary']);
  const summary = record(root.summary); exact(summary, ['averageLatencyMs', 'cachedInputTokens', 'callCount', 'failureRatePct', 'inputTokens', 'knownCost', 'outputTokens', 'unknownCostCount']);
  if (!Array.isArray(root.rows) || root.rows.length > 100) invalidResponse();
  const rows = root.rows.map((entry) => {
    const row = record(entry); exact(row, ['cachedInputTokens', 'createdAt', 'estimatedCost', 'inputTokens', 'latencyMs', 'model', 'outcome', 'outputTokens', 'promptOrder', 'provider', 'responseId', 'scope', 'sessionId', 'stationId', 'targetUniversity', 'usageId', 'userDisplayName', 'userId']);
    if (row.scope !== null && row.scope !== 'target' && row.scope !== 'all') invalidResponse();
    return Object.freeze({
      usageId: uuid(row.usageId), userId: uuid(row.userId), userDisplayName: text(row.userDisplayName, 200), sessionId: uuid(row.sessionId),
      responseId: uuid(row.responseId), stationId: sourceId(row.stationId), promptOrder: positiveWhole(row.promptOrder, 5), scope: row.scope,
      targetUniversity: nullableText(row.targetUniversity, 100), provider: text(row.provider, 100), model: text(row.model, 200),
      inputTokens: nullableTokens(row.inputTokens), cachedInputTokens: nullableTokens(row.cachedInputTokens), outputTokens: nullableTokens(row.outputTokens),
      estimatedCost: optionalMoney(row.estimatedCost), latencyMs: whole(row.latencyMs, 2_147_483_647), outcome: outcome(row.outcome), createdAt: timestamp(row.createdAt),
    });
  });
  return Object.freeze({
    summary: Object.freeze({
      callCount: whole(summary.callCount), inputTokens: whole(summary.inputTokens, Number.MAX_SAFE_INTEGER),
      cachedInputTokens: whole(summary.cachedInputTokens, Number.MAX_SAFE_INTEGER), outputTokens: whole(summary.outputTokens, Number.MAX_SAFE_INTEGER),
      knownCost: money(summary.knownCost), unknownCostCount: whole(summary.unknownCostCount),
      averageLatencyMs: decimal(summary.averageLatencyMs, 2_147_483_647), failureRatePct: decimal(summary.failureRatePct),
    }),
    rows: Object.freeze(rows),
  });
}

function parseAssessmentList(value: unknown): AdminMmiAssessmentList {
  safeResponse(value);
  const root = record(value); exact(root, ['items', 'total']);
  if (!Array.isArray(root.items) || root.items.length > 100) invalidResponse();
  const items = root.items.map((entry) => {
    const row = record(entry); exact(row, ['costKnown', 'estimatedCost', 'model', 'outcome', 'promptOrder', 'provider', 'questionScorePct', 'responseId', 'scoredAt', 'stationId', 'userDisplayName', 'userId']);
    if (typeof row.costKnown !== 'boolean' || row.costKnown !== (row.estimatedCost !== null)) invalidResponse();
    return Object.freeze({
      responseId: uuid(row.responseId), userId: uuid(row.userId), userDisplayName: text(row.userDisplayName, 200), stationId: sourceId(row.stationId),
      promptOrder: positiveWhole(row.promptOrder, 5), questionScorePct: decimal(row.questionScorePct), provider: nullableText(row.provider, 100),
      model: nullableText(row.model, 200), estimatedCost: optionalMoney(row.estimatedCost), costKnown: row.costKnown,
      outcome: row.outcome === null ? null : outcome(row.outcome), scoredAt: timestamp(row.scoredAt),
    });
  });
  return Object.freeze({ items: Object.freeze(items), total: whole(root.total) });
}

function parseAssessment(value: unknown): AdminMmiAssessmentDetail {
  safeResponse(value);
  const root = record(value); exact(root, ['accessAuditId', 'cachedInputTokens', 'criteria', 'estimatedCost', 'finalizedAt', 'inputTokens', 'latencyMs', 'model', 'outcome', 'outputTokens', 'promptOrder', 'provider', 'questionScorePct', 'responseId', 'scoredAt', 'stationId', 'userDisplayName', 'userId']);
  if (!Array.isArray(root.criteria) || root.criteria.length < 1 || root.criteria.length > 20) invalidResponse();
  const criteria = root.criteria.map((entry) => {
    const row = record(entry); exact(row, ['achieved', 'bulletText', 'criterionId', 'domain', 'weightPct']);
    if (typeof row.achieved !== 'boolean') invalidResponse();
    return Object.freeze({ criterionId: sourceId(row.criterionId), bulletText: text(row.bulletText, 2_000), domain: nullableText(row.domain, 100), achieved: row.achieved, weightPct: decimal(row.weightPct) });
  });
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weightPct, 0);
  const achievedWeight = criteria.reduce((sum, criterion) => sum + (criterion.achieved ? criterion.weightPct : 0), 0);
  const questionScorePct = decimal(root.questionScorePct);
  if (new Set(criteria.map((item) => item.criterionId)).size !== criteria.length || Math.abs(totalWeight - 100) > 0.01 || Math.abs(achievedWeight - questionScorePct) > 0.01) invalidResponse();
  return Object.freeze({
    accessAuditId: uuid(root.accessAuditId), responseId: uuid(root.responseId), userId: uuid(root.userId), userDisplayName: text(root.userDisplayName, 200),
    stationId: sourceId(root.stationId), promptOrder: positiveWhole(root.promptOrder, 5), questionScorePct, criteria: Object.freeze(criteria),
    provider: nullableText(root.provider, 100), model: nullableText(root.model, 200), inputTokens: nullableTokens(root.inputTokens),
    cachedInputTokens: nullableTokens(root.cachedInputTokens), outputTokens: nullableTokens(root.outputTokens), estimatedCost: optionalMoney(root.estimatedCost),
    latencyMs: root.latencyMs === null ? null : whole(root.latencyMs, 2_147_483_647), outcome: root.outcome === null ? null : outcome(root.outcome),
    finalizedAt: timestamp(root.finalizedAt), scoredAt: timestamp(root.scoredAt),
  });
}

function parseConfirmation(value: unknown): AdminMmiMutationConfirmation {
  safeResponse(value);
  const root = record(value); exact(root, ['auditId', 'ok', 'targetId', 'version']);
  if (root.ok !== true || (root.version !== null && (!Number.isSafeInteger(root.version) || Number(root.version) < 1))) invalidResponse();
  return Object.freeze({ ok: true, auditId: uuid(root.auditId), targetId: sourceId(root.targetId), version: root.version as number | null });
}

function validPage(filters: AdminMmiPageFilters): boolean {
  return Number.isSafeInteger(filters.limit) && filters.limit >= 1 && filters.limit <= 100
    && Number.isSafeInteger(filters.offset) && filters.offset >= 0 && filters.offset <= 1_000_000;
}
function inputText(value: unknown, maximum: number, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string') return invalidRequest();
  const normalized = value.trim();
  if ((!optional && normalized.length === 0) || Array.from(normalized).length > maximum) return invalidRequest();
  return normalized || undefined;
}
function validateDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!ISO_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(new Date(value).getTime())) return invalidRequest();
  return value;
}
function publicHttpsBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password
      && host !== 'localhost' && host !== '::1' && host !== '0.0.0.0' && host !== '127.0.0.1'
      && !/^10\./.test(host) && !/^192\.168\./.test(host) && !/^169\.254\./.test(host)
      && !/^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  } catch { return false; }
}
function normalizeAiConfig(input: AdminMmiAiConfigInput): AdminMmiAiConfigInput {
  if (!providers.has(input.provider) || typeof input.model !== 'string') return invalidRequest();
  const model = input.model.trim();
  if (!model || Array.from(model).length > 200) return invalidRequest();
  for (const rate of [input.inputRatePerMillion, input.cachedInputRatePerMillion, input.outputRatePerMillion]) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 99_999_999.999999) return invalidRequest();
  }
  const baseUrl = input.baseUrl === null ? null : input.baseUrl.trim();
  if (input.provider === 'openai_compatible') {
    if (!baseUrl || Array.from(baseUrl).length > 2_000 || !publicHttpsBaseUrl(baseUrl)) return invalidRequest();
  } else if (baseUrl !== null && baseUrl !== '') return invalidRequest();
  return Object.freeze({ ...input, model, baseUrl: baseUrl || null });
}
function mapError(error: NonNullable<AdminMmiRpcResult['error']>): AdminMmiApiError {
  if (error.code === '42501') return new AdminMmiApiError('access_denied');
  if (error.code === '22023') return new AdminMmiApiError('invalid_request');
  if (error.code === '40001' || error.message === 'mmi_station_version_conflict') return new AdminMmiApiError('version_conflict');
  return new AdminMmiApiError('unavailable');
}

export function createAdminMmiApi(client: AdminMmiRpcClient) {
  async function request<T>(name: string, args: Record<string, unknown> | undefined, parser: (value: unknown) => T): Promise<T> {
    let result: AdminMmiRpcResult;
    try { result = args === undefined ? await client.rpc(name) : await client.rpc(name, args); }
    catch { throw new AdminMmiApiError('unavailable'); }
    if (result.error) throw mapError(result.error);
    return parser(result.data);
  }
  return Object.freeze({
    getDashboard: () => request('get_admin_mmi_dashboard', undefined, parseDashboard),
    listStations: (filters: AdminMmiStationFilters) => {
      if (!validPage(filters)) return Promise.reject(new AdminMmiApiError('invalid_request'));
      if (filters.status !== undefined && !statuses.has(filters.status)) return Promise.reject(new AdminMmiApiError('invalid_request'));
      let query: string | undefined; let university: string | undefined;
      try { query = inputText(filters.query, 200, true); university = inputText(filters.university, 100, true)?.toLowerCase(); }
      catch (error) { return Promise.reject(error); }
      return request('list_admin_mmi_stations', { p_query: query ?? null, p_status: filters.status ?? null, p_university: university ?? null, p_limit: filters.limit, p_offset: filters.offset }, parseStationList);
    },
    getStation: (stationId: string) => SOURCE_ID_PATTERN.test(stationId)
      ? request('get_admin_mmi_station', { p_station_id: stationId }, parseStationDetail)
      : Promise.reject(new AdminMmiApiError('invalid_request')),
    saveStation: (station: AdminMmiStationDraft) => {
      const validation = validateStationDraft(station, 'draft');
      if (validation.issues.length > 0) return Promise.reject(new AdminMmiApiError('invalid_request'));
      return request('save_admin_mmi_station', { p_station: validation.value, p_expected_version: validation.value.expectedVersion }, parseConfirmation);
    },
    setStationStatus: (stationId: string, expectedVersion: number, nextStatus: AdminMmiContentStatus) => SOURCE_ID_PATTERN.test(stationId) && Number.isSafeInteger(expectedVersion) && expectedVersion > 0 && statuses.has(nextStatus)
      ? request('set_admin_mmi_station_status', { p_station_id: stationId, p_expected_version: expectedVersion, p_status: nextStatus }, parseConfirmation)
      : Promise.reject(new AdminMmiApiError('invalid_request')),
    listPanels: (filters: AdminMmiPageFilters) => validPage(filters)
      ? request('list_admin_mmi_panels', { p_limit: filters.limit, p_offset: filters.offset }, parsePanelList)
      : Promise.reject(new AdminMmiApiError('invalid_request')),
    savePanel: (panel: Omit<AdminMmiPanel, 'updatedAt'>) => {
      try {
        const normalized = {
          questionId: sourceId(panel.questionId), questionText: text(panel.questionText.trim(), 10_000), stationType: text(panel.stationType.trim(), 100),
          topic: text(panel.topic.trim(), 100), difficulty: difficulty(panel.difficulty), universityTags: stringArray(panel.universityTags.map((tag) => tag.trim().toLowerCase())),
          notes: panel.notes === null ? null : text(panel.notes.trim(), 20_000), modelAnswerCached: panel.modelAnswerCached === null ? null : text(panel.modelAnswerCached.trim(), 20_000), status: status(panel.status),
        };
        return request('save_admin_mmi_panel', { p_panel: normalized }, parseConfirmation);
      } catch { return Promise.reject(new AdminMmiApiError('invalid_request')); }
    },
    getAiConfig: () => request('get_admin_ai_config', undefined, parseAiConfig),
    saveAiConfig: (input: AdminMmiAiConfigInput) => {
      try {
        const normalized = normalizeAiConfig(input);
        return request('save_admin_ai_config', {
          p_provider: normalized.provider, p_model: normalized.model, p_base_url: normalized.baseUrl,
          p_input_rate: normalized.inputRatePerMillion, p_cached_input_rate: normalized.cachedInputRatePerMillion,
          p_output_rate: normalized.outputRatePerMillion,
        }, parseConfirmation);
      } catch { return Promise.reject(new AdminMmiApiError('invalid_request')); }
    },
    getUsage: (filters: AdminMmiUsageFilters) => {
      if (!validPage(filters)) return Promise.reject(new AdminMmiApiError('invalid_request'));
      let normalized: AdminMmiUsageFilters;
      try { normalized = { ...filters, from: validateDate(filters.from), to: validateDate(filters.to) }; }
      catch (error) { return Promise.reject(error); }
      if ((normalized.userId && !UUID_PATTERN.test(normalized.userId)) || (normalized.stationId && !SOURCE_ID_PATTERN.test(normalized.stationId)) || (normalized.scope && normalized.scope !== 'target' && normalized.scope !== 'all') || (normalized.outcome && !outcomes.has(normalized.outcome))) return Promise.reject(new AdminMmiApiError('invalid_request'));
      return request('get_admin_mmi_usage', { p_filters: normalized }, parseUsage);
    },
    listAssessments: (filters: AdminMmiAssessmentFilters) => {
      if (!validPage(filters)) return Promise.reject(new AdminMmiApiError('invalid_request'));
      let normalized: AdminMmiAssessmentFilters;
      try { normalized = { ...filters, from: validateDate(filters.from), to: validateDate(filters.to) }; }
      catch (error) { return Promise.reject(error); }
      if ((normalized.userId && !UUID_PATTERN.test(normalized.userId)) || (normalized.stationId && !SOURCE_ID_PATTERN.test(normalized.stationId))) return Promise.reject(new AdminMmiApiError('invalid_request'));
      return request('list_admin_mmi_assessments', { p_filters: normalized }, parseAssessmentList);
    },
    getAssessment: (responseId: string, purpose: AdminMmiAssessmentPurpose) => UUID_PATTERN.test(responseId) && purposes.has(purpose)
      ? request('get_admin_mmi_assessment', { p_response_id: responseId, p_purpose: purpose }, parseAssessment)
      : Promise.reject(new AdminMmiApiError('invalid_request')),
  });
}
