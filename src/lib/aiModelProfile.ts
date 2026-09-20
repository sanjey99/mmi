export type AiModelProfile = 'default' | 'gpt-5.5';

export const deployedAiModelProfile: AiModelProfile =
  process.env.EXPO_PUBLIC_AI_MODEL_PROFILE === 'gpt-5.5'
    ? 'gpt-5.5'
    : 'default';
