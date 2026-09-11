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

  claim: (args) =>
    serviceClient.rpc('claim_candidate_mmi_response_scoring', args),

  async loadProviderConfig() {
    const { data, error } = await serviceClient
      .from('app_config')
      .select('key, value')
      .in('key', ['ai_provider', 'ai_model', 'ai_base_url', 'ai_api_key']);
    if (error) return { error: true };

    const values: Record<string, string> = {};
    for (const row of data ?? []) {
      if (typeof row.value === 'string' && row.value.length > 0) {
        values[row.key] = row.value;
      }
    }
    if (!values.ai_api_key) return {};
    const config: AiConfig = {
      provider: values.ai_provider ?? 'anthropic',
      model: values.ai_model ?? 'claude-3-5-haiku-20241022',
      apiKey: values.ai_api_key,
      baseUrl: values.ai_base_url ?? null,
      // Transitional generic scoring does not retain usage. Task 4 loads and
      // validates persisted rates before recording any usage event.
      inputRatePerMillion: 0,
      cachedInputRatePerMillion: 0,
      outputRatePerMillion: 0,
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
    callProvider: callConfiguredProvider,
    logProviderFailure,
  }),
);
