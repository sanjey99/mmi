import { describe, expect, it, vi } from 'vitest';
import { AdminMmiApiError, createAdminMmiApi } from '../src/features/adminMmi/api';
import type { AdminMmiStationDraft } from '../src/features/adminMmi/types';

const adminId = '11111111-1111-4111-8111-111111111111';
const subjectId = '22222222-2222-4222-8222-222222222222';
const responseId = '33333333-3333-4333-8333-333333333333';
const auditId = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-09-10T10:00:00.000Z';

const station: AdminMmiStationDraft = {
  stationId: 'MMI_001', expectedVersion: 2, category: 'ethics', topic: 'Safety',
  difficulty: 'intermediate', universityTags: ['all'], prepTimeSec: 60, imageUrl: null,
  scenarioText: 'A safe scenario.',
  questions: [1, 2, 3, 4, 5].map((order) => ({
    subQuestionId: `MMI_001_Q${order}`, order, questionText: `Question ${order}`,
    timeLimitSec: 120, modelAnswerCached: null,
    criteria: [{ criterionId: `MMI_001_Q${order}_C1`, order: 1, bulletText: 'Escalates safely', domain: 'safety', sourceWeight: 1 }],
  })),
};

const dashboard = {
  stationCounts: { draft: 2, published: 155, archived: 1 },
  universityCounts: [{ tag: 'all', count: 115 }, { tag: 'oxford', count: 0 }],
  contentHealth: { stationCount: 158, questionCount: 790, criterionCount: 3160, invalidStationCount: 3 },
  ai: { provider: 'anthropic', model: 'claude-test', isConfigured: true },
  usage: { callCount: 20, knownCost: '1.25000000', unknownCostCount: 2, failureCount: 1 },
};
const stationList = {
  items: [{ stationId: 'MMI_001', category: 'ethics', topic: 'Safety', difficulty: 'intermediate', universityTags: ['all'], prepTimeSec: 60, status: 'published', contentVersion: 2, questionCount: 5, criterionCount: 5, isComplete: true, updatedAt: timestamp }],
  total: 1,
};
const stationDetail = { station, status: 'published', contentVersion: 2 };
const panelList = {
  items: [{ questionId: 'PANEL_001', questionText: 'Why medicine?', stationType: 'panel', topic: 'motivation', difficulty: 'foundation', universityTags: ['all'], notes: 'Admin note', modelAnswerCached: null, status: 'draft', updatedAt: timestamp }],
  total: 1,
};
const aiConfig = { provider: 'anthropic', model: 'claude-test', baseUrl: null, inputRatePerMillion: 1, cachedInputRatePerMillion: 0.1, outputRatePerMillion: 5, isConfigured: true, updatedAt: timestamp };
const usage = {
  summary: { callCount: 1, inputTokens: 100, cachedInputTokens: 5, outputTokens: 20, knownCost: '0.00020500', unknownCostCount: 0, averageLatencyMs: 350, failureRatePct: 0 },
  rows: [{ usageId: auditId, userId: subjectId, userDisplayName: 'Candidate A', sessionId: adminId, responseId, stationId: 'MMI_001', promptOrder: 1, scope: 'target', targetUniversity: 'Oxford', provider: 'anthropic', model: 'claude-test', inputTokens: 100, cachedInputTokens: 5, outputTokens: 20, estimatedCost: '0.00020500', latencyMs: 350, outcome: 'scored', createdAt: timestamp }],
};
const assessments = {
  items: [{ responseId, userId: subjectId, userDisplayName: 'Candidate A', stationId: 'MMI_001', subQuestionId: 'MMI_001_Q1', promptOrder: 1, questionScorePct: 25, provider: 'anthropic', model: 'claude-test', estimatedCost: '0.00020500', costKnown: true, outcome: 'scored', scoredAt: timestamp }],
  total: 1,
};
const assessment = {
  accessAuditId: auditId, responseId, userId: subjectId, userDisplayName: 'Candidate A',
  stationId: 'MMI_001', subQuestionId: 'MMI_001_Q1', promptOrder: 1, questionScorePct: 25,
  criteria: [
    { criterionId: 'MMI_001_Q1_C1', bulletText: 'Escalates safely', domain: 'safety', achieved: true, weightPct: 25 },
    { criterionId: 'MMI_001_Q1_C2', bulletText: 'Clarifies the concern', domain: 'communication', achieved: false, weightPct: 25 },
    { criterionId: 'MMI_001_Q1_C3', bulletText: 'Protects confidentiality', domain: 'ethics', achieved: false, weightPct: 25 },
    { criterionId: 'MMI_001_Q1_C4', bulletText: 'Documents next steps', domain: 'governance', achieved: false, weightPct: 25 },
  ],
  provider: 'anthropic', model: 'claude-test', inputTokens: 100, cachedInputTokens: 5,
  outputTokens: 20, estimatedCost: '0.00020500', latencyMs: 350, outcome: 'scored',
  finalizedAt: timestamp, scoredAt: timestamp,
};
const confirmation = { ok: true, auditId, targetId: 'MMI_001', version: 3 };

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
function rpcClient(results: readonly RpcResult[]) {
  const queue = [...results];
  return { rpc: vi.fn(async (_name: string, _args?: Record<string, unknown>) => queue.shift() ?? { data: null, error: { code: 'missing' } }) };
}

describe('admin MMI API', () => {
  it('calls each narrow RPC and accepts only its exact response contract', async () => {
    const client = rpcClient([
      { data: dashboard, error: null }, { data: stationList, error: null },
      { data: stationDetail, error: null }, { data: panelList, error: null },
      { data: aiConfig, error: null }, { data: usage, error: null },
      { data: assessments, error: null }, { data: assessment, error: null },
    ]);
    const api = createAdminMmiApi(client);

    await expect(api.getDashboard()).resolves.toEqual(dashboard);
    await expect(api.listStations({ query: 'safe', status: 'published', university: 'oxford', limit: 20, offset: 0 })).resolves.toEqual(stationList);
    await expect(api.getStation('MMI_001')).resolves.toEqual(stationDetail);
    await expect(api.listPanels({ limit: 20, offset: 0 })).resolves.toEqual(panelList);
    await expect(api.getAiConfig()).resolves.toEqual(aiConfig);
    await expect(api.getUsage({ limit: 20, offset: 0 })).resolves.toEqual(usage);
    await expect(api.listAssessments({ limit: 20, offset: 0 })).resolves.toEqual(assessments);
    await expect(api.getAssessment(responseId, 'quality_audit')).resolves.toEqual(assessment);

    expect(client.rpc.mock.calls.map(([name]) => name)).toEqual([
      'get_admin_mmi_dashboard', 'list_admin_mmi_stations', 'get_admin_mmi_station',
      'list_admin_mmi_panels', 'get_admin_ai_config', 'get_admin_mmi_usage',
      'list_admin_mmi_assessments', 'get_admin_mmi_assessment',
    ]);
    expect(client.rpc).toHaveBeenLastCalledWith('get_admin_mmi_assessment', {
      p_response_id: responseId,
      p_purpose: 'quality_audit',
    });
  });

  it('rejects forbidden content keys recursively on every response boundary', async () => {
    const validValues = [dashboard, stationList, stationDetail, panelList, aiConfig, usage, assessments, assessment];
    const calls = [
      (api: ReturnType<typeof createAdminMmiApi>) => api.getDashboard(),
      (api: ReturnType<typeof createAdminMmiApi>) => api.listStations({ limit: 20, offset: 0 }),
      (api: ReturnType<typeof createAdminMmiApi>) => api.getStation('MMI_001'),
      (api: ReturnType<typeof createAdminMmiApi>) => api.listPanels({ limit: 20, offset: 0 }),
      (api: ReturnType<typeof createAdminMmiApi>) => api.getAiConfig(),
      (api: ReturnType<typeof createAdminMmiApi>) => api.getUsage({ limit: 20, offset: 0 }),
      (api: ReturnType<typeof createAdminMmiApi>) => api.listAssessments({ limit: 20, offset: 0 }),
      (api: ReturnType<typeof createAdminMmiApi>) => api.getAssessment(responseId, 'support'),
    ];

    for (const [index, call] of calls.entries()) {
      for (const forbidden of ['transcript', 'answerText', 'evidence', 'rawResponse', 'apiKey']) {
        const widened = { ...validValues[index], nested: { [forbidden]: 'private' } };
        await expect(call(createAdminMmiApi(rpcClient([{ data: widened, error: null }]))))
          .rejects.toMatchObject({ kind: 'invalid_response' });
      }
    }
  });

  it('validates filters, identifiers, purpose and AI settings before making RPC calls', async () => {
    const client = rpcClient([]);
    const api = createAdminMmiApi(client);
    await expect(api.getStation('../unsafe')).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(api.listStations({ limit: 101, offset: 0 })).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(api.getAssessment(responseId, 'curiosity' as never)).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(api.getAssessment('not-a-uuid', 'support')).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(api.saveAiConfig({ provider: 'anthropic', model: 'claude-test', baseUrl: null, inputRatePerMillion: -1, cachedInputRatePerMillion: 0, outputRatePerMillion: 1 })).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns rejected promises for malformed date filters without calling an RPC', async () => {
    const client = rpcClient([]);
    const api = createAdminMmiApi(client);
    let usageRequest: ReturnType<typeof api.getUsage> | undefined;
    let assessmentRequest: ReturnType<typeof api.listAssessments> | undefined;

    expect(() => { usageRequest = api.getUsage({ from: 'not-a-date', limit: 20, offset: 0 }); }).not.toThrow();
    expect(() => { assessmentRequest = api.listAssessments({ to: 'not-a-date', limit: 20, offset: 0 }); }).not.toThrow();
    await expect(usageRequest).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(assessmentRequest).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('sends normalized non-secret mutations and parses an audited confirmation', async () => {
    const client = rpcClient([{ data: confirmation, error: null }, { data: confirmation, error: null }]);
    const api = createAdminMmiApi(client);
    await expect(api.saveStation(station)).resolves.toEqual(confirmation);
    await expect(api.saveAiConfig({ provider: 'anthropic', model: ' claude-test ', baseUrl: null, inputRatePerMillion: 1, cachedInputRatePerMillion: 0.1, outputRatePerMillion: 5 })).resolves.toEqual(confirmation);
    expect(client.rpc).toHaveBeenNthCalledWith(1, 'save_admin_mmi_station', {
      p_station: expect.objectContaining({ stationId: 'MMI_001' }),
      p_expected_version: 2,
    });
    expect(JSON.stringify(client.rpc.mock.calls[1])).not.toMatch(/api.?key/i);
  });

  it('rejects widened, malformed, inconsistent, or secret-bearing payloads', async () => {
    const malformed = [
      { ...dashboard, extra: true },
      { ...stationList, total: -1 },
      { ...stationDetail, station: { ...station, questions: station.questions.slice(0, 4) } },
      { ...panelList, items: [{ ...panelList.items[0], questionId: '../bad' }] },
      { ...aiConfig, apiKey: 'secret' },
      { ...usage, summary: { ...usage.summary, failureRatePct: 101 } },
      { ...assessments, items: [{ ...assessments.items[0], costKnown: false }] },
      { ...assessment, criteria: [{ ...assessment.criteria[0], weightPct: Number.NaN }] },
      { ...confirmation, version: 0 },
    ];
    const calls = [
      (api: ReturnType<typeof createAdminMmiApi>) => api.getDashboard(),
      (api: ReturnType<typeof createAdminMmiApi>) => api.listStations({ limit: 20, offset: 0 }),
      (api: ReturnType<typeof createAdminMmiApi>) => api.getStation('MMI_001'),
      (api: ReturnType<typeof createAdminMmiApi>) => api.listPanels({ limit: 20, offset: 0 }),
      (api: ReturnType<typeof createAdminMmiApi>) => api.getAiConfig(),
      (api: ReturnType<typeof createAdminMmiApi>) => api.getUsage({ limit: 20, offset: 0 }),
      (api: ReturnType<typeof createAdminMmiApi>) => api.listAssessments({ limit: 20, offset: 0 }),
      (api: ReturnType<typeof createAdminMmiApi>) => api.getAssessment(responseId, 'scoring_review'),
      (api: ReturnType<typeof createAdminMmiApi>) => api.saveStation(station),
    ];
    for (const [index, value] of malformed.entries()) {
      await expect(calls[index]!(createAdminMmiApi(rpcClient([{ data: value, error: null }]))))
        .rejects.toBeInstanceOf(AdminMmiApiError);
    }
  });

  it('maps authorization and version-conflict failures without leaking database messages', async () => {
    await expect(createAdminMmiApi(rpcClient([{ data: null, error: { code: '42501', message: 'internal details' } }])).getDashboard())
      .rejects.toMatchObject({ kind: 'access_denied', message: 'Admin MMI access is denied.' });
    await expect(createAdminMmiApi(rpcClient([{ data: null, error: { code: '40001', message: 'mmi_station_version_conflict' } }])).saveStation(station))
      .rejects.toMatchObject({ kind: 'version_conflict', message: 'This content changed. Reload it before saving again.' });
  });
});
