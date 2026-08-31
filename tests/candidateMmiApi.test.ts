import { describe, expect, it, vi } from 'vitest';
import {
  CandidateMmiApiError,
  createCandidateMmiApi,
  type CandidateMmiCheckpoint,
  type CandidateMmiServerProjection,
} from '../src/features/candidateMmi/api';
import { createCandidateMmiRunner } from '../src/features/candidateMmi/runner';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sessionId = '11111111-1111-4111-8111-111111111111';
const finalizationKey = '22222222-2222-4222-8222-222222222222';
const stationId = 'MMI_001';
const scenarioProjection = Object.freeze({
  sessionId, stationId, serverNow: '2026-08-26T00:00:30.000Z', phase: 'scenario' as const,
  phaseStartedAt: '2026-08-26T00:00:00.000Z', phaseEndsAt: '2026-08-26T00:01:00.000Z', scenarioText: 'Synthetic scenario.',
});
const responseProjection = Object.freeze({
  sessionId, stationId, serverNow: '2026-08-26T00:02:00.000Z', phase: 'response' as const,
  phaseStartedAt: '2026-08-26T00:01:00.000Z', phaseEndsAt: '2026-08-26T00:03:00.000Z', promptOrder: 1 as const,
  promptText: 'Synthetic response prompt.', draftTranscript: 'Manual draft', draftRevision: 3, responseStatus: 'open' as const,
});
const nextResponse = Object.freeze({
  ...responseProjection, serverNow: '2026-08-26T00:04:00.000Z', phaseStartedAt: '2026-08-26T00:03:00.000Z',
  phaseEndsAt: '2026-08-26T00:05:00.000Z', promptOrder: 2 as const, promptText: 'Synthetic next response prompt.',
});
const completedProjection = Object.freeze({
  sessionId,
  stationId,
  serverNow: '2026-08-26T00:11:00.000Z',
  phase: 'completed' as const,
  phaseStartedAt: '2026-08-26T00:11:00.000Z',
  phaseEndsAt: null,
});
const abandonedProjection = Object.freeze({
  sessionId,
  stationId,
  serverNow: '2026-08-26T00:01:20.000Z',
  phase: 'abandoned' as const,
  phaseStartedAt: '2026-08-26T00:01:10.000Z',
  phaseEndsAt: '2026-08-26T00:01:10.000Z',
});
const assessment = Object.freeze({
  dimensions: {
    structure: { score: 4, applicable: true, evidence: 'Prioritised immediate safety.', improvement: null },
    ethics: { score: 3, applicable: true, evidence: null, improvement: 'Name escalation triggers.' },
    communication: { score: null, applicable: false, evidence: null, improvement: null },
    reflection: { score: null, applicable: false, evidence: null, improvement: null },
    nhs_awareness: { score: null, applicable: false, evidence: null, improvement: null },
  },
  overallPct: 70,
  strengths: ['clear-priorities'],
  improvements: ['explicit-safety-netting'],
  improvementTip: 'Name the escalation triggers explicitly.',
  rubricVersion: 1,
});

type RpcResult = Readonly<{ data: unknown; error: Readonly<{ code?: string; message?: string }> | null }>;
const rpcClient = (results: readonly RpcResult[]) => ({ rpc: vi.fn().mockImplementation(async () => results[0]) });
const checkpointResult = Object.freeze({ sessionId, promptOrder: 1, draftRevision: 4, acceptedAt: '2026-08-26T00:02:20.000Z' });
const finalizationResult = Object.freeze({ sessionId, promptOrder: 1, responseState: 'response', finalizedAt: '2026-08-26T00:03:00.000Z', scoringStatus: 'pending' });

describe('candidate MMI API transcript boundary', () => {
  it('accepts exact scenario and terminal projections, including PostgreSQL ISO offsets', async () => {
    const offsetScenario = {
      ...scenarioProjection,
      serverNow: '2026-08-26T01:00:30.804316+01:00',
      phaseStartedAt: '2026-08-26T01:00:00.804316+01:00',
      phaseEndsAt: '2026-08-26T01:01:00.804316+01:00',
    };
    for (const projection of [scenarioProjection, offsetScenario, completedProjection, abandonedProjection]) {
      await expect(createCandidateMmiApi(rpcClient([{ data: projection, error: null }])).start()).resolves.toEqual(projection);
    }
  });

  it('accepts only a current response projection with its exact draft fields and Unicode code-point cap', async () => {
    const api = createCandidateMmiApi(rpcClient([{ data: responseProjection, error: null }]));
    await expect(api.start()).resolves.toEqual(responseProjection);
    for (const malformed of [
      { ...responseProjection, draftTranscript: undefined }, { ...responseProjection, draftRevision: -1 },
      { ...responseProjection, responseStatus: 'closed' }, { ...responseProjection, rubric: 'private' },
      { ...responseProjection, draftTranscript: 'x'.repeat(12_001) }, { ...responseProjection, draftTranscript: '😀'.repeat(12_001) },
    ]) await expect(createCandidateMmiApi(rpcClient([{ data: malformed, error: null }])).start()).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('rejects malformed projections and assessor or future fields', async () => {
    for (const malformed of [
      { ...responseProjection, futurePrompts: ['private'] },
      { ...responseProjection, rubric: 'private' },
      { ...responseProjection, promptText: ['current', 'future'] },
      { ...responseProjection, serverNow: responseProjection.phaseEndsAt },
      { ...scenarioProjection, phaseEndsAt: '2026-08-26T00:00:59.000Z' },
      { ...abandonedProjection, phaseEndsAt: '2026-08-26T00:01:11.000Z' },
    ]) {
      await expect(createCandidateMmiApi(rpcClient([{ data: malformed, error: null }])).start()).rejects.toMatchObject({ kind: 'invalid_response' });
    }
  });

  it('calls and parses exact checkpoint and finalization contracts without sending transcript on finalization', async () => {
    const client = rpcClient([{ data: checkpointResult, error: null }]);
    const api = createCandidateMmiApi(client);
    await expect(api.checkpoint(sessionId, 1, 'Manual draft', 4)).resolves.toEqual(checkpointResult);
    client.rpc.mockResolvedValueOnce({ data: finalizationResult, error: null });
    await expect(api.finalize(sessionId, 1, finalizationKey)).resolves.toEqual(finalizationResult);
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'checkpoint_candidate_mmi_station_response', { p_session_id: sessionId, p_prompt_order: 1, p_transcript: 'Manual draft', p_client_revision: 4 });
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'finalize_candidate_mmi_station_response', { p_session_id: sessionId, p_prompt_order: 1, p_finalization_key: finalizationKey });
  });

  it('rejects invalid checkpoint/finalization input and mismatched or expanded RPC results fail closed', async () => {
    const api = createCandidateMmiApi(rpcClient([{ data: checkpointResult, error: null }]));
    for (const [candidateSessionId, promptOrder, transcript, revision] of [[sessionId, 1, 'x'.repeat(12_001), 1], ['not-a-uuid', 1, 'draft', 1], [sessionId, 6, 'draft', 1], [sessionId, 1, 'draft', -1]] as const) {
      await expect(api.checkpoint(candidateSessionId, promptOrder as 1 | 2 | 3 | 4 | 5, transcript, revision)).rejects.toMatchObject({ kind: 'invalid_request' });
    }
    await expect(api.finalize(sessionId, 1, 'not-a-uuid')).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(createCandidateMmiApi(rpcClient([{ data: { ...checkpointResult, draftRevision: 5 }, error: null }])).checkpoint(sessionId, 1, 'draft', 4)).rejects.toMatchObject({ kind: 'invalid_response' });
    await expect(createCandidateMmiApi(rpcClient([{ data: { ...finalizationResult, transcript: 'private' }, error: null }])).finalize(sessionId, 1, finalizationKey)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('parses exactly five ordered feedback rows and rejects private/provider fields recursively', async () => {
    const feedback = [1, 2, 3, 4, 5].map(promptOrder => ({ promptOrder, status: promptOrder === 1 ? 'scored' : 'no_response', assessment: promptOrder === 1 ? assessment : null }));
    await expect(createCandidateMmiApi(rpcClient([{ data: feedback, error: null }])).feedback(sessionId)).resolves.toEqual(feedback);
    const malformed = [feedback.slice(0, 4), [{ ...feedback[0], assessment: { ...assessment, providerReasoning: 'private' } }, ...feedback.slice(1)], [{ ...feedback[0], assessment: { ...assessment, dimensions: { ...assessment.dimensions, structure: { ...assessment.dimensions.structure, model: 'private' } } } }, ...feedback.slice(1)], [{ ...feedback[0], status: 'scored', assessment: null }, ...feedback.slice(1)]];
    for (const value of malformed) await expect(createCandidateMmiApi(rpcClient([{ data: value, error: null }])).feedback(sessionId)).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('mirrors the public assessment shape: decimal percentages and valid applicable dimensions are accepted', async () => {
    const decimalAssessment = {
      ...assessment,
      overallPct: 70.1,
      dimensions: {
        ...assessment.dimensions,
        structure: { score: 4, applicable: true, evidence: 'Prioritised immediate safety.', improvement: 'State escalation triggers.' },
      },
    };
    const feedback = [1, 2, 3, 4, 5].map(promptOrder => ({ promptOrder, status: promptOrder === 1 ? 'scored' : 'no_response', assessment: promptOrder === 1 ? decimalAssessment : null }));
    await expect(createCandidateMmiApi(rpcClient([{ data: feedback, error: null }])).feedback(sessionId)).resolves.toEqual(feedback);
  });

  it('rejects assessment values the public contract forbids', async () => {
    const invalidAssessments = [
      { ...assessment, overallPct: 100.1 },
      { ...assessment, strengths: [' '] },
      { ...assessment, strengths: Array.from({ length: 21 }, () => 'valid') },
      { ...assessment, improvementTip: 'x'.repeat(1_001) },
      { ...assessment, dimensions: { ...assessment.dimensions, structure: { score: null, applicable: true, evidence: null, improvement: null } } },
      { ...assessment, dimensions: { ...assessment.dimensions, communication: { score: 1, applicable: false, evidence: null, improvement: null } } },
    ];
    for (const invalidAssessment of invalidAssessments) {
      const feedback = [1, 2, 3, 4, 5].map(promptOrder => ({ promptOrder, status: promptOrder === 1 ? 'scored' : 'no_response', assessment: promptOrder === 1 ? invalidAssessment : null }));
      await expect(createCandidateMmiApi(rpcClient([{ data: feedback, error: null }])).feedback(sessionId)).rejects.toMatchObject({ kind: 'invalid_response' });
    }
  });

  it('maps only exact safe error states without echoing server data', async () => {
    for (const [message, kind] of [['candidate_response_not_open', 'response_closed'], ['candidate_response_deadline_not_reached', 'response_not_closed'], ['candidate_feedback_not_ready', 'response_not_closed'], ['stale_candidate_mmi_checkpoint', 'in_progress']] as const) {
      await expect(createCandidateMmiApi(rpcClient([{ data: { transcript: 'private' }, error: { code: 'P0001', message } }])).start()).rejects.toMatchObject({ kind });
    }
    await expect(createCandidateMmiApi(rpcClient([{ data: {}, error: { code: 'P0001', message: 'private detail' } }])).start()).rejects.toThrow('Candidate MMI is unavailable.');
  });

  it('preserves exact start, refresh, and abandon RPC boundaries', async () => {
    const client = rpcClient([{ data: scenarioProjection, error: null }]);
    const api = createCandidateMmiApi(client);
    await api.start();
    client.rpc.mockResolvedValueOnce({ data: responseProjection, error: null });
    await api.refresh(sessionId);
    client.rpc.mockResolvedValueOnce({ data: null, error: null });
    await api.abandon(sessionId);
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'start_candidate_mmi_station_session');
    expect(client.rpc).toHaveBeenNthCalledWith(2, 'get_candidate_mmi_station_session', { p_session_id: sessionId });
    expect(client.rpc).toHaveBeenNthCalledWith(3, 'abandon_candidate_mmi_station_session', { p_session_id: sessionId });
  });
});

describe('candidate MMI runner finalization boundary', () => {
  function apiFixture() {
    return { start: vi.fn().mockResolvedValue(responseProjection), refresh: vi.fn().mockResolvedValue(responseProjection), checkpoint: vi.fn().mockResolvedValue(checkpointResult), finalize: vi.fn().mockResolvedValue(finalizationResult), abandon: vi.fn().mockResolvedValue(undefined) };
  }

  it('checkpoints only the current response and shares identical in-flight/accepted work without old acknowledgement saving a newer edit', async () => {
    const api = apiFixture();
    const checkpointResolvers: Array<(value: CandidateMmiCheckpoint) => void> = [];
    api.checkpoint.mockImplementation(() => new Promise(resolve => { checkpointResolvers.push(resolve); }));
    const runner = createCandidateMmiRunner(api); await runner.start();
    const first = runner.checkpoint({ transcript: 'A', revision: 4 });
    const duplicate = runner.checkpoint({ transcript: 'A', revision: 4 });
    expect(first).toBe(duplicate);
    const later = runner.checkpoint({ transcript: 'B', revision: 5 });
    checkpointResolvers[0]!(checkpointResult);
    checkpointResolvers[1]!({ ...checkpointResult, draftRevision: 5 });
    await first; await later;
    await runner.checkpoint({ transcript: 'B', revision: 5 });
    expect(api.checkpoint).toHaveBeenCalledTimes(2);
  });

  it('finalizes once before refresh, shares same-key work, and never advances after a failed finalization', async () => {
    const api = apiFixture(); api.refresh.mockResolvedValue(nextResponse);
    const runner = createCandidateMmiRunner(api); await runner.start();
    await expect(Promise.all([runner.expireCurrentPhase(finalizationKey), runner.expireCurrentPhase(finalizationKey)])).resolves.toEqual([nextResponse, nextResponse]);
    expect(api.finalize).toHaveBeenCalledExactlyOnceWith(sessionId, 1, finalizationKey);
    expect(api.finalize.mock.invocationCallOrder[0]).toBeLessThan(api.refresh.mock.invocationCallOrder[0]);
    const failing = apiFixture(); failing.finalize.mockRejectedValueOnce(new CandidateMmiApiError('unavailable'));
    const retryRunner = createCandidateMmiRunner(failing); await retryRunner.start();
    await expect(retryRunner.expireCurrentPhase(finalizationKey)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(failing.refresh).not.toHaveBeenCalled();
    await expect(retryRunner.expireCurrentPhase(finalizationKey)).resolves.toEqual(responseProjection);
    expect(failing.finalize).toHaveBeenCalledTimes(2);
  });

  it('refreshes scenario expiry without finalization and abandons once', async () => {
    const api = apiFixture(); api.start.mockResolvedValue(scenarioProjection);
    const runner = createCandidateMmiRunner(api); await runner.start();
    await expect(runner.expireCurrentPhase(finalizationKey)).resolves.toEqual(responseProjection);
    expect(api.finalize).not.toHaveBeenCalled();
    await runner.leave(); await runner.leave();
    expect(api.abandon).toHaveBeenCalledExactlyOnceWith(sessionId);
  });

  it('restores through refresh and accepts the server completed transition', async () => {
    const api = apiFixture();
    api.refresh.mockResolvedValueOnce(responseProjection).mockResolvedValueOnce(completedProjection);
    const runner = createCandidateMmiRunner(api);
    await expect(runner.restore(sessionId)).resolves.toEqual(responseProjection);
    await expect(runner.refresh()).resolves.toEqual(completedProjection);
    expect(api.start).not.toHaveBeenCalled();
    expect(api.refresh).toHaveBeenNthCalledWith(1, sessionId);
    expect(api.refresh).toHaveBeenNthCalledWith(2, sessionId);
  });

  it('does not let an older same-identity refresh overwrite a newer result', async () => {
    const api = apiFixture();
    let resolveFirstRefresh: ((value: CandidateMmiServerProjection) => void) | undefined;
    let resolveSecondRefresh: ((value: CandidateMmiServerProjection) => void) | undefined;
    api.refresh
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirstRefresh = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecondRefresh = resolve; }));
    api.start.mockResolvedValue(responseProjection);
    const runner = createCandidateMmiRunner(api);
    await runner.start();
    const first = runner.refresh();
    const second = runner.refresh();
    const newer = { ...responseProjection, serverNow: '2026-08-26T00:02:30.000Z', draftTranscript: 'newer', draftRevision: 4 };
    resolveSecondRefresh!(newer);
    await expect(second).resolves.toEqual(newer);
    resolveFirstRefresh!({ ...responseProjection, draftTranscript: 'stale', draftRevision: 1 });
    await expect(first).resolves.toEqual(newer);
  });

  it('rejects a checkpoint outside a current response', async () => {
    const api = apiFixture();
    api.start.mockResolvedValue(scenarioProjection);
    const runner = createCandidateMmiRunner(api);
    await runner.start();
    await expect(runner.checkpoint({ transcript: 'draft', revision: 1 })).rejects.toMatchObject({ kind: 'response_closed' });
  });

  it('uses a capability-checked finalization key path in the route', () => {
    const route = readFileSync(resolve(process.cwd(), 'app/practice/mmi-station.tsx'), 'utf8');
    expect(route).toContain('function createFinalizationKey');
    expect(route).toContain('globalThis.crypto');
    expect(route).toContain("typeof capability?.randomUUID !== 'function'");
    expect(route).not.toContain('crypto.randomUUID()');
  });

  it('releases only its own expiry guard after a failed finalization attempt', () => {
    const route = readFileSync(resolve(process.cwd(), 'app/practice/mmi-station.tsx'), 'utf8');
    expect(route).toContain('if (expiringPhaseRef.current === key) expiringPhaseRef.current = null;');
    expect(route).toMatch(/\.catch\(\(\) => \{[\s\S]*expiringPhaseRef\.current === key/);
  });
});

describe('candidate MMI feature flag', () => {
  it('uses the exact flag key and fails closed except for the exact enabled string', async () => {
    const { CANDIDATE_MMI_FEATURE_FLAG, isNormalizedMmiStationEnabled } = await import('../src/features/candidateMmi/featureFlag');
    expect(CANDIDATE_MMI_FEATURE_FLAG).toBe('normalized_mmi_station_enabled');
    await expect(isNormalizedMmiStationEnabled(async () => 'true')).resolves.toBe(true);
    for (const value of [undefined, null, false, true, 'TRUE', ' true ', 'false', {}, []]) {
      await expect(isNormalizedMmiStationEnabled(async () => value)).resolves.toBe(false);
    }
  });
});
