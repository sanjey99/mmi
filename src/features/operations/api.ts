import { RUNTIME_AREAS, RUNTIME_KINDS, type OperationsDashboard, type RuntimeArea, type RuntimeKind } from './types';

type OperationsErrorKind = 'access_denied' | 'invalid_request' | 'invalid_response' | 'unavailable';
const messages: Readonly<Record<OperationsErrorKind, string>> = {
  access_denied: 'Administrator access is required to view operations.',
  invalid_request: 'The operations request is invalid.',
  invalid_response: 'Operations data could not be verified. Please try again.',
  unavailable: 'Operations are unavailable right now. Please try again.',
};

export class OperationsApiError extends Error {
  readonly kind: OperationsErrorKind;
  constructor(kind: OperationsErrorKind) {
    super(messages[kind]);
    this.name = 'OperationsApiError';
    this.kind = kind;
  }
}

type OperationsRpcClient = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<Readonly<{
    data: unknown;
    error: Readonly<{ code?: string; message?: string }> | null;
  }>>;
}>;

const ISO = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MONEY = /^(?:0|[1-9]\d{0,7})\.\d{8}$/;
const DAY_MS = 86_400_000;
const invalid = (): never => { throw new OperationsApiError('invalid_response'); };

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  const actual = Object.keys(row);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) return invalid();
  return row;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !ISO.test(value) || !Number.isFinite(Date.parse(value))) return invalid();
  if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) return invalid();
  return value;
}
function money(value: unknown): string {
  if (typeof value !== 'string' || !MONEY.test(value)) return invalid();
  return value;
}
function latency(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2_147_483_647) return invalid();
  return value;
}
function counts<const Keys extends readonly string[]>(value: unknown, keys: Keys): Readonly<Record<Keys[number], number>> {
  const row = object(value, keys);
  return Object.fromEntries(keys.map((key) => [key, count(row[key])])) as Readonly<Record<Keys[number], number>>;
}
function breakdown<T extends string>(value: unknown, key: 'kind' | 'area', allowed: readonly T[]): readonly Readonly<{ value: T; count: number }>[] {
  if (!Array.isArray(value) || value.length !== allowed.length) return invalid();
  const parsed = value.map((entry) => {
    const row = object(entry, [key, 'count']);
    if (typeof row[key] !== 'string' || !allowed.includes(row[key] as T)) return invalid();
    return Object.freeze({ value: row[key] as T, count: count(row.count) });
  });
  if (new Set(parsed.map((entry) => entry.value)).size !== allowed.length) return invalid();
  return Object.freeze(parsed);
}

export function parseOperationsDashboard(value: unknown): OperationsDashboard {
  const root = object(value, ['checkedAt', 'periodStart', 'periodEnd', 'cohort', 'activity', 'scoring', 'runtime', 'retention', 'daily']);
  const checkedAt = timestamp(root.checkedAt);
  const periodStart = timestamp(root.periodStart);
  const periodEnd = timestamp(root.periodEnd);
  const today = Math.floor(Date.parse(checkedAt) / DAY_MS) * DAY_MS;
  if (Date.parse(periodStart) !== today - 6 * DAY_MS || Date.parse(periodEnd) !== Date.parse(checkedAt)
    || (root.cohort !== 'testers' && root.cohort !== 'all')) return invalid();
  const activity = counts(root.activity, ['accountsCreated', 'practisingUsers', 'stationsStarted', 'stationsFinished', 'stationsAbandoned', 'reportsSubmitted']);
  const scoringRoot = object(root.scoring, ['isConfigured', 'pendingResponses', 'failedResponses', 'expiredResponses', 'stalledClaims', 'providerCalls', 'providerFailures', 'invalidResponses', 'persistenceFailures', 'recentCalls', 'recentFailures', 'knownCostUsd', 'unknownCostCalls', 'averageLatencyMs', 'p95LatencyMs']);
  if (typeof scoringRoot.isConfigured !== 'boolean') return invalid();
  const scoring = {
    isConfigured: scoringRoot.isConfigured,
    ...counts(Object.fromEntries(Object.entries(scoringRoot).filter(([key]) => !['isConfigured', 'knownCostUsd', 'averageLatencyMs', 'p95LatencyMs'].includes(key))), ['pendingResponses', 'failedResponses', 'expiredResponses', 'stalledClaims', 'providerCalls', 'providerFailures', 'invalidResponses', 'persistenceFailures', 'recentCalls', 'recentFailures', 'unknownCostCalls']),
    knownCostUsd: money(scoringRoot.knownCostUsd), averageLatencyMs: latency(scoringRoot.averageLatencyMs), p95LatencyMs: latency(scoringRoot.p95LatencyMs),
  };
  if (scoring.providerFailures + scoring.invalidResponses + scoring.persistenceFailures > scoring.providerCalls
    || scoring.unknownCostCalls > scoring.providerCalls || scoring.recentCalls > scoring.providerCalls
    || scoring.recentFailures > scoring.recentCalls
    || (scoring.providerCalls === 0) !== (scoring.averageLatencyMs === null)
    || (scoring.providerCalls === 0) !== (scoring.p95LatencyMs === null)) return invalid();
  const runtimeRoot = object(root.runtime, ['recordedErrors', 'affectedAccounts', 'limitedAccounts', 'recentAffectedAccounts', 'byKind', 'byArea']);
  const runtimeCounts = counts(Object.fromEntries(Object.entries(runtimeRoot).filter(([key]) => !['byKind', 'byArea'].includes(key))), ['recordedErrors', 'affectedAccounts', 'limitedAccounts', 'recentAffectedAccounts']);
  const byKind = breakdown<RuntimeKind>(runtimeRoot.byKind, 'kind', RUNTIME_KINDS).map((row) => Object.freeze({ kind: row.value, count: row.count }));
  const byArea = breakdown<RuntimeArea>(runtimeRoot.byArea, 'area', RUNTIME_AREAS).map((row) => Object.freeze({ area: row.value, count: row.count }));
  if (byKind.reduce((sum, row) => sum + row.count, 0) !== runtimeCounts.recordedErrors
    || byArea.reduce((sum, row) => sum + row.count, 0) !== runtimeCounts.recordedErrors
    || runtimeCounts.limitedAccounts > runtimeCounts.affectedAccounts
    || runtimeCounts.recentAffectedAccounts > runtimeCounts.affectedAccounts
    || runtimeCounts.affectedAccounts > runtimeCounts.recordedErrors) return invalid();
  const retentionRoot = object(root.retention, ['jobActive', 'lastCompletedAt', 'heartbeatAgeSeconds', 'overdueResponses', 'overdueDrafts']);
  if (typeof retentionRoot.jobActive !== 'boolean') return invalid();
  const lastCompletedAt = retentionRoot.lastCompletedAt === null ? null : timestamp(retentionRoot.lastCompletedAt);
  const heartbeatAgeSeconds = retentionRoot.heartbeatAgeSeconds === null ? null : count(retentionRoot.heartbeatAgeSeconds);
  if ((lastCompletedAt === null) !== (heartbeatAgeSeconds === null)) return invalid();
  if (!Array.isArray(root.daily) || root.daily.length !== 7) return invalid();
  const daily = root.daily.map((entry, index) => {
    const row = object(entry, ['date', 'practisingUsers', 'stationsStarted', 'stationsFinished', 'providerCalls', 'providerFailures', 'knownCostUsd', 'unknownCostCalls', 'runtimeErrors']);
    const date = new Date(Date.parse(periodStart) + index * DAY_MS).toISOString().slice(0, 10);
    if (row.date !== date) return invalid();
    const numbers = counts(Object.fromEntries(Object.entries(row).filter(([key]) => !['date', 'knownCostUsd'].includes(key))), ['practisingUsers', 'stationsStarted', 'stationsFinished', 'providerCalls', 'providerFailures', 'unknownCostCalls', 'runtimeErrors']);
    if (numbers.providerFailures > numbers.providerCalls || numbers.unknownCostCalls > numbers.providerCalls) return invalid();
    return Object.freeze({ date, ...numbers, knownCostUsd: money(row.knownCostUsd) });
  });
  return Object.freeze({
    checkedAt, periodStart, periodEnd, cohort: root.cohort,
    activity: Object.freeze(activity), scoring: Object.freeze(scoring),
    runtime: Object.freeze({ ...runtimeCounts, byKind: Object.freeze(byKind), byArea: Object.freeze(byArea) }),
    retention: Object.freeze({ jobActive: retentionRoot.jobActive, lastCompletedAt, heartbeatAgeSeconds, overdueResponses: count(retentionRoot.overdueResponses), overdueDrafts: count(retentionRoot.overdueDrafts) }),
    daily: Object.freeze(daily),
  });
}

export function createOperationsApi(client: OperationsRpcClient) {
  return Object.freeze({
    async getOperationsDashboard(testersOnly = true): Promise<OperationsDashboard> {
      if (typeof testersOnly !== 'boolean') throw new OperationsApiError('invalid_request');
      let result: Awaited<ReturnType<OperationsRpcClient['rpc']>>;
      try { result = await client.rpc('get_mmi_operations_dashboard', { p_testers_only: testersOnly }); }
      catch { throw new OperationsApiError('unavailable'); }
      if (result.error) throw new OperationsApiError(result.error.code === '42501' ? 'access_denied' : 'unavailable');
      const dashboard = parseOperationsDashboard(result.data);
      if (dashboard.cohort !== (testersOnly ? 'testers' : 'all')) return invalid();
      return dashboard;
    },
  });
}
