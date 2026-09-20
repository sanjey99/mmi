/**
 * score-candidate-mmi-response — scores only server-finalized candidate text.
 *
 * POST body: { sessionId: UUID, promptOrder: 1..5 }
 * The verified JWT supplies user identity. The database claim supplies every
 * scoring input and the service-owned lease.
 */

// @ts-ignore Deno resolves this URL import at deployment time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  callConfiguredProvider,
  type AiConfig,
} from '../_shared/aiProvider.ts';
import {
  createCandidateMmiScoringHandler,
  type CandidateMmiProviderFailureDiagnostic,
  type CandidateMmiScoringRepository,
} from './handler.ts';
import { parseUsdRate } from './rates.ts';

type EdgeDeno = Readonly<{
  env: Readonly<{ get: (name: string) => string | undefined }>;
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
}>;
const Deno: EdgeDeno = (globalThis as typeof globalThis & { Deno: EdgeDeno }).Deno;

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  throw new Error('Candidate MMI scoring configuration is incomplete.');
}

const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);
const gpt55Model = Deno.env.get('AI_GPT55_MODEL');
const gpt55InputRate = parseUsdRate(Deno.env.get('AI_GPT55_INPUT_RATE_PER_MILLION'));
const gpt55CachedInputRate = parseUsdRate(Deno.env.get('AI_GPT55_CACHED_INPUT_RATE_PER_MILLION'));
const gpt55OutputRate = parseUsdRate(Deno.env.get('AI_GPT55_OUTPUT_RATE_PER_MILLION'));
const gpt55Profile =
  typeof gpt55Model === 'string'
  && gpt55Model.length <= 200
  && /^gpt-5\.5(?:-[A-Za-z0-9._-]+)?$/.test(gpt55Model)
  && gpt55InputRate !== null
  && gpt55CachedInputRate !== null
  && gpt55OutputRate !== null
    ? Object.freeze({
      model: gpt55Model,
      inputRatePerMillion: gpt55InputRate,
      cachedInputRatePerMillion: gpt55CachedInputRate,
      outputRatePerMillion: gpt55OutputRate,
    })
    : null;

const repository: CandidateMmiScoringRepository = {
  async authenticate(authorization) {
    const authenticatedClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const {
      data: { user },
      error,
    } = await authenticatedClient.auth.getUser();
    return error || !user ? { error: true } : { userId: user.id };
  },

  async authorizeModelProfile({ userId, modelProfile }) {
    if (modelProfile === 'default') return { allowed: true };
    const { data, error } = await serviceClient
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle();
    return error ? { error: true } : { allowed: data?.is_admin === true };
  },

  claim: (args) =>
    serviceClient.rpc('claim_candidate_mmi_response_scoring', args),

  async loadProviderConfig() {
    const { data, error } = await serviceClient
      .from('app_config')
      .select('key, value')
      .in('key', [
        'ai_provider', 'ai_model', 'ai_base_url', 'ai_api_key',
        'ai_input_rate_per_million', 'ai_cached_input_rate_per_million',
        'ai_output_rate_per_million',
      ]);
    if (error) return { error: true };

    const values: Record<string, string> = {};
    for (const row of data ?? []) {
      if (typeof row.value === 'string' && row.value.length > 0) {
        values[row.key] = row.value;
      }
    }
    const inputRatePerMillion = parseUsdRate(values.ai_input_rate_per_million);
    const cachedInputRatePerMillion = parseUsdRate(values.ai_cached_input_rate_per_million);
    const outputRatePerMillion = parseUsdRate(values.ai_output_rate_per_million);
    if (!values.ai_api_key || inputRatePerMillion === null || cachedInputRatePerMillion === null || outputRatePerMillion === null) return {};
    const config: AiConfig = {
      provider: values.ai_provider ?? 'anthropic',
      model: values.ai_model ?? 'claude-3-5-haiku-20241022',
      apiKey: values.ai_api_key,
      baseUrl: values.ai_base_url ?? null,
      inputRatePerMillion,
      cachedInputRatePerMillion,
      outputRatePerMillion,
    };
    return { config };
  },

  complete: (args) =>
    serviceClient.rpc('complete_candidate_mmi_response_scoring', args),

  fail: (args) =>
    serviceClient.rpc('fail_candidate_mmi_response_scoring', args),
};

function logProviderFailure(
  diagnostic: CandidateMmiProviderFailureDiagnostic,
): void {
  console.error(diagnostic);
}

Deno.serve(
  createCandidateMmiScoringHandler({
    repository,
    allowedOrigins: Deno.env.get('APP_ALLOWED_ORIGINS') ?? '',
    createLeaseToken: () => crypto.randomUUID(),
    gpt55Profile,
    callProvider: callConfiguredProvider,
    logProviderFailure,
  }),
);
