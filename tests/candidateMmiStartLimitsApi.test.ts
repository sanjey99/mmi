import { describe, expect, it, vi } from 'vitest';
import { CandidateMmiApiError, createCandidateMmiApi } from '../src/features/candidateMmi/api';

describe('server station-start admission rejection', () => {
  it('keeps the existing safe unavailable contract without a retry or alternate start', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { code: 'P0001', message: 'candidate_mmi_start_rate_limited', details: 'PRIVATE_DATABASE_DETAILS' },
    }));
    const result = createCandidateMmiApi({ rpc }).start('all');
    await expect(result).rejects.toBeInstanceOf(CandidateMmiApiError);
    await expect(result).rejects.toMatchObject({ kind: 'unavailable', message: 'Candidate MMI is unavailable.' });
    await expect(result).rejects.not.toThrow(/rate_limited|PRIVATE_DATABASE_DETAILS/);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('start_candidate_mmi_station_session', { p_scope: 'all' });
  });
});
