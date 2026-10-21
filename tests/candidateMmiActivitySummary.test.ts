import { describe, expect, it, vi } from 'vitest';
import { CandidateMmiActivitySummaryError, createCandidateMmiActivitySummaryApi, parseCandidateMmiActivitySummary } from '../src/features/candidateMmi/activitySummary';

const summary = Object.freeze({ completedToday: 2, completedTotal: 132, streakCurrent: 130, streakLongest: 130, latestCompletedAt: '2026-10-21T00:00:00.000001+00:00' });

describe('self-only candidate MMI practice activity', () => {
  it('calls only the no-argument self RPC and preserves an uncapped aggregate', async () => {
    const rpc = vi.fn(async () => ({ data: summary, error: null }));
    const value = await createCandidateMmiActivitySummaryApi({ rpc }).getSummary();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_candidate_mmi_activity_summary', {});
    expect(value).toEqual(summary);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it.each([
    { completedToday: 0, completedTotal: 0, streakCurrent: 0, streakLongest: 0, latestCompletedAt: null },
    { ...summary, completedToday: 0, streakCurrent: 0 },
    { ...summary, completedToday: 0, streakCurrent: 3 },
    { ...summary, latestCompletedAt: '2026-10-21T00:00:00Z' },
  ])('accepts empty, lapsed, yesterday-active, and UTC timestamp summaries', value => {
    expect(parseCandidateMmiActivitySummary(value)).toEqual(value);
  });

  it.each([
    null, [], 'private', {},
    { ...summary, accountId: 'PRIVATE_ACCOUNT' },
    { ...summary, transcript: 'PRIVATE_ANSWER' },
    { ...summary, completedToday: undefined },
    { ...summary, completedToday: 133 },
    { ...summary, completedToday: -1 },
    { ...summary, completedTotal: '132' },
    { ...summary, completedTotal: Number.MAX_SAFE_INTEGER + 1 },
    { ...summary, streakCurrent: 0 },
    { ...summary, streakCurrent: 133 },
    { ...summary, streakLongest: 129 },
    { ...summary, streakLongest: 133 },
    { ...summary, completedToday: 0, streakCurrent: 0, streakLongest: 0 },
    { ...summary, streakCurrent: 1.5 },
    { ...summary, streakCurrent: Number.NaN },
    { ...summary, latestCompletedAt: null },
    { completedToday: 0, completedTotal: 0, streakCurrent: 0, streakLongest: 0, latestCompletedAt: summary.latestCompletedAt },
    { ...summary, latestCompletedAt: '2026-02-30T12:00:00Z' },
    { ...summary, latestCompletedAt: '2026-10-21' },
    { ...summary, latestCompletedAt: '2026-10-21T24:00:00Z' },
    { ...summary, latestCompletedAt: '2026-10-21T00:00:00+14:00' },
    { ...summary, latestCompletedAt: '2026-10-21T00:00:00Z PRIVATE_DETAIL' },
  ])('rejects malformed, inconsistent, or private-field responses', value => {
    expect(() => parseCandidateMmiActivitySummary(value)).toThrow(CandidateMmiActivitySummaryError);
    try { parseCandidateMmiActivitySummary(value); } catch (error) {
      expect(error).toMatchObject({ kind: 'invalid_response', message: 'Your MMI practice activity could not be verified.' });
      expect(String(error)).not.toContain('PRIVATE');
    }
  });

  it.each([['42501', 'access_denied'], ['XX000', 'unavailable'], [undefined, 'unavailable']] as const)('maps provider error %s without exposing details', async (code, kind) => {
    const rpc = vi.fn(async () => ({ data: null, error: { code, message: 'PRIVATE_PROVIDER_DETAIL' } }));
    await expect(createCandidateMmiActivitySummaryApi({ rpc }).getSummary()).rejects.toMatchObject({ kind });
    await expect(createCandidateMmiActivitySummaryApi({ rpc }).getSummary()).rejects.not.toThrow('PRIVATE');
  });

  it('maps rejected transport and malformed results to safe errors', async () => {
    const rpc = vi.fn(async () => { throw new Error('PRIVATE_TRANSPORT_DETAIL'); });
    await expect(createCandidateMmiActivitySummaryApi({ rpc }).getSummary()).rejects.toMatchObject({ kind: 'unavailable', message: 'Your MMI practice activity is unavailable right now.' });
    await expect(createCandidateMmiActivitySummaryApi({ rpc: async () => ({ data: { ...summary, secret: 'PRIVATE' }, error: null }) }).getSummary()).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
