import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appOrigin = 'https://mmi-hazel.vercel.app';
const healthKeys = ['database', 'retention', 'scoring', 'runtime'];
const maxResponseBytes = 4_096;

export function validateMonitorConfig(environment) {
  const healthUrl = environment.MMI_HEALTH_URL;
  const token = environment.MMI_MONITOR_TOKEN;
  if (typeof healthUrl !== 'string'
    || healthUrl !== healthUrl.trim()
    || !/^https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/operations-health$/.test(healthUrl)
    || typeof token !== 'string' || token !== token.trim() || !/^[a-f0-9]{64}$/i.test(token)) {
    throw new Error('MONITOR_CONFIGURATION_INVALID');
  }
  return { healthUrl, token };
}

async function readBoundedJson(response) {
  if (!response.body) throw new Error('invalid response');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) throw new Error('invalid response');
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

export async function checkBackendHealth(config, fetchImplementation = fetch) {
  // Revalidate at the credential boundary, even when called outside the CLI.
  let validated;
  try {
    validated = validateMonitorConfig({ MMI_HEALTH_URL: config.healthUrl, MMI_MONITOR_TOKEN: config.token });
  } catch { return ['MONITOR_CONFIGURATION_INVALID']; }
  try {
    const response = await fetchImplementation(validated.healthUrl, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${validated.token}`, Accept: 'application/json' },
    });
    if (response.status !== 200 && response.status !== 503) return ['HEALTH_HTTP_FAILED'];
    let result;
    try { result = await readBoundedJson(response); }
    catch { return ['HEALTH_CONTRACT_INVALID']; }
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || Object.keys(result).sort().join(',') !== 'checks,ok'
      || typeof result.ok !== 'boolean' || !result.checks || typeof result.checks !== 'object'
      || Array.isArray(result.checks)
      || Object.keys(result.checks).sort().join(',') !== [...healthKeys].sort().join(',')
      || healthKeys.some((key) => !['ok', 'failing'].includes(result.checks[key]))) {
      return ['HEALTH_CONTRACT_INVALID'];
    }
    const failing = healthKeys.filter((key) => result.checks[key] === 'failing');
    if (result.ok !== (failing.length === 0) || result.ok !== (response.status === 200)) {
      return ['HEALTH_CONTRACT_INVALID'];
    }
    return failing.map((key) => `HEALTH_${key.toUpperCase()}_FAILING`);
  } catch { return ['HEALTH_REQUEST_FAILED']; }
}

export async function installReadOnlyBrowserRoutes(context, allowedOrigin) {
  await context.routeWebSocket('**/*', (socket) => socket.close());
  await context.route('**/*', async (route) => {
    const request = route.request();
    let response;
    try {
      if (new URL(request.url()).origin !== allowedOrigin || !['GET', 'HEAD'].includes(request.method())) {
        await route.abort();
        return;
      }
      // Browser routes run only for the first request in a redirect chain.
      // Fetch the real response without following any redirect before delivery.
      response = await route.fetch({ maxRedirects: 0, timeout: 10_000 });
      if (response.status() >= 300 && response.status() < 400) await route.abort();
      else await route.fulfill({ response });
    } catch { await route.abort().catch(() => {}); }
    finally { await response?.dispose().catch(() => {}); }
  });
}

export async function checkPublicLogin() {
  let browser;
  try {
    const { chromium } = await import('@playwright/test');
    // Do not pass the backend monitor credential into the browser process.
    const browserEnvironment = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => key !== 'MMI_MONITOR_TOKEN'));
    browser = await chromium.launch({ headless: true, timeout: 15_000, env: browserEnvironment });
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    // Context routes protect popup first requests as well as the original page.
    await installReadOnlyBrowserRoutes(context, appOrigin);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const response = await page.goto(`${appOrigin}/login`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    if (!response || response.status() !== 200) return ['PUBLIC_LOGIN_HTTP_FAILED'];
    await Promise.all([
      page.getByText('INTERVIEW STATION', { exact: true }).waitFor({ state: 'visible' }),
      page.getByLabel('Email address', { exact: true }).waitFor({ state: 'visible' }),
      page.getByLabel('Password', { exact: true }).waitFor({ state: 'visible' }),
      page.getByRole('button', { name: 'Enter circuit', exact: true }).waitFor({ state: 'visible' }),
    ]);
    const location = new URL(page.url());
    if (location.origin !== appOrigin || location.pathname !== '/login' || location.search || location.hash
      || !await page.getByLabel('Email address', { exact: true }).isEditable()
      || !await page.getByLabel('Password', { exact: true }).isEditable()
      || !await page.getByRole('button', { name: 'Enter circuit', exact: true }).isEnabled()) {
      return ['PUBLIC_LOGIN_UI_FAILED'];
    }
    return [];
  } catch { return ['PUBLIC_LOGIN_UI_FAILED']; }
  finally { await browser?.close().catch(() => {}); }
}

export async function runOperationsMonitor({ environment = process.env, fetchImplementation = fetch,
  publicProbe = checkPublicLogin, write = console.log } = {}) {
  let config;
  try { config = validateMonitorConfig(environment); }
  catch { write('MONITOR_CONFIGURATION_INVALID'); return 1; }
  const results = await Promise.all([
    checkBackendHealth(config, fetchImplementation),
    publicProbe().catch(() => ['PUBLIC_LOGIN_UI_FAILED']),
  ]);
  const failures = results.flat();
  for (const code of failures) write(code);
  if (failures.length === 0) write('MONITOR_OK');
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // Provider messages, request URLs, and exception objects never enter CI logs.
  try { process.exitCode = await runOperationsMonitor(); }
  catch { console.log('MONITOR_INTERNAL_FAILED'); process.exitCode = 1; }
}
