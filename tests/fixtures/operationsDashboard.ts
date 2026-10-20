import { RUNTIME_AREAS, RUNTIME_KINDS, type OperationsDashboard } from '../../src/features/operations/types';

export function operationsDashboardFixture(cohort: 'testers' | 'all' = 'testers', empty = false): OperationsDashboard {
  const starts = [2, 1, 3, 4, 2, 5, 3];
  const finishes = [1, 1, 2, 3, 1, 3, 2];
  const failures = [0, 1, 1, 2, 0, 1, 1];
  return {
    checkedAt: '2026-10-20T12:00:00.000Z', periodStart: '2026-10-14T00:00:00.000Z', periodEnd: '2026-10-20T12:00:00.000Z', cohort,
    activity: { accountsCreated: empty ? 0 : 5, practisingUsers: empty ? 0 : 8, stationsStarted: empty ? 0 : 20, stationsFinished: empty ? 0 : 13, stationsAbandoned: empty ? 0 : 2, reportsSubmitted: empty ? 0 : 2 },
    scoring: { isConfigured: true, pendingResponses: empty ? 0 : 4, failedResponses: empty ? 0 : 2, expiredResponses: empty ? 0 : 1, stalledClaims: empty ? 0 : 1, providerCalls: empty ? 0 : 80, providerFailures: empty ? 0 : 6, invalidResponses: empty ? 0 : 2, persistenceFailures: empty ? 0 : 1, recentCalls: empty ? 0 : 8, recentFailures: empty ? 0 : 3, knownCostUsd: empty ? '0.00000000' : '0.00700000', unknownCostCalls: empty ? 0 : 2, averageLatencyMs: empty ? null : 800, p95LatencyMs: empty ? null : 2000 },
    runtime: {
      recordedErrors: empty ? 0 : 3, affectedAccounts: empty ? 0 : 2, limitedAccounts: 0, recentAffectedAccounts: empty ? 0 : 1,
      byKind: RUNTIME_KINDS.map((kind) => ({ kind, count: empty ? 0 : kind === 'runtime_error' ? 2 : kind === 'render_error' ? 1 : 0 })),
      byArea: RUNTIME_AREAS.map((area) => ({ area, count: empty ? 0 : area === 'practice' ? 2 : area === 'admin' ? 1 : 0 })),
    },
    retention: { jobActive: true, lastCompletedAt: '2026-10-20T11:58:00.000Z', heartbeatAgeSeconds: 120, overdueResponses: 0, overdueDrafts: 0 },
    daily: starts.map((started, index) => ({
      date: `2026-10-${14 + index}`, practisingUsers: empty ? 0 : Math.min(started, 3), stationsStarted: empty ? 0 : started, stationsFinished: empty ? 0 : finishes[index], providerCalls: empty ? 0 : started * 4, providerFailures: empty ? 0 : failures[index], knownCostUsd: empty ? '0.00000000' : '0.00100000', unknownCostCalls: !empty && (index === 2 || index === 5) ? 1 : 0, runtimeErrors: !empty && [1, 3, 5].includes(index) ? 1 : 0,
    })),
  };
}
