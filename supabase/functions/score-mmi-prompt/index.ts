import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-ignore Edge functions deliberately import source TypeScript.
import { callConfiguredProvider, type AiConfig } from '../_shared/aiProvider.ts';
// @ts-ignore Edge functions deliberately import source TypeScript.
import { createMmiPublicOutputContext, parseMmiRubric, parseSubmitMmiPromptRequest, toPublicMmiAssessment } from '../_shared/mmiContracts.ts';
// @ts-ignore Edge functions deliberately import source TypeScript.
import { getRetainedMmiScoringContract, parseProviderAssessmentForContract } from '../_shared/mmiScoringContract.ts';
// @ts-ignore Edge functions deliberately import source TypeScript.
import { buildMmiScoringSystemPrompt, formatReviewedTranscript, normalizeMmiSubmission } from '../_shared/mmiScoring.ts';
// @ts-ignore Edge functions deliberately import source TypeScript.
import { runMmiScoringOrchestration } from '../_shared/mmiScoringOrchestration.ts';
import { EdgeRequestError, prepareEdgeHttpRequest, readBoundedJson } from '../_shared/http.ts';

type Snapshot = {
  attempt_id: string; station_kind: 'standard' | 'roleplay'; prompt_order: number;
  prompt_text: string; hidden_reference_answer: string | null; hidden_actor_context: unknown;
  rubric_id: string; rubric_version: number; rubric_criteria: unknown; rubric_dimension_weights: unknown;
  rubric_safety_critical_items: unknown; scoring_contract_version: string; global_contract_snapshot: unknown;
  response_schema_snapshot: unknown;
};

function safeRpcCode(error: { message?: string } | null): string {
  return error?.message === 'attempt_not_found' ? 'attempt_not_found' : 'scoring_unavailable';
}

function safeAssessment(row: Record<string, unknown>) {
  return {
    dimensions: row.dimension_results,
    overallPct: row.overall_pct,
    strengths: row.strengths,
    improvements: row.improvements,
    improvementTip: row.improvement_tip,
    rubricVersion: row.rubric_version,
  };
}

async function providerConfig(service: { from: (table: string) => any }): Promise<AiConfig | null> {
  const { data, error } = await service.from('app_config').select('key,value')
    .in('key', ['ai_provider', 'ai_model', 'ai_base_url', 'ai_api_key']);
  if (error) return null;
  const values: Record<string, string> = {};
  const rows = (data ?? []) as Array<{ key: string; value: string | null }>;
  for (const row of rows) if (typeof row.value === 'string' && row.value) values[row.key] = row.value;
  if (!values.ai_api_key) return null;
  return { provider: values.ai_provider ?? 'anthropic', model: values.ai_model ?? 'claude-3-5-haiku-20241022', apiKey: values.ai_api_key, baseUrl: values.ai_base_url ?? null };
}

Deno.serve(async (req) => {
  const http = prepareEdgeHttpRequest(req, Deno.env.get('APP_ALLOWED_ORIGINS') ?? '');
  if (http.response) return http.response;
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return http.json({ code: 'unauthorized' }, 401);
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await anon.auth.getUser();
  if (authError || !user) return http.json({ code: 'unauthorized' }, 401);
  let request;
  try { request = parseSubmitMmiPromptRequest(await readBoundedJson(req, 20_000)); }
  catch (error) { return http.json({ code: 'invalid_request' }, error instanceof EdgeRequestError ? error.status : 400); }
  const normalized = await normalizeMmiSubmission({ ...request, attemptId: request.attemptId });
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: claim, error: claimError } = await service.rpc('claim_mmi_scoring_submission', {
    p_user_id: user.id, p_attempt_id: request.attemptId, p_idempotency_key: request.idempotencyKey,
    p_prompt_kind: request.promptKind, p_station_id: request.stationId,
    p_sub_question_id: request.promptKind === 'standard' ? request.subQuestionId : null, p_request_digest: normalized.digest,
  });
  if (claimError || !claim) return http.json({ code: safeRpcCode(claimError) }, claimError?.message === 'attempt_not_found' ? 404 : 409);
  const claimData = claim as Record<string, unknown>;
  if (claimData.code === 'idempotency_conflict') return http.json({ code: 'idempotency_conflict' }, 409);
  if (claimData.code === 'submission_in_progress') return http.json({ code: 'submission_in_progress' }, 409);
  if (claimData.code === 'rate_limited') return http.json({ code: 'rate_limited' }, 429, { 'Retry-After': String(claimData.retryAfter ?? 60) });
  if (claimData.code === 'completed') {
    const { data: saved, error } = await service.from('mmi_prompt_attempts')
      .select('dimension_results,overall_pct,strengths,improvements,improvement_tip,rubric_version')
      .eq('id', claimData.promptAttemptId as string).eq('attempt_id', request.attemptId).maybeSingle();
    if (error || !saved) return http.json({ code: 'scoring_unavailable' }, 409);
    const { data: attempt } = await service.from('mmi_attempts').select('status,current_prompt_order,expected_prompt_count').eq('id', request.attemptId).eq('user_id', user.id).maybeSingle();
    return http.json({ assessment: safeAssessment(saved), attemptStatus: attempt?.status === 'completed' ? 'completed' : 'in_progress', hasNextPrompt: Boolean(attempt && attempt.current_prompt_order < attempt.expected_prompt_count), replayed: true });
  }
  const claimId = claimData.claimId as string; const leaseToken = claimData.leaseToken as string;
  try {
    const { data: snapshot, error: snapshotError } = await service.from('mmi_attempt_prompt_snapshots')
      .select('attempt_id,station_kind,prompt_order,prompt_text,hidden_reference_answer,hidden_actor_context,rubric_id,rubric_version,rubric_criteria,rubric_dimension_weights,rubric_safety_critical_items,scoring_contract_version,global_contract_snapshot,response_schema_snapshot')
      .eq('attempt_id', request.attemptId).eq('prompt_order', (await service.from('mmi_attempts').select('current_prompt_order').eq('id', request.attemptId).eq('user_id', user.id).single()).data?.current_prompt_order ?? 0).maybeSingle();
    if (snapshotError || !snapshot) throw new Error('snapshot_unavailable');
    const pinned = snapshot as Snapshot;
    const rubric = parseMmiRubric({ version: pinned.rubric_version, criteria: pinned.rubric_criteria, dimensionWeights: pinned.rubric_dimension_weights, safetyCriticalItems: pinned.rubric_safety_critical_items });
    const contract = getRetainedMmiScoringContract(
      pinned.global_contract_snapshot,
      pinned.scoring_contract_version,
      pinned.response_schema_snapshot,
    );
    const config = await providerConfig(service);
    if (!config) throw new Error('provider_unavailable');
    const outcome = await runMmiScoringOrchestration<Record<string, unknown>, Record<string, unknown>>({
      transcript: normalized.transcript,
      runProvider: async () => await callConfiguredProvider(config, {
        systemPrompt: buildMmiScoringSystemPrompt({ rubric, hiddenReferenceAnswer: pinned.hidden_reference_answer, hiddenActorContext: pinned.hidden_actor_context, assessorInstructions: contract.assessorInstructions, responseSchema: pinned.response_schema_snapshot }),
        userContent: formatReviewedTranscript(normalized.transcript), maxTokens: 900,
      }) as string,
      parseProvider: (parsed) => {
        parseProviderAssessmentForContract(parsed, contract, rubric, normalized.transcript);
        return toPublicMmiAssessment(parsed, normalized.transcript, createMmiPublicOutputContext({ rubric, scoringContractVersion: contract.version, studentFeedbackCatalog: contract.studentFeedbackCatalog })) as unknown as Record<string, unknown>;
      },
      complete: async (assessment) => {
        const { data: completed, error: completeError } = await service.rpc('complete_mmi_scoring_submission', {
          p_claim_id: claimId, p_lease_token: leaseToken, p_transcript: normalized.transcript,
          p_assessment: assessment, p_rubric_id: pinned.rubric_id, p_rubric_version: pinned.rubric_version,
        });
        if (completeError || !completed) throw new Error('completion_unavailable');
        return completed as Record<string, unknown>;
      },
      fail: async () => { await service.rpc('fail_mmi_scoring_submission', { p_claim_id: claimId, p_lease_token: leaseToken, p_safe_error_code: 'scoring_unavailable' }); },
    });
    if ('code' in outcome) return http.json({ code: 'scoring_unavailable' }, 502);
    const result = outcome;
    return http.json({ assessment: result.assessment, attemptStatus: result.attemptStatus, hasNextPrompt: result.hasNextPrompt, replayed: false });
  } catch {
    await service.rpc('fail_mmi_scoring_submission', { p_claim_id: claimId, p_lease_token: leaseToken, p_safe_error_code: 'scoring_unavailable' });
    return http.json({ code: 'scoring_unavailable' }, 502);
  }
});
