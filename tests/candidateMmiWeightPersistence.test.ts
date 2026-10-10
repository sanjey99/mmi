import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { type AiConfig } from '../supabase/functions/_shared/aiProvider.ts';
import { createCandidateMmiScoringHandler, type CandidateMmiScoringRepository } from '../supabase/functions/score-candidate-mmi-response/handler.ts';

const scoringMigration = readFileSync(new URL('../supabase/migrations/20260910001000_mmi_rubric_scoring_retention.sql', import.meta.url), 'utf8');
const origin = 'https://preview.example.test';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = '11111111-1111-4111-8111-111111111111';
const responseId = '22222222-2222-4222-8222-222222222222';
const leaseToken = '33333333-3333-4333-8333-333333333333';
const transcript = 'I would protect confidentiality and escalate the immediate risk.';
const providerConfig: AiConfig = {
  provider: 'openai', model: 'gpt-4o-mini', apiKey: 'synthetic-test-key', baseUrl: null,
  inputRatePerMillion: 0.15, cachedInputRatePerMillion: 0.075, outputRatePerMillion: 0.6,
};

// Fixed decimal results of the database's numeric rounding, not JavaScript's projector.
const persistenceCases = [
  { count: 3, achievedCount: 0, weightPct: 33.33333333, scorePct: 0 },
  { count: 3, achievedCount: 1, weightPct: 33.33333333, scorePct: 33.33 },
  { count: 3, achievedCount: 2, weightPct: 33.33333333, scorePct: 66.67 },
  { count: 3, achievedCount: 3, weightPct: 33.33333333, scorePct: 100 },
  { count: 6, achievedCount: 0, weightPct: 16.66666667, scorePct: 0 },
  { count: 6, achievedCount: 1, weightPct: 16.66666667, scorePct: 16.67 },
  { count: 6, achievedCount: 2, weightPct: 16.66666667, scorePct: 33.33 },
  { count: 6, achievedCount: 3, weightPct: 16.66666667, scorePct: 50 },
  { count: 6, achievedCount: 4, weightPct: 16.66666667, scorePct: 66.67 },
  { count: 6, achievedCount: 5, weightPct: 16.66666667, scorePct: 83.33 },
  { count: 6, achievedCount: 6, weightPct: 16.66666667, scorePct: 100 },
] as const;

describe('candidate MMI database weight precision', () => {
  it.each(persistenceCases)('persists $achievedCount/$count achievements with SQL-compatible weights and two-decimal scores', async ({ count, achievedCount, weightPct, scorePct }) => {
    // Keep this repository boundary faithful to the deployed SQL completion checks.
    expect(scoringMigration).toContain("(item.value->>'weightPct')::numeric <> round(100::numeric/cardinality(v_expected_ids), 8)");
    expect(scoringMigration).toContain('v_score:=round((v_achieved::numeric / cardinality(v_expected_ids))*100,2)');
    const criteria = Array.from({ length: count }, (_, index) => ({ criterionId: `CRIT_${index + 1}`, bulletText: `Criterion ${index + 1}`, domain: null }));
    const complete = vi.fn<CandidateMmiScoringRepository['complete']>(async ({ p_public_assessment }) => {
      const valid = p_public_assessment.questionScorePct === scorePct
        && p_public_assessment.criteria.length === count
        && p_public_assessment.criteria.every((criterion, index) => criterion.criterionId === criteria[index].criterionId
          && criterion.achieved === (index < achievedCount) && criterion.weightPct === weightPct);
      return valid ? { data: { status: 'scored' } } : { error: { message: 'invalid_rubric_assessment' } };
    });
    const fail = vi.fn<CandidateMmiScoringRepository['fail']>(async () => ({}));
    const logProviderFailure = vi.fn();
    const repository: CandidateMmiScoringRepository = {
      authenticate: async () => ({ userId }), authorizeModelProfile: async () => ({ allowed: true }),
      claim: async () => ({ data: {
        status: 'claimed', responseId, sessionId, promptOrder: 1,
        scenarioText: 'A colleague may have breached confidentiality.', promptText: 'How would you respond?',
        transcript, criteria, scoringContractVersion: '2026-09-10.1',
      } }),
      loadProviderConfig: async () => ({ config: providerConfig }), complete, fail,
    };
    const handler = createCandidateMmiScoringHandler({
      repository, allowedOrigins: origin, createLeaseToken: () => leaseToken, gpt55Profile: null, logProviderFailure,
      callProvider: async () => ({
        content: JSON.stringify({ decisions: criteria.map(({ criterionId }, index) => ({
          criterionId, achieved: index < achievedCount, evidenceQuote: index < achievedCount ? 'protect confidentiality' : null,
        })) }),
        usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 100 },
      }),
    });
    const response = await handler(new Request('http://localhost/functions/v1/score-candidate-mmi-response', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-test-token' },
      body: JSON.stringify({ sessionId, promptOrder: 1 }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'scored' });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    expect(logProviderFailure).not.toHaveBeenCalled();
    const persisted = JSON.stringify(complete.mock.calls[0]?.[0]);
    expect(persisted).not.toContain(transcript);
    expect(persisted).not.toContain('evidenceQuote');
    expect(persisted).not.toContain('evidenceReference');
  });
});
