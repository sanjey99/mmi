import { defineConfig } from '@playwright/test';
import base from './playwright.config';

if (process.env.EXPO_PUBLIC_SUPABASE_URL !== 'https://e2e.supabase.co'
  || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'synthetic-publishable-key'
  || process.env.EXPO_PUBLIC_AI_MODEL_PROFILE !== 'default'
  || (process.env.EXPO_PUBLIC_AUTH_CAPTCHA_ENABLED === 'true' && process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY !== '1x00000000000000000000AA')) {
  throw new Error('CAPTCHA browser checks require synthetic Supabase configuration and the public dummy site key.');
}

export default defineConfig({
  ...base,
  testDir: './e2e-captcha',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  globalTimeout: 3 * 60_000,
  reporter: 'line',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4173', trace: 'off', screenshot: 'off', video: 'off' },
  webServer: { command: 'node scripts/serve-ci-build.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 30_000 },
});
