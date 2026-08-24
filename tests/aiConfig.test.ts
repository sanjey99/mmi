import { describe, expect, it } from 'vitest';
import {
  authorizeKeyReplacement,
  createAdminAiConfigResponse,
  validateKeyReplacement,
} from '../supabase/functions/_shared/aiConfig';

const validReplacement = ['unit', 'test', 'credential'].join('-');

describe('createAdminAiConfigResponse', () => {
  it('omits the API key while exposing whether a key is configured', () => {
    expect(createAdminAiConfigResponse({
      ai_provider: 'openai',
      ai_model: 'gpt-4o-mini',
      ai_base_url: 'https://api.openai.com',
      ai_api_key: 'configured-test-key',
    })).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com',
      isConfigured: true,
    });
  });
});

describe('validateKeyReplacement', () => {
  it('rejects missing, blank, and oversized key replacements', () => {
    expect(validateKeyReplacement({})).toEqual({ valid: false, error: 'API key is required' });
    expect(validateKeyReplacement({ apiKey: '   ' })).toEqual({ valid: false, error: 'API key is required' });
    expect(validateKeyReplacement({ apiKey: 'x'.repeat(1001) })).toEqual({ valid: false, error: 'API key is too long' });
  });

  it('accepts a trimmed key without returning the secret', () => {
    expect(validateKeyReplacement({ apiKey: `  ${validReplacement}  ` })).toEqual({ valid: true });
  });
});

describe('authorizeKeyReplacement', () => {
  it('rejects a non-admin before accepting a replacement key', () => {
    expect(authorizeKeyReplacement({ apiKey: validReplacement }, false)).toEqual({
      allowed: false,
      status: 403,
      error: 'Administrator access is required',
    });
  });

  it('rejects malformed values and allows a valid administrator request', () => {
    expect(authorizeKeyReplacement({ apiKey: '' }, true)).toEqual({
      allowed: false,
      status: 400,
      error: 'API key is required',
    });
    expect(authorizeKeyReplacement({ apiKey: validReplacement }, true)).toEqual({ allowed: true });
  });
});
