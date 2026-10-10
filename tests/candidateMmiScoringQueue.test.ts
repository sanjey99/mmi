import { describe, expect, it, vi } from 'vitest';
import { CandidateMmiScoringError, createCandidateMmiScoringApi } from '../src/features/candidateMmi/scoringApi';
import { scoreCandidateMmiResponses } from '../src/features/candidateMmi/scoringQueue';

const scored = { status: 'scored' } as const;

describe('completed station scoring recovery', () => {
  it('limits simultaneous requests and retains results in station order', async () => {
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const score = vi.fn(async () => {
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return scored;
    });
    const completion = scoreCandidateMmiResponses([1, 2, 3, 4, 5], score);
    expect(score).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 5; index++) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(index));
      releases[index]();
    }
    expect(await completion).toEqual(Array.from({ length: 5 }, () => ({ status: 'fulfilled', value: scored })));
    expect(peak).toBe(2);
  });

  it('recovers transient failures once and refreshes partial feedback', async () => {
    const score = vi.fn().mockRejectedValueOnce(new CandidateMmiScoringError('invalid_provider_response')).mockResolvedValue(scored);
    const wait = vi.fn(async () => {});
    const onSettled = vi.fn(async () => {});
    expect(await scoreCandidateMmiResponses([3], score, { wait, onSettled })).toEqual([{ status: 'fulfilled', value: scored }]);
    expect(score.mock.calls).toEqual([[3], [3]]);
    expect(wait).toHaveBeenCalledExactlyOnceWith(1_000);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('never loops on persistent failures or retries configuration/lease errors', async () => {
    for (const code of ['provider_not_configured', 'in_progress', 'unauthorized', 'rate_limited'] as const) {
      const score = vi.fn().mockRejectedValue(new CandidateMmiScoringError(code, code === 'rate_limited' ? 3_600 : null));
      const wait = vi.fn(async () => {});
      expect(await scoreCandidateMmiResponses([1], score, { wait })).toMatchObject([{ status: 'rejected', reason: { code } }]);
      expect(score).toHaveBeenCalledOnce();
      expect(wait).not.toHaveBeenCalled();
    }
    const persistent = vi.fn().mockRejectedValue(new CandidateMmiScoringError('provider_failed'));
    await scoreCandidateMmiResponses([1], persistent, { wait: async () => {} });
    expect(persistent).toHaveBeenCalledTimes(2);
  });

  it('honours short server retry windows without interrupting other responses', async () => {
    const score = vi.fn().mockRejectedValueOnce(new CandidateMmiScoringError('rate_limited', 3)).mockResolvedValue(scored);
    const wait = vi.fn(async () => {});
    const onSettled = vi.fn(async () => { throw new Error('feedback read failed'); });
    expect(await scoreCandidateMmiResponses([2, 4], score, { wait, onSettled })).toEqual([
      { status: 'fulfilled', value: scored }, { status: 'fulfilled', value: scored },
    ]);
    expect(wait).toHaveBeenCalledExactlyOnceWith(3_000);
    expect(score.mock.calls.map(([order]) => order)).toEqual([2, 4, 2]);
  });

  it('recognizes bounded Retry-After headers without exposing untrusted errors', async () => {
    for (const [header, expected] of [['3', 3], ['3600', 3600], ['0', null], ['9999', null], ['3.5', null], ['private value', null]] as const) {
      const api = createCandidateMmiScoringApi(async () => ({ data: null, error: { context: new Response(JSON.stringify({ code: 'rate_limited', private: 'secret' }), { status: 429, headers: { 'Retry-After': header } }) } }));
      await expect(api.scoreCandidateResponse('11111111-1111-4111-8111-111111111111', 1)).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: expected, message: 'AI scoring has reached its temporary limit. Please wait before retrying.' });
    }
  });
});
