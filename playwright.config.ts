import { defineConfig } from '@playwright/test';

const configuredBaseUrl = process.env.E2E_BASE_URL;
const baseURL = configuredBaseUrl ?? 'http://127.0.0.1:4173';
const localHosts = ['localhost', '127.0.0.1', '::1'];

if (!localHosts.includes(new URL(baseURL).hostname)) {
  throw new Error('E2E_BASE_URL must target localhost; the synthetic suite must never run against production or shared deployments.');
}

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  webServer: configuredBaseUrl ? undefined : {
    command: 'EXPO_PUBLIC_SUPABASE_URL=https://e2e.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=synthetic-publishable-key npx expo start --web --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
});
