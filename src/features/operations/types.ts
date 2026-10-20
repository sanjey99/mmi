export const RUNTIME_KINDS = ['runtime_error', 'unhandled_rejection', 'render_error'] as const;
export const RUNTIME_AREAS = ['login', 'account_link', 'onboarding', 'practice', 'feedback', 'progress', 'profile', 'admin', 'other'] as const;
export type RuntimeKind = typeof RUNTIME_KINDS[number];
export type RuntimeArea = typeof RUNTIME_AREAS[number];

export type OperationsDashboard = Readonly<{
  checkedAt: string;
  periodStart: string;
  periodEnd: string;
  cohort: 'testers' | 'all';
  activity: Readonly<{
    accountsCreated: number;
    practisingUsers: number;
    stationsStarted: number;
    stationsFinished: number;
    stationsAbandoned: number;
    reportsSubmitted: number;
  }>;
  scoring: Readonly<{
    isConfigured: boolean;
    pendingResponses: number;
    failedResponses: number;
    expiredResponses: number;
    stalledClaims: number;
    providerCalls: number;
    providerFailures: number;
    invalidResponses: number;
    persistenceFailures: number;
    recentCalls: number;
    recentFailures: number;
    knownCostUsd: string;
    unknownCostCalls: number;
    averageLatencyMs: number | null;
    p95LatencyMs: number | null;
  }>;
  runtime: Readonly<{
    recordedErrors: number;
    affectedAccounts: number;
    limitedAccounts: number;
    recentAffectedAccounts: number;
    byKind: readonly Readonly<{ kind: RuntimeKind; count: number }>[];
    byArea: readonly Readonly<{ area: RuntimeArea; count: number }>[];
  }>;
  retention: Readonly<{
    jobActive: boolean;
    lastCompletedAt: string | null;
    heartbeatAgeSeconds: number | null;
    overdueResponses: number;
    overdueDrafts: number;
  }>;
  daily: readonly Readonly<{
    date: string;
    practisingUsers: number;
    stationsStarted: number;
    stationsFinished: number;
    providerCalls: number;
    providerFailures: number;
    knownCostUsd: string;
    unknownCostCalls: number;
    runtimeErrors: number;
  }>[];
}>;
