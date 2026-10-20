import { describe, expect, it, vi } from 'vitest';
import { createOperationsApi, OperationsApiError, parseOperationsDashboard } from '../src/features/operations/api';
import { operationsDashboardFixture } from './fixtures/operationsDashboard';

const dashboard = operationsDashboardFixture();

describe('aggregate operations API', () => {
  it('accepts the exact aggregate contract, freezes nested values, and preserves unavailable latency', () => {
    const parsed = parseOperationsDashboard(dashboard);
    expect(parsed).toEqual(dashboard);
    expect(Object.isFrozen(parsed.scoring)).toBe(true);
    expect(Object.isFrozen(parsed.runtime.byKind[0])).toBe(true);
    expect(Object.isFrozen(parsed.daily)).toBe(true);
    expect(parseOperationsDashboard(operationsDashboardFixture('testers', true)).scoring.averageLatencyMs).toBeNull();
    expect(parseOperationsDashboard({ ...dashboard, scoring: { ...dashboard.scoring, averageLatencyMs: 3000, p95LatencyMs: 2000 } })).toBeTruthy();
    expect(parseOperationsDashboard({ ...dashboard, scoring: { ...dashboard.scoring, isConfigured: false } }).scoring.isConfigured).toBe(false);
  });

  it('requests tester-only aggregates by default and sends the explicit all-account cohort', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: dashboard, error: null }).mockResolvedValueOnce({ data: operationsDashboardFixture('all'), error: null });
    const api = createOperationsApi({ rpc });
    await expect(api.getOperationsDashboard()).resolves.toEqual(dashboard);
    await expect(api.getOperationsDashboard(false)).resolves.toMatchObject({ cohort: 'all' });
    expect(rpc.mock.calls).toEqual([
      ['get_mmi_operations_dashboard', { p_testers_only: true }],
      ['get_mmi_operations_dashboard', { p_testers_only: false }],
    ]);
    await expect(api.getOperationsDashboard('true' as never)).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('rejects a response for a different cohort', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: operationsDashboardFixture('all'), error: null });
    await expect(createOperationsApi({ rpc }).getOperationsDashboard(true)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('keeps transport, access, and database details out of public errors', async () => {
    const denied = createOperationsApi({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'SECRET_DATABASE_DETAIL' } }) });
    await expect(denied.getOperationsDashboard()).rejects.toMatchObject({ kind: 'access_denied', message: 'Administrator access is required to view operations.' });
    for (const rpc of [
      vi.fn().mockRejectedValue(new Error('SECRET_NETWORK_DETAIL')),
      vi.fn().mockResolvedValue({ data: null, error: { code: 'XX000', message: 'SECRET_DATABASE_DETAIL' } }),
    ]) await expect(createOperationsApi({ rpc }).getOperationsDashboard()).rejects.toMatchObject({ kind: 'unavailable', message: 'Operations are unavailable right now. Please try again.' });
  });

  it('rejects any widened response that could expose candidate or diagnostic material', () => {
    for (const malformed of [
      { ...dashboard, transcript: 'PRIVATE_SENTINEL' },
      { ...dashboard, activity: { ...dashboard.activity, userId: 'PRIVATE_SENTINEL' } },
      { ...dashboard, scoring: { ...dashboard.scoring, evidenceQuote: 'PRIVATE_SENTINEL' } },
      { ...dashboard, retention: { ...dashboard.retention, rawResponse: 'PRIVATE_SENTINEL' } },
      { ...dashboard, runtime: { ...dashboard.runtime, message: 'PRIVATE_SENTINEL' } },
      { ...dashboard, daily: dashboard.daily.map((row, index) => index === 0 ? { ...row, email: 'PRIVATE_SENTINEL' } : row) },
      { ...dashboard, runtime: { ...dashboard.runtime, byArea: dashboard.runtime.byArea.map((row, index) => index === 0 ? { ...row, stack: 'PRIVATE_SENTINEL' } : row) } },
    ]) expect(() => parseOperationsDashboard(malformed)).toThrow(OperationsApiError);
  });

  it('rejects invalid numbers, money, and contradictory scoring or runtime aggregates', () => {
    for (const malformed of [
      { ...dashboard, activity: { ...dashboard.activity, accountsCreated: -1 } },
      { ...dashboard, activity: { ...dashboard.activity, practisingUsers: 0.5 } },
      { ...dashboard, scoring: { ...dashboard.scoring, providerCalls: Number.NaN } },
      { ...dashboard, scoring: { ...dashboard.scoring, isConfigured: 'true' } },
      { ...dashboard, scoring: { ...dashboard.scoring, isConfigured: undefined } },
      { ...dashboard, scoring: { ...dashboard.scoring, averageLatencyMs: Number.POSITIVE_INFINITY } },
      { ...dashboard, scoring: { ...dashboard.scoring, knownCostUsd: 0 } },
      { ...dashboard, scoring: { ...dashboard.scoring, knownCostUsd: '-0.00000001' } },
      { ...dashboard, scoring: { ...dashboard.scoring, unknownCostCalls: 81 } },
      { ...dashboard, scoring: { ...dashboard.scoring, providerFailures: 81 } },
      { ...dashboard, scoring: { ...dashboard.scoring, recentFailures: 9 } },
      { ...dashboard, scoring: { ...dashboard.scoring, p95LatencyMs: null } },
      { ...dashboard, runtime: { ...dashboard.runtime, recordedErrors: 4 } },
      { ...dashboard, runtime: { ...dashboard.runtime, limitedAccounts: 3 } },
      { ...dashboard, runtime: { ...dashboard.runtime, recentAffectedAccounts: 3 } },
      { ...dashboard, runtime: { ...dashboard.runtime, byKind: [{ kind: 'PRIVATE_URL', count: 3 }] } },
      { ...dashboard, runtime: { ...dashboard.runtime, byArea: dashboard.runtime.byArea.map((row) => ({ ...row, area: 'practice' })) } },
    ]) expect(() => parseOperationsDashboard(malformed)).toThrow(OperationsApiError);
  });

  it('requires seven consecutive UTC dates, a checked-time period end, and a paired retention heartbeat', () => {
    for (const malformed of [
      { ...dashboard, checkedAt: '2026-02-30T12:00:00Z' },
      { ...dashboard, checkedAt: '2026-10-20T24:00:00Z' },
      { ...dashboard, periodStart: '2026-10-13T00:00:00Z' },
      { ...dashboard, periodEnd: '2026-10-21T00:00:00Z' },
      { ...dashboard, daily: dashboard.daily.slice(1) },
      { ...dashboard, daily: [...dashboard.daily].reverse() },
      { ...dashboard, daily: dashboard.daily.map((row, index) => index === 0 ? { ...row, date: '2026-02-30' } : row) },
      { ...dashboard, retention: { ...dashboard.retention, jobActive: 'true' } },
      { ...dashboard, retention: { ...dashboard.retention, lastCompletedAt: null } },
      { ...dashboard, retention: { ...dashboard.retention, heartbeatAgeSeconds: -1 } },
    ]) expect(() => parseOperationsDashboard(malformed)).toThrow(OperationsApiError);
    expect(parseOperationsDashboard({ ...dashboard, retention: { ...dashboard.retention, lastCompletedAt: null, heartbeatAgeSeconds: null } })).toBeTruthy();
  });
});
