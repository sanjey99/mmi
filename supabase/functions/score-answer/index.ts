/**
 * score-answer — authenticated, server-owned legacy scoring.
 *
 * POST body: { sessionId: UUID, questionId: UUID, answerText: string }
 * The verified JWT supplies user identity. The database supplies the prompt.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  callConfiguredProvider,
  formatScoringUserContent,
  parseLegacyScoreResponse,
  ProviderRequestError,
  providerFailureDiagnostic,
  type AiConfig,
} from '../_shared/aiProvider.ts';
import {
  hashLegacyAnswer,
  parseLegacyScoringRequest,
  readLegacyClaim,
  safeLegacyRpcCode,
} from '../_shared/legacyScoring.ts';
import {
  EdgeRequestError,
  prepareEdgeHttpRequest,
  readBoundedJson,
} from '../_shared/http.ts';

const SCORING_SYSTEM_PROMPT = `You are an expert UK medical school interviewer and assessor.
Evaluate the student's answer to the supplied interview question.

Score EXACTLY five dimensions from 1 to 5:
1. structure — logical flow and appropriate framework use
2. ethics — recognition and balancing of relevant ethical principles
3. communication — clarity, precision, and avoidance of unnecessary jargon
4. reflection — self-awareness, learning, and personal growth
5. nhs_awareness — relevant NHS values, systems, or current-context awareness

Return exactly one JSON object with structure, ethics, communication, reflection,
nhs_awareness, overall_pct, ai_feedback, and improvement_tip. overall_pct must
equal the arithmetic mean of the five dimensions multiplied by 20. Feedback must
be constructive practice guidance, not clinical, admissions, or professional advice.`;

Deno.serve(async (request) => {
  const http = prepareEdgeHttpRequest(request, Deno.env.get('APP_ALLOWED_ORIGINS') ?? '');
  if (http.response) return http.response;

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return http.json({ code: 'unauthorized' }, 401);
  }

  const authenticatedClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );
  const { data: { user }, error: authenticationError } = await authenticatedClient.auth.getUser();
  if (authenticationError || !user) {
    return http.json({ code: 'unauthorized' }, 401);
  }

  let input;
  try {
    input = parseLegacyScoringRequest(await readBoundedJson(request, 4_096));
  } catch (error) {
    const status = error instanceof EdgeRequestError ? error.status : 400;
    return http.json({ code: 'invalid_request' }, status);
  }

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Configuration failures happen before a durable provider-attempt claim, so
  // a missing key cannot consume a user's rate-limit allowance.
  const { data: configRows, error: configError } = await serviceClient
    .from('app_config')
    .select('key, value')
    .in('key', ['ai_provider', 'ai_model', 'ai_base_url', 'ai_api_key']);
  if (configError) return http.json({ code: 'persistence_failed' }, 500);

  const configuration: Record<string, string> = {};
  for (const row of configRows ?? []) {
    if (row.value) configuration[row.key] = row.value;
  }
  if (!configuration.ai_api_key) {
    return http.json({ code: 'provider_not_configured' }, 503);
  }
  const providerConfig: AiConfig = {
    provider: configuration.ai_provider ?? 'anthropic',
    model: configuration.ai_model ?? 'claude-3-5-haiku-20241022',
    apiKey: configuration.ai_api_key,
    baseUrl: configuration.ai_base_url ?? null,
  };

  const answerHash = await hashLegacyAnswer(input.answerText);
  const leaseToken = crypto.randomUUID();

  const { data: claimData, error: claimError } = await serviceClient.rpc('claim_legacy_scoring', {
    p_user_id: user.id,
    p_session_id: input.sessionId,
    p_question_id: input.questionId,
    p_answer_text: input.answerText,
    p_answer_hash: answerHash,
    p_lease_token: leaseToken,
  });
  if (claimError) {
    const code = safeLegacyRpcCode(claimError);
    const status = code === 'rate_limited'
      ? 429
      : code === 'answer_conflict'
        ? 409
        : code === 'submission_unavailable'
          ? 404
          : code === 'invalid_request'
            ? 400
            : 500;
    const headers = code === 'rate_limited' ? { 'Retry-After': '3600' } : undefined;
    return http.json({ code }, status, headers);
  }

  let claim;
  try {
    claim = readLegacyClaim(claimData);
  } catch {
    return http.json({ code: 'persistence_failed' }, 500);
  }

  if (claim.status === 'in_progress') {
    return http.json({ code: 'in_progress' }, 409, { 'Retry-After': '3' });
  }
  if (claim.status === 'succeeded') {
    try {
      return http.json(parseLegacyScoreResponse(JSON.stringify(claim.result)));
    } catch {
      return http.json({ code: 'persistence_failed' }, 500);
    }
  }

  let providerResult;
  try {
    const raw = await callConfiguredProvider(providerConfig, {
      systemPrompt: SCORING_SYSTEM_PROMPT,
      userContent: formatScoringUserContent(claim.question_text, input.answerText),
      maxTokens: 512,
    });
    providerResult = parseLegacyScoreResponse(raw);
  } catch (error) {
    const errorCode = error instanceof Error && error.message === 'AI_PROVIDER_RESPONSE_INVALID'
      ? 'invalid_provider_response'
      : 'provider_failed';
    if (error instanceof ProviderRequestError) {
      console.error(providerFailureDiagnostic(
        request.headers.get('x-request-id'),
        providerConfig.provider,
        error,
      ));
    }
    await serviceClient.rpc('fail_legacy_scoring', {
      p_user_id: user.id,
      p_claim_id: claim.claim_id,
      p_lease_token: claim.lease_token,
      p_error_code: errorCode,
    });
    return http.json({ code: errorCode }, 502);
  }

  const { data: savedResult, error: completionError } = await serviceClient.rpc('complete_legacy_scoring', {
    p_user_id: user.id,
    p_claim_id: claim.claim_id,
    p_lease_token: claim.lease_token,
    p_answer_text: input.answerText,
    p_answer_hash: answerHash,
    p_structure: providerResult.structure,
    p_ethics: providerResult.ethics,
    p_communication: providerResult.communication,
    p_reflection: providerResult.reflection,
    p_nhs_awareness: providerResult.nhs_awareness,
    p_ai_feedback: providerResult.ai_feedback,
    p_improvement_tip: providerResult.improvement_tip,
  });
  if (completionError) {
    await serviceClient.rpc('fail_legacy_scoring', {
      p_user_id: user.id,
      p_claim_id: claim.claim_id,
      p_lease_token: claim.lease_token,
      p_error_code: 'persistence_failed',
    });
    const code = safeLegacyRpcCode(completionError);
    return http.json({ code }, code === 'answer_conflict' ? 409 : 500);
  }

  try {
    return http.json(parseLegacyScoreResponse(JSON.stringify(savedResult)));
  } catch {
    return http.json({ code: 'persistence_failed' }, 500);
  }
});
