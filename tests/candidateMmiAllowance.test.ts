import { describe, expect, it, vi } from 'vitest';
import { CandidateMmiAllowanceError, createCandidateMmiAllowanceApi, describeCandidateMmiAllowance, parseCandidateMmiScoringAllowance } from '../src/features/candidateMmi/scoringAllowance';
import { scoringAllowanceFixture } from './fixtures/scoringAllowance';

describe('candidate self-only scoring allowance', () => {
  it('accepts only the exact non-identifying contract and freezes its result', () => {
    const fixture = scoringAllowanceFixture();
    const parsed = parseCandidateMmiScoringAllowance(fixture);
    expect(parsed).toEqual(fixture);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parseCandidateMmiScoringAllowance(scoringAllowanceFixture({ checkedAt: '2026-10-20T20:00:00+08:00', resetsAt: '2026-10-21T08:00:00+08:00' }))).toBeTruthy();
  });

  it('requests the authenticated account snapshot without accepting an account or quota parameter', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: scoringAllowanceFixture(), error: null });
    await expect(createCandidateMmiAllowanceApi({ rpc }).getAllowance()).resolves.toEqual(scoringAllowanceFixture());
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_candidate_mmi_scoring_allowance', {});
  });

  it.each([
    null, [], 'PRIVATE_DIAGNOSTIC', { ...scoringAllowanceFixture(), accountId: 'PRIVATE_ACCOUNT' },
    { ...scoringAllowanceFixture(), email: 'PRIVATE_EMAIL' }, { ...scoringAllowanceFixture(), globalCost: 'PRIVATE_COST' },
    { ...scoringAllowanceFixture(), attemptsRemaining: undefined }, { ...scoringAllowanceFixture(), responsesRemaining: -1 },
    { ...scoringAllowanceFixture(), responsesRemaining: 1.5 }, { ...scoringAllowanceFixture(), attemptsRemaining: Number.NaN },
    { ...scoringAllowanceFixture(), attemptsRemaining: Number.POSITIVE_INFINITY }, { ...scoringAllowanceFixture(), attemptsRemaining: Number.MAX_SAFE_INTEGER + 1 },
    { ...scoringAllowanceFixture(), stationAllowanceRemaining: 3 }, { ...scoringAllowanceFixture(), scoringPaused: 'false' },
    { ...scoringAllowanceFixture(), scoringPaused: true, globalCapacityAvailable: true },
    { ...scoringAllowanceFixture(), globalCapacityAvailable: null },
  ])('rejects widened, malformed, or contradictory allowance data', (value) => {
    expect(() => parseCandidateMmiScoringAllowance(value)).toThrow(CandidateMmiAllowanceError);
  });

  it.each([
    { checkedAt: '2026-02-30T12:00:00Z' }, { checkedAt: '2026-10-20' }, { checkedAt: '2026-10-20T24:00:00Z' },
    { checkedAt: '2026-10-20T12:00:00+99:00' }, { resetsAt: '2026-10-20T00:00:00Z' },
    { resetsAt: '2026-10-22T00:00:00Z' }, { resetsAt: '2026-10-21T01:00:00Z' }, { resetsAt: 'PRIVATE_DIAGNOSTIC' },
  ])('requires a real timestamp and the next UTC midnight reset', (overrides) => {
    expect(() => parseCandidateMmiScoringAllowance(scoringAllowanceFixture(overrides))).toThrow(CandidateMmiAllowanceError);
  });

  it('replaces provider and transport details with fixed errors', async () => {
    for (const rpc of [
      vi.fn().mockRejectedValue(new Error('PRIVATE_TRANSPORT')),
      vi.fn().mockResolvedValue({ data: null, error: { code: 'XX000', message: 'PRIVATE_SQL' } }),
    ]) await expect(createCandidateMmiAllowanceApi({ rpc }).getAllowance()).rejects.toMatchObject({ kind: 'unavailable', message: 'Your remaining AI feedback allowance is unavailable right now.' });
    await expect(createCandidateMmiAllowanceApi({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }) }).getAllowance()).rejects.toMatchObject({ kind: 'access_denied' });
  });

  it('uses both first-answer and retry-attempt limits for the full-station estimate', () => {
    expect(describeCandidateMmiAllowance(scoringAllowanceFixture())).toMatchObject({ completeStations: 2, warning: false });
    expect(describeCandidateMmiAllowance(scoringAllowanceFixture({ attemptsRemaining: 5 }))).toMatchObject({ completeStations: 1, title: 'Up to 1 complete station of AI feedback left today' });
    expect(describeCandidateMmiAllowance(scoringAllowanceFixture({ attemptsRemaining: 4 }))).toMatchObject({ completeStations: 0, warning: true, message: expect.stringContaining('up to 4 more answers') });
    expect(describeCandidateMmiAllowance(scoringAllowanceFixture({ responsesRemaining: 1, stationAllowanceRemaining: 0 }))).toMatchObject({ completeStations: 0, message: expect.stringContaining('up to 1 more answer today') });
  });

  it('does not promise feedback during pause, shared-capacity denial, or exhausted allowance', () => {
    expect(describeCandidateMmiAllowance(scoringAllowanceFixture({ scoringPaused: true, globalCapacityAvailable: false }))).toMatchObject({ warning: true, completeStations: 0, title: 'AI feedback is temporarily paused' });
    expect(describeCandidateMmiAllowance(scoringAllowanceFixture({ globalCapacityAvailable: false }))).toMatchObject({ warning: true, completeStations: 0, title: 'AI feedback is temporarily unavailable' });
    for (const overrides of [{ responsesRemaining: 0, stationAllowanceRemaining: 0 }, { attemptsRemaining: 0 }]) {
      expect(describeCandidateMmiAllowance(scoringAllowanceFixture(overrides))).toMatchObject({ warning: true, completeStations: 0, title: "Today's AI feedback allowance is used", message: expect.stringContaining('Existing feedback remains available') });
    }
  });
});
