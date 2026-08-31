// @ts-ignore Deno Edge module resolution requires the explicit TypeScript extension.
import { assertSafeProviderUrl, type ResolveDns } from './providerUrl.ts';

export const AI_PROVIDER_TIMEOUT_MS = 60_000;
export const MMI_SCORING_CLAIM_LEASE_MS = 180_000;
export const MAX_AI_FEEDBACK_LENGTH = 2_000;
export const MAX_IMPROVEMENT_TIP_LENGTH = 1_000;
const BUILT_IN_PROVIDER_HOSTS = Object.freeze(['api.anthropic.com', 'api.openai.com']);
const MAX_DIAGNOSTIC_REQUEST_ID_LENGTH = 128;
const DIAGNOSTIC_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export interface AiConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string | null;
}

export interface AiProviderRequest {
  systemPrompt: string;
  userContent: string;
  maxTokens: number;
}

export interface LegacyScoreResponse {
  structure: number;
  ethics: number;
  communication: number;
  reflection: number;
  nhs_awareness: number;
  overall_pct: number;
  ai_feedback: string;
  improvement_tip: string;
}

export type ProviderRequestStage = 'configuration' | 'dns_preflight' | 'network' | 'http' | 'response_shape';
type DiagnosticProvider = 'anthropic' | 'openai' | 'openai_compatible' | 'unknown';

interface ProviderRequestErrorOptions {
  status?: number;
  providerRequestId?: string | null;
}

export class ProviderRequestError extends Error {
  readonly stage: ProviderRequestStage;
  readonly status?: number;
  readonly providerRequestId?: string;

  constructor(stage: ProviderRequestStage, options: ProviderRequestErrorOptions = {}) {
    super('AI_PROVIDER_REQUEST_FAILED');
    this.name = 'ProviderRequestError';
    this.stage = stage;
    if (typeof options.status === 'number' && Number.isInteger(options.status) && options.status >= 100 && options.status <= 599) {
      this.status = options.status;
    }
    this.providerRequestId = sanitizeDiagnosticRequestId(options.providerRequestId);
  }
}

/** Accept only bounded, token-safe identifiers before emitting operational diagnostics. */
export function sanitizeDiagnosticRequestId(value: string | null | undefined): string | undefined {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_DIAGNOSTIC_REQUEST_ID_LENGTH
    || !DIAGNOSTIC_REQUEST_ID_PATTERN.test(value)
  ) return undefined;
  return value;
}

function diagnosticProvider(provider: string): DiagnosticProvider {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'openai') return 'openai';
  if (provider === 'openai_compatible') return 'openai_compatible';
  return 'unknown';
}

/** Produces the sole allowlisted shape permitted in provider-failure logs. */
export function providerFailureDiagnostic(
  functionRequestId: string | null | undefined,
  provider: string,
  error: ProviderRequestError,
): {
  functionRequestId?: string;
  provider: DiagnosticProvider;
  stage: ProviderRequestStage;
  status?: number;
  providerRequestId?: string;
} {
  const diagnostic: {
    functionRequestId?: string;
    provider: DiagnosticProvider;
    stage: ProviderRequestStage;
    status?: number;
    providerRequestId?: string;
  } = {
    provider: diagnosticProvider(provider),
    stage: error.stage,
  };
  const safeFunctionRequestId = sanitizeDiagnosticRequestId(functionRequestId);
  if (safeFunctionRequestId) diagnostic.functionRequestId = safeFunctionRequestId;
  if (error.status !== undefined) diagnostic.status = error.status;
  if (error.providerRequestId) diagnostic.providerRequestId = error.providerRequestId;
  return diagnostic;
}

function readEdgeSecret(name: string): string | undefined {
  const deno = globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  };
  return deno.Deno?.env?.get?.(name);
}

function providerAllowedHosts(): string[] {
  const configured = readEdgeSecret('AI_PROVIDER_ALLOWED_HOSTS')
    ?.split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean) ?? [];
  return [...BUILT_IN_PROVIDER_HOSTS, ...configured];
}

const resolveDenoDns: ResolveDns = async (hostname, recordType) => {
  const deno = globalThis as typeof globalThis & {
    Deno?: { resolveDns?: ResolveDns };
  };
  if (!deno.Deno?.resolveDns) throw new ProviderRequestError('dns_preflight');
  return deno.Deno.resolveDns(hostname, recordType);
};

function openAiEndpoint(baseUrl: URL): string {
  const endpoint = new URL(baseUrl.toString());
  endpoint.pathname = `${endpoint.pathname.replace(/\/?v1\/?$/, '').replace(/\/$/, '')}/v1/chat/completions`;
  return endpoint.toString();
}

function providerResponseContent(provider: string, payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const response = payload as {
    content?: Array<{ text?: unknown }>;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = provider === 'anthropic'
    ? response.content?.[0]?.text
    : response.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : undefined;
}

/** Keeps untrusted content in a data-only, independently delimited prompt section. */
export function formatScoringUserContent(questionText: string, answerText: string): string {
  return `QUESTION_JSON:\n${JSON.stringify(questionText)}\n\nSTUDENT_ANSWER_JSON:\n${JSON.stringify(answerText)}`;
}

/** Parses the unchanged legacy score shape without coercing provider-controlled values. */
export function parseLegacyScoreResponse(raw: unknown): LegacyScoreResponse {
  if (typeof raw !== 'string') throw new Error('AI_PROVIDER_RESPONSE_INVALID');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AI_PROVIDER_RESPONSE_INVALID');
  }
  const keys = ['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness', 'overall_pct', 'ai_feedback', 'improvement_tip'];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('AI_PROVIDER_RESPONSE_INVALID');
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) {
    throw new Error('AI_PROVIDER_RESPONSE_INVALID');
  }
  const dimensions = ['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness'] as const;
  if (dimensions.some((key) => !Number.isInteger(record[key]) || (record[key] as number) < 1 || (record[key] as number) > 5)) {
    throw new Error('AI_PROVIDER_RESPONSE_INVALID');
  }
  if (!Number.isInteger(record.overall_pct) || (record.overall_pct as number) < 0 || (record.overall_pct as number) > 100) {
    throw new Error('AI_PROVIDER_RESPONSE_INVALID');
  }
  const computedOverall = Math.round(dimensions.reduce((sum, key) => sum + Number(record[key]), 0) / dimensions.length * 20);
  if (record.overall_pct !== computedOverall) throw new Error('AI_PROVIDER_RESPONSE_INVALID');
  if (
    typeof record.ai_feedback !== 'string'
    || !record.ai_feedback
    || record.ai_feedback !== record.ai_feedback.trim()
    || record.ai_feedback.length > MAX_AI_FEEDBACK_LENGTH
    || typeof record.improvement_tip !== 'string'
    || !record.improvement_tip
    || record.improvement_tip !== record.improvement_tip.trim()
    || record.improvement_tip.length > MAX_IMPROVEMENT_TIP_LENGTH
  ) {
    throw new Error('AI_PROVIDER_RESPONSE_INVALID');
  }
  return {
    structure: record.structure as number,
    ethics: record.ethics as number,
    communication: record.communication as number,
    reflection: record.reflection as number,
    nhs_awareness: record.nhs_awareness as number,
    overall_pct: computedOverall,
    ai_feedback: record.ai_feedback,
    improvement_tip: record.improvement_tip,
  };
}

export async function callConfiguredProvider(
  config: AiConfig,
  request: AiProviderRequest,
): Promise<unknown> {
  let provider: 'anthropic' | 'openai';
  let customOpenAiCompatible = false;
  switch (config.provider) {
    case 'anthropic':
      provider = 'anthropic';
      break;
    case 'openai':
      provider = 'openai';
      break;
    case 'openai_compatible':
      provider = 'openai';
      customOpenAiCompatible = true;
      break;
    default:
      throw new ProviderRequestError('configuration');
  }
  let url = provider === 'anthropic'
    ? 'https://api.anthropic.com/v1/messages'
    : 'https://api.openai.com/v1/chat/completions';

  if (customOpenAiCompatible) {
    let baseUrl: URL;
    try {
      baseUrl = await assertSafeProviderUrl(config.baseUrl ?? '', providerAllowedHosts(), resolveDenoDns);
      // `fetch` resolves hostnames independently, so revalidate immediately before it.
      await assertSafeProviderUrl(config.baseUrl ?? '', providerAllowedHosts(), resolveDenoDns);
    } catch {
      throw new ProviderRequestError('dns_preflight');
    }
    url = openAiEndpoint(baseUrl);
  }
  const headers: Record<string, string> = provider === 'anthropic'
    ? {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    }
    : {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };
  const body = provider === 'anthropic'
    ? {
      model: config.model,
      max_tokens: request.maxTokens,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userContent }],
    }
    : {
      model: config.model,
      max_tokens: request.maxTokens,
      temperature: 0.3,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userContent },
      ],
    };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new ProviderRequestError('network');
  }
  const providerRequestId = response.headers.get('x-request-id');
  if (!response.ok) {
    throw new ProviderRequestError('http', { status: response.status, providerRequestId });
  }

  try {
    const content = providerResponseContent(provider, await response.json());
    if (content === undefined) throw new TypeError('Provider response is missing content');
    return content;
  } catch {
    throw new ProviderRequestError('response_shape', { providerRequestId });
  }
}
