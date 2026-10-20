import { describe, expect, it, vi } from 'vitest';
import { assessOperationsHealth, createOperationsHealthHandler } from '../supabase/functions/operations-health/handler';

const token = 'a'.repeat(64);
function healthy() {
  return {
    retention: { jobActive: true, heartbeatAgeSeconds: 30, overdueResponses: 0, overdueDrafts: 0 },
    scoring: { isConfigured: true, stalledClaims: 0, recentCalls: 5, recentFailures: 0 },
    runtime: { recentAffectedAccounts: 0 },
    privateAnswers: 'Never return a provider payload or user identity.',
  };
}
function request(authorization = `Bearer ${token}`, method = 'GET', query = '') {
  return new Request(`https://example.supabase.co/functions/v1/operations-health${query}`, { method, headers: { Authorization: authorization } });
}
function setup() {
  const loadSnapshot = vi.fn(async (_signal: AbortSignal) => ({ data: healthy() as unknown, error: null as unknown }));
  return { loadSnapshot, handler: createOperationsHealthHandler({ token, loadSnapshot }) };
}

describe('independent operations health', () => {
  it('returns only health states and never analytics or candidate material', async () => {
    const { handler } = setup();
    const result = await handler(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, checks: { database: 'ok', retention: 'ok', scoring: 'ok', runtime: 'ok' } });
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each(['', 'Bearer private', `Bearer ${'b'.repeat(64)}`, `Basic ${token}`])('rejects %s before querying private data', async authorization => {
    const { handler, loadSnapshot } = setup();
    expect((await handler(request(authorization))).status).toBe(401);
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it('refuses query credentials and unsupported methods', async () => {
    const { handler, loadSnapshot } = setup();
    expect((await handler(request(`Bearer ${token}`, 'GET', '?token=private'))).status).toBe(400);
    expect((await handler(request(`Bearer ${token}`, 'POST'))).status).toBe(405);
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'weak-secret'])('stays unavailable without a valid monitor secret', async invalid => {
    const loadSnapshot = vi.fn();
    const handler = createOperationsHealthHandler({ token: invalid, loadSnapshot });
    expect((await handler(request())).status).toBe(503);
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    { jobActive: false }, { heartbeatAgeSeconds: null }, { heartbeatAgeSeconds: 901 },
    { overdueResponses: 1 }, { overdueDrafts: 1 },
  ])('detects retention failure %j', patch => {
    const value = healthy(); Object.assign(value.retention, patch);
    expect(assessOperationsHealth(value).checks.retention).toBe('failing');
  });

  it('separates stalled work and recent provider failure bursts from historic or ordinary outcomes', () => {
    const value = healthy();
    value.scoring.isConfigured = false;
    expect(assessOperationsHealth(value).checks.scoring).toBe('failing');
    value.scoring.isConfigured = true;
    value.scoring.stalledClaims = 1;
    expect(assessOperationsHealth(value).checks.scoring).toBe('failing');
    value.scoring.stalledClaims = 0;
    value.scoring.recentFailures = 2;
    expect(assessOperationsHealth(value).checks.scoring).toBe('ok');
    value.scoring.recentFailures = 3;
    expect(assessOperationsHealth(value).checks.scoring).toBe('failing');
    value.scoring.recentCalls = 100;
    expect(assessOperationsHealth(value).checks.scoring).toBe('ok');
    value.runtime.recentAffectedAccounts = 1;
    expect(assessOperationsHealth(value).checks.runtime).toBe('failing');
  });

  it.each([null, {}, { retention: {} }, { ...healthy(), scoring: { stalledClaims: 0, recentCalls: 1, recentFailures: 2 } }])('does not claim healthy for malformed payloads', value => {
    expect(assessOperationsHealth(value).ok).toBe(false);
  });

  it('does not expose thrown or provider errors', async () => {
    const { handler, loadSnapshot } = setup();
    loadSnapshot.mockRejectedValueOnce(new Error('private backend credentials'));
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/private|credentials/u);
    loadSnapshot.mockResolvedValueOnce({ data: healthy(), error: { message: 'private' } });
    expect((await handler(request())).status).toBe(503);
  });

  it('bounds backend hangs and aborts the query', async () => {
    let signal: AbortSignal | undefined;
    const handler = createOperationsHealthHandler({ token, timeoutMs: 5, loadSnapshot: value => { signal = value; return new Promise(() => {}); } });
    expect((await handler(request())).status).toBe(503);
    expect(signal?.aborted).toBe(true);
  });
});
