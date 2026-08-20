import assert from 'node:assert/strict';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function isDisposableLocalUrl(value: string | undefined) {
  if (!value) return false;
  const hostname = new URL(value).hostname;
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

export async function expectDbCode(
  request: PromiseLike<{ error: { code?: string; message?: string } | null }>,
  expectedCode: string,
) {
  const { error } = await request;
  assert.ok(error, `expected database error ${expectedCode}`);
  assert.equal(error.code, expectedCode, error.message);
}

export async function createAuthenticatedTestClient(params: {
  service: SupabaseClient; url: string; anonKey: string; password: string;
  fixturePrefix: string; label: string;
}) {
  const email = `${params.fixturePrefix}-${params.label}@example.test`;
  const { data, error } = await params.service.auth.admin.createUser({
    email, password: params.password, email_confirm: true,
  });
  assert.equal(error, null, error?.message);
  assert.ok(data.user);
  const client = createClient(params.url, params.anonKey, {
    auth: { persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email, password: params.password,
  });
  assert.equal(signInError, null, signInError?.message);
  return { client, userId: data.user.id };
}

export function buildMmiPersistenceFixtures(fixturePrefix: string) {
  const dimensions = [
    'structure', 'ethics', 'communication', 'reflection', 'nhs_awareness',
  ] as const;
  const weights = Object.fromEntries(
    dimensions.map((dimension) => [dimension, 0.2]),
  );
  const safetyItems = [{
    id: 'seek-senior-help',
    assessor_criterion: 'Escalates unsafe care to an appropriate senior.',
    student_feedback: 'Explain when and how you would seek senior help.',
  }];
  const ids = {
    noticeAccount: `${fixturePrefix}-notice-account`,
    noticeFixed: `${fixturePrefix}-notice-fixed`,
    roleplay: `${fixturePrefix}-roleplay`,
    standard: `${fixturePrefix}-standard`,
    standardPrompt1: `${fixturePrefix}-standard-prompt-1`,
    standardPrompt2: `${fixturePrefix}-standard-prompt-2`,
  } as const;

  function dimensionResults(score: number | null = 4) {
    return Object.fromEntries(
      dimensions.map((dimension) => [
        dimension,
        {
          applicable: score !== null,
          evidence: score === null ? null : `Evidence for ${dimension}`,
          improvement: score === null ? null : `Improve ${dimension}`,
          score,
        },
      ]),
    );
  }

  function safeContentSnapshot(stationId = ids.standard) {
    return {
      content_version: 'fixture-v1',
      station_kind: 'standard',
      station_id: stationId,
      title: 'Integration station',
      category: 'ethics',
      topic: 'Consent',
      difficulty: 'intermediate',
      university_tags: [],
      prep_time_sec: 60,
      prompt_count: 2,
      student_brief: 'A safe student-facing brief.',
      opening_line: null,
    };
  }

  function promptSnapshotRow(
    attempt: Record<string, unknown>, promptOrder: number, rubricId: string,
  ) {
    return {
      attempt_id: attempt.id,
      station_kind: attempt.station_kind,
      prompt_order: promptOrder,
      standard_sub_q_id: promptOrder === 1 ? ids.standardPrompt1 : ids.standardPrompt2,
      prompt_text: `Pinned prompt ${promptOrder}`,
      time_limit_sec: 120,
      hidden_reference_answer: 'Private pinned reference.',
      rubric_id: rubricId,
      rubric_version: 1,
      rubric_criteria: { summary: 'Pinned private criteria.' },
      rubric_dimension_weights: weights,
      rubric_safety_critical_items: safetyItems,
      content_version: 'fixture-v1',
      scoring_contract_version: 'mmi-score-v1',
      global_contract_snapshot: { version: 'mmi-score-v1' },
      response_schema_snapshot: { type: 'object' },
    };
  }

  function promptResultRow(
    attempt: Record<string, unknown>, promptOrder: number, rubricId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      attempt_id: attempt.id,
      station_kind: attempt.station_kind,
      standard_sub_q_id: promptOrder === 1 ? ids.standardPrompt1 : ids.standardPrompt2,
      prompt_order: promptOrder,
      reviewed_transcript: `Reviewed fixture transcript ${promptOrder}`,
      dimension_results: dimensionResults(promptOrder === 1 ? 4 : 2),
      strengths: [`Strength ${promptOrder}`],
      improvements: [`Improvement ${promptOrder}`],
      improvement_tip: `Tip ${promptOrder}`,
      overall_pct: promptOrder === 1 ? 80 : 40,
      rubric_id: rubricId,
      rubric_version: 1,
      scoring_contract_version: 'mmi-score-v1',
      submitted_at: new Date().toISOString(),
      ...overrides,
    };
  }

  return {
    dimensionResults, ids, promptResultRow, promptSnapshotRow,
    safetyItems, safeContentSnapshot, weights,
  };
}
