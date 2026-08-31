import { describe, expect, it, vi } from 'vitest';

const sessionId = '11111111-1111-4111-8111-111111111111';
const stationId = 'MMI_001';
const scenarioProjection = {
  sessionId,
  stationId,
  serverNow: '2026-08-26T00:00:30.000Z',
  phase: 'scenario',
  phaseStartedAt: '2026-08-26T00:00:00.000Z',
  phaseEndsAt: '2026-08-26T00:01:00.000Z',
  scenarioText: 'Synthetic scenario.',
};
const responseProjection = {
  sessionId,
  stationId,
  serverNow: '2026-08-26T00:02:00.000Z',
  phase: 'response',
  phaseStartedAt: '2026-08-26T00:01:00.000Z',
  phaseEndsAt: '2026-08-26T00:03:00.000Z',
  promptOrder: 1,
  promptText: 'Synthetic response prompt.',
};
const completedProjection = {
  sessionId,
  stationId,
  serverNow: '2026-08-26T00:11:00.000Z',
  phase: 'completed',
  phaseStartedAt: '2026-08-26T00:11:00.000Z',
  phaseEndsAt: null,
};
const abandonedProjection = {
  sessionId,
  stationId,
  serverNow: '2026-08-26T00:01:20.000Z',
  phase: 'abandoned',
  phaseStartedAt: '2026-08-26T00:01:10.000Z',
  phaseEndsAt: '2026-08-26T00:01:10.000Z',
};

type RpcResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string; message?: string }> | null;
}>;

type CandidateMmiApiContract = Readonly<{
  CandidateMmiApiError: new (kind: CandidateMmiApiErrorKind) => Error & Readonly<{ kind: CandidateMmiApiErrorKind }>;
  createCandidateMmiApi: (rpc: { rpc: (name: string, args?: Record<string, unknown>) => Promise<RpcResult> }) => Readonly<{
    start: () => Promise<unknown>;
    refresh: (candidateSessionId: string) => Promise<unknown>;
    abandon: (candidateSessionId: string) => Promise<void>;
  }>;
}>;

type CandidateMmiApiErrorKind = 'access_denied' | 'feature_disabled' | 'invalid_request' | 'invalid_response' | 'unavailable';

type CandidateMmiFlagContract = Readonly<{
  CANDIDATE_MMI_FEATURE_FLAG: 'normalized_mmi_station_enabled';
  isNormalizedMmiStationEnabled: (readConfig: (key: string) => Promise<unknown>) => Promise<boolean>;
}>;

type CandidateMmiRunnerContract = Readonly<{
  createCandidateMmiRunner: (
    api: Readonly<{
      start: () => Promise<unknown>;
      refresh: (candidateSessionId: string) => Promise<unknown>;
      abandon: (candidateSessionId: string) => Promise<void>;
    }>,
    media: Readonly<{
      prepare: (input: { sessionId: string }) => Promise<void>;
      beginResponse: (input: { sessionId: string; promptOrder: 1 | 2 | 3 | 4 | 5 }) => Promise<void>;
      finishResponse: () => Promise<string | null>;
      abort: (input: { sessionId: string; reason: 'leave' | 'expired' | 'feature_disabled' }) => Promise<void>;
    }>,
  ) => Readonly<{
    start: () => Promise<unknown>;
    restore: (candidateSessionId: string) => Promise<unknown>;
    refresh: () => Promise<unknown>;
    expireCurrentPhase: () => Promise<unknown>;
    finishCurrentResponse: () => Promise<string | null>;
    leave: () => Promise<void>;
  }>;
}>;

type CandidateMmiTask4Contract =
  | Readonly<{ available: true; api: CandidateMmiApiContract; flag: CandidateMmiFlagContract; runner: CandidateMmiRunnerContract }>
  | Readonly<{ available: false; reason: string }>;

async function loadCandidateMmiTask4Contract(): Promise<CandidateMmiTask4Contract> {
  try {
    const [api, flag, runner] = await Promise.all([
      import('../src/features/candidateMmi/api'),
      import('../src/features/candidateMmi/featureFlag'),
      import('../src/features/candidateMmi/runner'),
    ]);
    return { available: true, api: api as CandidateMmiApiContract, flag: flag as CandidateMmiFlagContract, runner: runner as CandidateMmiRunnerContract };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND'
        ? 'ERR_MODULE_NOT_FOUND'
        : 'candidate Task 4 contract failed to load',
    };
  }
}

function requireCandidateMmiTask4Contract(contract: CandidateMmiTask4Contract): Extract<CandidateMmiTask4Contract, { available: true }> {
  const reason = contract.available === false ? contract.reason : 'available';
  expect(contract.available, `Candidate MMI Task 4 contract is missing (${reason}).`).toBe(true);
  return contract as Extract<CandidateMmiTask4Contract, { available: true }>;
}

const rpcClient = (result: RpcResult) => ({ rpc: vi.fn().mockResolvedValue(result) });

describe('candidate MMI API trust boundary', () => {
  it('accepts only exact allowlisted scenario, response, completed, and abandoned projections', async () => {
    const { api } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    for (const projection of [scenarioProjection, responseProjection, completedProjection, abandonedProjection]) {
      await expect(api.createCandidateMmiApi(rpcClient({ data: projection, error: null })).start()).resolves.toEqual(projection);
    }
  });

  it('accepts PostgreSQL timestamptz ISO offsets with one to six fractional digits', async () => {
    const { api } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const postgresProjections = [
      {
        ...scenarioProjection,
        serverNow: '2026-08-26T00:00:30.5+00:00',
        phaseStartedAt: '2026-08-26T00:00:00.1+00:00',
        phaseEndsAt: '2026-08-26T00:01:00.1+00:00',
      },
      {
        ...scenarioProjection,
        serverNow: '2026-08-26T01:00:30.804316+01:00',
        phaseStartedAt: '2026-08-26T01:00:00.804316+01:00',
        phaseEndsAt: '2026-08-26T01:01:00.804316+01:00',
      },
    ];
    for (const projection of postgresProjections) {
      await expect(api.createCandidateMmiApi(rpcClient({ data: projection, error: null })).start()).resolves.toEqual(projection);
    }
  });

  it('rejects unknown, future, assessor, scoring, malformed identity, timestamp, boundary, and order fields', async () => {
    const { api } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const malformedProjections = [
      { ...responseProjection, promptText: ['Synthetic current', 'Synthetic future'] },
      { ...responseProjection, futurePrompts: ['Synthetic future'] },
      { ...responseProjection, rubric: 'Synthetic rubric' },
      { ...responseProjection, modelAnswer: 'Synthetic answer' },
      { ...responseProjection, criteria: 'Synthetic criteria' },
      { ...responseProjection, score: 1 },
      { ...responseProjection, sourceFlatId: 'MMI_001/MMI_001_Q1' },
      { ...responseProjection, sessionId: 'not-a-uuid' },
      { ...responseProjection, phaseStartedAt: 'not-an-iso-date' },
      { ...responseProjection, serverNow: '2026-08-26T00:03:00.000Z' },
      { ...responseProjection, phaseEndsAt: '2026-08-26T00:02:59.000Z' },
      { ...responseProjection, promptOrder: 6 },
      { ...scenarioProjection, serverNow: scenarioProjection.phaseEndsAt },
      { ...scenarioProjection, phaseEndsAt: '2026-08-26T00:00:59.000Z' },
      { ...abandonedProjection, serverNow: '2026-08-26T00:01:09.000Z' },
      { ...abandonedProjection, phaseEndsAt: '2026-08-26T00:01:11.000Z' },
    ];
    for (const projection of malformedProjections) {
      await expect(api.createCandidateMmiApi(rpcClient({ data: projection, error: null })).start()).rejects.toThrow(
        'Candidate MMI response is invalid.',
      );
    }
  });

  it('uses zero-argument start and UUID-bound refresh RPCs', async () => {
    const { api } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const client = rpcClient({ data: scenarioProjection, error: null });
    const candidateApi = api.createCandidateMmiApi(client);

    await candidateApi.start();
    await candidateApi.refresh(sessionId);

    expect(client.rpc).toHaveBeenNthCalledWith(1, 'start_candidate_mmi_station_session');
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'get_candidate_mmi_station_session', { p_session_id: sessionId });
    await expect(candidateApi.refresh('not-a-uuid')).rejects.toThrow('Candidate MMI request is invalid.');
  });

  it('maps RPC failures to a fixed safe allowlist without echoing server messages or payloads', async () => {
    const { api } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const failures = [
      { code: '42501', message: 'Synthetic private server detail.', expected: 'Candidate MMI access is denied.', kind: 'access_denied' },
      { code: 'P0001', message: 'feature_disabled', expected: 'Candidate MMI is disabled.', kind: 'feature_disabled' },
      { code: 'P0001', message: 'Synthetic private server detail.', expected: 'Candidate MMI is unavailable.', kind: 'unavailable' },
      { code: '22023', message: 'Synthetic private server detail.', expected: 'Candidate MMI request is invalid.', kind: 'invalid_request' },
      { code: 'XX000', message: 'Synthetic private server detail.', expected: 'Candidate MMI is unavailable.', kind: 'unavailable' },
    ] as const;
    for (const failure of failures) {
      const client = rpcClient({ data: { private: 'Synthetic secret payload.' }, error: { code: failure.code, message: failure.message } });
      await expect(api.createCandidateMmiApi(client).start()).rejects.toThrow(failure.expected);
      await expect(api.createCandidateMmiApi(client).start()).rejects.toMatchObject({ kind: failure.kind });
      await expect(api.createCandidateMmiApi(client).start()).rejects.not.toThrow(/Synthetic private/i);
    }
  });
});

describe('candidate MMI feature flag', () => {
  it('uses the exact flag key and fails closed for every value except the exact enabled string', async () => {
    const { flag } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    expect(flag.CANDIDATE_MMI_FEATURE_FLAG).toBe('normalized_mmi_station_enabled');
    const enabledReader = vi.fn().mockResolvedValue('true');
    await expect(flag.isNormalizedMmiStationEnabled(enabledReader)).resolves.toBe(true);
    expect(enabledReader).toHaveBeenCalledExactlyOnceWith('normalized_mmi_station_enabled');
    for (const value of [undefined, null, false, true, 'TRUE', ' true ', 'false', {}, []]) {
      await expect(flag.isNormalizedMmiStationEnabled(async () => value)).resolves.toBe(false);
    }
    await expect(flag.isNormalizedMmiStationEnabled(async () => { throw new Error('Synthetic config failure.'); })).resolves.toBe(false);
  });
});

describe('candidate MMI runner media ordering', () => {
  it('prepares once, begins only the current prompt, and ordinary same-phase refresh only re-reads', async () => {
    const { runner } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const api = {
      start: vi.fn().mockResolvedValue(responseProjection),
      refresh: vi.fn().mockResolvedValue(responseProjection),
      abandon: vi.fn().mockResolvedValue(undefined),
    };
    const media = {
      prepare: vi.fn().mockResolvedValue(undefined),
      beginResponse: vi.fn().mockResolvedValue(undefined),
      finishResponse: vi.fn().mockResolvedValue(null),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const candidateRunner = runner.createCandidateMmiRunner(api, media);

    await candidateRunner.start();
    await candidateRunner.refresh();

    expect(media.prepare).toHaveBeenCalledTimes(1);
    expect(media.beginResponse).toHaveBeenCalledTimes(1);
    expect(media.finishResponse).not.toHaveBeenCalled();
    expect(api.refresh).toHaveBeenCalledWith(sessionId);
    expect(media.beginResponse).toHaveBeenCalledWith({ sessionId, promptOrder: 1 });
    expect(media.prepare.mock.invocationCallOrder[0]).toBeLessThan(media.beginResponse.mock.invocationCallOrder[0]);
  });

  it('restores through UUID-bound refresh without starting a new station and accepts only its current response', async () => {
    const { api: apiContract, runner } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const client = rpcClient({ data: responseProjection, error: null });
    const candidateApi = apiContract.createCandidateMmiApi(client);
    const media = {
      prepare: vi.fn().mockResolvedValue(undefined),
      beginResponse: vi.fn().mockResolvedValue(undefined),
      finishResponse: vi.fn().mockResolvedValue(null),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const candidateRunner = runner.createCandidateMmiRunner(candidateApi, media);

    await expect(candidateRunner.restore(sessionId)).resolves.toEqual(responseProjection);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('get_candidate_mmi_station_session', { p_session_id: sessionId });
    expect(media.prepare).toHaveBeenCalledExactlyOnceWith({ sessionId });
    expect(media.beginResponse).toHaveBeenCalledExactlyOnceWith({ sessionId, promptOrder: 1 });

    await expect(candidateRunner.restore('not-a-uuid')).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('response expiry finishes once before re-reading trusted state and begins only the newly returned current prompt', async () => {
    const { runner } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const nextResponse = { ...responseProjection, serverNow: '2026-08-26T00:04:00.000Z', phaseStartedAt: '2026-08-26T00:03:00.000Z', phaseEndsAt: '2026-08-26T00:05:00.000Z', promptOrder: 2, promptText: 'Synthetic next response prompt.' };
    const api = {
      start: vi.fn().mockResolvedValue(responseProjection),
      refresh: vi.fn().mockResolvedValue(nextResponse),
      abandon: vi.fn().mockResolvedValue(undefined),
    };
    const media = {
      prepare: vi.fn().mockResolvedValue(undefined),
      beginResponse: vi.fn().mockResolvedValue(undefined),
      finishResponse: vi.fn().mockResolvedValue(null),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const candidateRunner = runner.createCandidateMmiRunner(api, media);

    await candidateRunner.start();
    await candidateRunner.expireCurrentPhase();

    expect(media.finishResponse).toHaveBeenCalledTimes(1);
    expect(api.refresh).toHaveBeenCalledWith(sessionId);
    expect(media.finishResponse.mock.invocationCallOrder[0]).toBeLessThan(api.refresh.mock.invocationCallOrder[0]);
    expect(media.beginResponse).toHaveBeenNthCalledWith(2, { sessionId, promptOrder: 2 });
  });

  it('treats response-expiry media finalization as best effort before accepting only the trusted next projection', async () => {
    const { runner } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const nextResponse = {
      ...responseProjection,
      serverNow: '2026-08-26T00:04:00.000Z',
      phaseStartedAt: '2026-08-26T00:03:00.000Z',
      phaseEndsAt: '2026-08-26T00:05:00.000Z',
      promptOrder: 2,
      promptText: 'Synthetic next response prompt.',
    };
    const api = {
      start: vi.fn().mockResolvedValue(responseProjection),
      refresh: vi.fn().mockResolvedValue(nextResponse),
      abandon: vi.fn().mockResolvedValue(undefined),
    };
    const media = {
      prepare: vi.fn().mockResolvedValue(undefined),
      beginResponse: vi.fn().mockResolvedValue(undefined),
      finishResponse: vi.fn().mockRejectedValue(new Error('Synthetic media finalization failure.')),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const candidateRunner = runner.createCandidateMmiRunner(api, media);
    await candidateRunner.start();

    await expect(candidateRunner.expireCurrentPhase()).resolves.toEqual(nextResponse);

    expect(media.finishResponse).toHaveBeenCalledTimes(1);
    expect(api.refresh).toHaveBeenCalledWith(sessionId);
    expect(media.finishResponse.mock.invocationCallOrder[0]).toBeLessThan(api.refresh.mock.invocationCallOrder[0]);
    expect(media.beginResponse).toHaveBeenNthCalledWith(2, { sessionId, promptOrder: 2 });
    expect(Object.keys(nextResponse)).not.toContain('futurePrompts');
    expect(Object.values(nextResponse)).not.toContainEqual(expect.any(Array));
  });

  it('ordinary cross-response refresh finishes after reading and before beginning the newly current prompt', async () => {
    const { runner } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const nextResponse = { ...responseProjection, serverNow: '2026-08-26T00:04:00.000Z', phaseStartedAt: '2026-08-26T00:03:00.000Z', phaseEndsAt: '2026-08-26T00:05:00.000Z', promptOrder: 2, promptText: 'Synthetic next response prompt.' };
    const api = {
      start: vi.fn().mockResolvedValue(responseProjection),
      refresh: vi.fn().mockResolvedValue(nextResponse),
      abandon: vi.fn().mockResolvedValue(undefined),
    };
    const media = {
      prepare: vi.fn().mockResolvedValue(undefined),
      beginResponse: vi.fn().mockResolvedValue(undefined),
      finishResponse: vi.fn().mockResolvedValue(null),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const candidateRunner = runner.createCandidateMmiRunner(api, media);
    await candidateRunner.start();
    await candidateRunner.refresh();

    expect(media.finishResponse).toHaveBeenCalledTimes(1);
    expect(api.refresh.mock.invocationCallOrder[0]).toBeLessThan(media.finishResponse.mock.invocationCallOrder[0]);
    expect(media.finishResponse.mock.invocationCallOrder[0]).toBeLessThan(media.beginResponse.mock.invocationCallOrder[1]);
    expect(media.beginResponse).toHaveBeenNthCalledWith(2, { sessionId, promptOrder: 2 });
  });

  it('ordinary response-to-completed refresh finishes once before accepting completion and never begins another prompt', async () => {
    const { runner } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const api = {
      start: vi.fn().mockResolvedValue(responseProjection),
      refresh: vi.fn().mockResolvedValue(completedProjection),
      abandon: vi.fn().mockResolvedValue(undefined),
    };
    const media = {
      prepare: vi.fn().mockResolvedValue(undefined),
      beginResponse: vi.fn().mockResolvedValue(undefined),
      finishResponse: vi.fn().mockResolvedValue(null),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const candidateRunner = runner.createCandidateMmiRunner(api, media);
    await candidateRunner.start();

    await expect(candidateRunner.refresh()).resolves.toEqual(completedProjection);

    expect(media.finishResponse).toHaveBeenCalledTimes(1);
    expect(api.refresh.mock.invocationCallOrder[0]).toBeLessThan(media.finishResponse.mock.invocationCallOrder[0]);
    expect(media.beginResponse).toHaveBeenCalledTimes(1);
  });

  it('keeps early finish opaque, idempotent, and unable to re-read, start, or reveal a future prompt', async () => {
    const { runner } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const artifact = 'synthetic-opaque-artifact' as string;
    const api = {
      start: vi.fn().mockResolvedValue(responseProjection),
      refresh: vi.fn().mockResolvedValue(responseProjection),
      abandon: vi.fn().mockResolvedValue(undefined),
    };
    const media = {
      prepare: vi.fn().mockResolvedValue(undefined),
      beginResponse: vi.fn().mockResolvedValue(undefined),
      finishResponse: vi.fn().mockResolvedValue(artifact),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const candidateRunner = runner.createCandidateMmiRunner(api, media);
    await candidateRunner.start();
    const startCalls = api.start.mock.calls.length;
    const refreshCalls = api.refresh.mock.calls.length;

    await expect(candidateRunner.finishCurrentResponse()).resolves.toBe(artifact);
    await expect(candidateRunner.finishCurrentResponse()).resolves.toBe(artifact);

    expect(api.start).toHaveBeenCalledTimes(startCalls);
    expect(api.refresh).toHaveBeenCalledTimes(refreshCalls);
    expect(media.beginResponse).toHaveBeenCalledTimes(1);
    expect(media.finishResponse).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent early finish operations and shares the opaque result', async () => {
    const { runner } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const artifact = 'synthetic-concurrent-artifact' as string;
    const api = {
      start: vi.fn().mockResolvedValue(responseProjection),
      refresh: vi.fn().mockResolvedValue(responseProjection),
      abandon: vi.fn().mockResolvedValue(undefined),
    };
    const media = {
      prepare: vi.fn().mockResolvedValue(undefined),
      beginResponse: vi.fn().mockResolvedValue(undefined),
      finishResponse: vi.fn().mockResolvedValue(artifact),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const candidateRunner = runner.createCandidateMmiRunner(api, media);
    await candidateRunner.start();

    await expect(Promise.all([candidateRunner.finishCurrentResponse(), candidateRunner.finishCurrentResponse()])).resolves.toEqual([artifact, artifact]);
    expect(media.finishResponse).toHaveBeenCalledTimes(1);
  });

  it('does not finish media when the scenario expires', async () => {
    const { runner } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const api = {
      start: vi.fn().mockResolvedValue(scenarioProjection),
      refresh: vi.fn().mockResolvedValue(responseProjection),
      abandon: vi.fn().mockResolvedValue(undefined),
    };
    const media = {
      prepare: vi.fn().mockResolvedValue(undefined),
      beginResponse: vi.fn().mockResolvedValue(undefined),
      finishResponse: vi.fn().mockResolvedValue(null),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const candidateRunner = runner.createCandidateMmiRunner(api, media);
    await candidateRunner.start();
    await candidateRunner.expireCurrentPhase();

    expect(media.finishResponse).not.toHaveBeenCalled();
    expect(api.refresh).toHaveBeenCalledWith(sessionId);
    expect(media.beginResponse).toHaveBeenCalledWith({ sessionId, promptOrder: 1 });
  });

  it('aborts once before idempotent leave and aborts with typed feature-disabled on failed refresh', async () => {
    const { api: apiContract, runner } = requireCandidateMmiTask4Contract(await loadCandidateMmiTask4Contract());
    const api = {
      start: vi.fn().mockResolvedValue(responseProjection),
      refresh: vi.fn().mockRejectedValue(new apiContract.CandidateMmiApiError('feature_disabled')),
      abandon: vi.fn().mockResolvedValue(undefined),
    };
    const media = {
      prepare: vi.fn().mockResolvedValue(undefined),
      beginResponse: vi.fn().mockResolvedValue(undefined),
      finishResponse: vi.fn().mockResolvedValue(null),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const candidateRunner = runner.createCandidateMmiRunner(api, media);
    await candidateRunner.start();
    await expect(candidateRunner.refresh()).rejects.toMatchObject({ kind: 'feature_disabled' });
    await candidateRunner.leave();
    await candidateRunner.leave();

    expect(media.abort).toHaveBeenCalledTimes(1);
    expect(media.abort).toHaveBeenCalledWith({ sessionId, reason: 'feature_disabled' });
    expect(media.abort.mock.invocationCallOrder[0]).toBeLessThan(api.abandon.mock.invocationCallOrder[0]);
    expect(api.abandon).toHaveBeenCalledTimes(2);
  });
});
