export type AIConfigValues = Record<string, string | null | undefined>;

export type AdminAIConfigResponse = {
  provider: string;
  model: string;
  baseUrl: string;
  isConfigured: boolean;
};

export type KeyReplacementValidation =
  | { valid: true }
  | { valid: false; error: string };

export type KeyReplacementAuthorization =
  | { allowed: true }
  | { allowed: false; status: 400 | 403; error: string };

const MAX_API_KEY_LENGTH = 1000;

/**
 * Shapes configuration for a client response. The key is deliberately not
 * included: admins can replace the secret but never retrieve its value.
 */
export function createAdminAiConfigResponse(config: AIConfigValues): AdminAIConfigResponse {
  return {
    provider: config.ai_provider ?? 'anthropic',
    model: config.ai_model ?? 'claude-3-5-haiku-20241022',
    baseUrl: config.ai_base_url ?? '',
    isConfigured: Boolean(config.ai_api_key?.trim()),
  };
}

export function validateKeyReplacement(body: unknown): KeyReplacementValidation {
  if (!body || typeof body !== 'object' || !('apiKey' in body)) {
    return { valid: false, error: 'API key is required' };
  }

  const apiKey = (body as { apiKey?: unknown }).apiKey;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return { valid: false, error: 'API key is required' };
  }
  if (apiKey.length > MAX_API_KEY_LENGTH) {
    return { valid: false, error: 'API key is too long' };
  }

  return { valid: true };
}

export function authorizeKeyReplacement(
  body: unknown,
  isAdmin: boolean,
): KeyReplacementAuthorization {
  if (!isAdmin) {
    return {
      allowed: false,
      status: 403,
      error: 'Administrator access is required',
    };
  }

  const validation = validateKeyReplacement(body);
  return validation.valid
    ? { allowed: true }
    : { allowed: false, status: 400, error: validation.error };
}
