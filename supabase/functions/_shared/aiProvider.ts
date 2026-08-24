// @ts-ignore Deno Edge module resolution requires the explicit TypeScript extension.
import { assertSafeProviderUrl, type ResolveDns } from './providerUrl.ts';

export const AI_PROVIDER_TIMEOUT_MS = 60_000;
export const MMI_SCORING_CLAIM_LEASE_MS = 180_000;
const BUILT_IN_PROVIDER_HOSTS = Object.freeze(['api.anthropic.com', 'api.openai.com']);

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

class ProviderRequestError extends Error {
  constructor() {
    super('AI_PROVIDER_REQUEST_FAILED');
    this.name = 'ProviderRequestError';
  }
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
  if (!deno.Deno?.resolveDns) throw new ProviderRequestError();
  return deno.Deno.resolveDns(hostname, recordType);
};

function openAiEndpoint(baseUrl: URL): string {
  const endpoint = new URL(baseUrl.toString());
  endpoint.pathname = `${endpoint.pathname.replace(/\/?v1\/?$/, '').replace(/\/$/, '')}/v1/chat/completions`;
  return endpoint.toString();
}

function providerResponseContent(provider: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') throw new ProviderRequestError();
  const response = payload as {
    content?: Array<{ text?: unknown }>;
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = provider === 'anthropic'
    ? response.content?.[0]?.text
    : response.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new ProviderRequestError();
  return content;
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
  if (typeof record.ai_feedback !== 'string' || typeof record.improvement_tip !== 'string') {
    throw new Error('AI_PROVIDER_RESPONSE_INVALID');
  }
  return {
    structure: record.structure as number,
    ethics: record.ethics as number,
    communication: record.communication as number,
    reflection: record.reflection as number,
    nhs_awareness: record.nhs_awareness as number,
    overall_pct: record.overall_pct as number,
    ai_feedback: record.ai_feedback,
    improvement_tip: record.improvement_tip,
  };
}

export async function callConfiguredProvider(
  config: AiConfig,
  request: AiProviderRequest,
): Promise<unknown> {
  const provider = config.provider === 'anthropic' ? 'anthropic' : 'openai';
  const configuredBaseUrl = provider === 'anthropic'
    ? 'https://api.anthropic.com'
    : config.baseUrl ?? 'https://api.openai.com';

  let baseUrl: URL;
  try {
    baseUrl = await assertSafeProviderUrl(configuredBaseUrl, providerAllowedHosts(), resolveDenoDns);
  } catch {
    throw new ProviderRequestError();
  }

  const url = provider === 'anthropic'
    ? 'https://api.anthropic.com/v1/messages'
    : openAiEndpoint(baseUrl);
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
    throw new ProviderRequestError();
  }
  if (!response.ok) throw new ProviderRequestError();

  try {
    return providerResponseContent(provider, await response.json());
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    throw new ProviderRequestError();
  }
}
