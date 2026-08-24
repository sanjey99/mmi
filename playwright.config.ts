import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'EXPO_PUBLIC_SUPABASE_URL=https://e2e.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=synthetic-publishable-key npx expo start --web --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
});
