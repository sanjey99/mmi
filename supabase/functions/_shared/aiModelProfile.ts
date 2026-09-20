import type { AiConfig } from './aiProvider.ts';

export type AiModelProfile = 'default' | 'gpt-5.5';

export type Gpt55Profile = Readonly<{
  model: string;
  inputRatePerMillion: number;
  cachedInputRatePerMillion: number;
  outputRatePerMillion: number;
}>;

export function parseAiModelProfile(value: unknown): AiModelProfile | null {
  return value === 'default' || value === 'gpt-5.5' ? value : null;
}

export function applyAiModelProfile(
  config: AiConfig,
  modelProfile: AiModelProfile,
  gpt55Profile: Gpt55Profile | null,
): AiConfig | null {
  if (modelProfile === 'default') return config;
  if (config.provider !== 'openai' || gpt55Profile === null) return null;
  return Object.freeze({
    ...config,
    provider: 'openai',
    model: gpt55Profile.model,
    baseUrl: null,
    inputRatePerMillion: gpt55Profile.inputRatePerMillion,
    cachedInputRatePerMillion: gpt55Profile.cachedInputRatePerMillion,
    outputRatePerMillion: gpt55Profile.outputRatePerMillion,
  });
}
