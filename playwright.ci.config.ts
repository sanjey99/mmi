import { defineConfig } from '@playwright/test';
import base from './playwright.config';

if (process.env.EXPO_PUBLIC_SUPABASE_URL !== 'https://e2e.supabase.co'
  || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'synthetic-publishable-key'
  || process.env.EXPO_PUBLIC_AI_MODEL_PROFILE !== 'default') {
  throw new Error('CI browser checks require the synthetic Supabase configuration and default model profile.');
}

export default defineConfig({
  ...base,
  forbidOnly: true,
  retries: 1,
  workers: 2,
  globalTimeout: 10 * 60 * 1_000,
  reporter: 'line',
  use: {
    ...base.use,
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node scripts/serve-ci-build.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
