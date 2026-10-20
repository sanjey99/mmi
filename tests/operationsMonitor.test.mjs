import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBackendHealth, runOperationsMonitor, validateMonitorConfig } from '../scripts/check-operations.mjs';

const url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/operations-health';
const token = 'a'.repeat(64);
const environment = { MMI_HEALTH_URL: url, MMI_MONITOR_TOKEN: token };
const healthy = { ok: true, checks: { database: 'ok', retention: 'ok', scoring: 'ok', runtime: 'ok' } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('only the exact Supabase health endpoint can receive the credential', async () => {
  for (const healthUrl of [
    url.replace('https:', 'http:'), `${url}?token=private`, `${url}#private`,
    url.replace('https://', 'https://user:password@'), url.replace('.supabase.co', '.supabase.co.evil.test'),
    url.replace('/operations-health', '/other-function'), url.replace('abcdefghijklmnopqrst', 'short'),
    url.replace('abcdefghijklmnopqrst', 'ABCDEFGHIJKLMNOPQRST'), `${url}/`,
    url.replace('/functions/', ':443/functions/'), `${url}\n`,
  ]) {
    let called = false;
    assert.throws(() => validateMonitorConfig({ ...environment, MMI_HEALTH_URL: healthUrl }));
    assert.deepEqual(await checkBackendHealth({ healthUrl, token }, async () => { called = true; }), ['MONITOR_CONFIGURATION_INVALID']);
    assert.equal(called, false);
  }
});

test('the read-only health request has a timeout, rejects redirects, and sends no body', async () => {
  assert.deepEqual(await checkBackendHealth({ healthUrl: url, token }, async (target, options) => {
    assert.equal(target, url);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return json(healthy);
  }), []);
});

test('empty, malformed, or padded credentials fail before any request', async () => {
  for (const invalid of ['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), `${token}\n`, ` ${token}`]) {
    let called = false;
    assert.deepEqual(await checkBackendHealth({ healthUrl: url, token: invalid }, async () => { called = true; }), ['MONITOR_CONFIGURATION_INVALID']);
    assert.equal(called, false);
  }
});

test('a valid 503 identifies individual failing checks using only fixed diagnostic codes', async () => {
  assert.deepEqual(await checkBackendHealth({ healthUrl: url, token }, async () => json({
    ok: false, checks: { ...healthy.checks, retention: 'failing', scoring: 'failing' },
  }, 503)), ['HEALTH_RETENTION_FAILING', 'HEALTH_SCORING_FAILING']);
});

test('malformed, contradictory, unexpected, and oversized responses cannot report healthy', async () => {
  for (const body of [null, {}, { ...healthy, token }, { ...healthy, ok: false },
    { ...healthy, checks: { ...healthy.checks, runtime: 'unknown' } },
    { ...healthy, checks: { ...healthy.checks, responseText: 'private candidate content' } }]) {
    assert.deepEqual(await checkBackendHealth({ healthUrl: url, token }, async () => json(body)), ['HEALTH_CONTRACT_INVALID']);
  }
  assert.deepEqual(await checkBackendHealth({ healthUrl: url, token }, async () => new Response('x'.repeat(4_097))), ['HEALTH_CONTRACT_INVALID']);
  assert.deepEqual(await checkBackendHealth({ healthUrl: url, token }, async () => new Response('{invalid JSON', { status: 503 })), ['HEALTH_CONTRACT_INVALID']);
  assert.deepEqual(await checkBackendHealth({ healthUrl: url, token }, async () => json(healthy, 503)), ['HEALTH_CONTRACT_INVALID']);
});

test('an unauthorized response is rejected without reading or logging its body', async () => {
  const output = [];
  let bodyRead = false;
  const status = await runOperationsMonitor({ environment, publicProbe: async () => [],
    fetchImplementation: async () => ({ status: 401, get body() {
      bodyRead = true;
      throw new Error(`private provider response ${token}`);
    } }), write: (line) => output.push(line),
  });
  assert.equal(status, 1);
  assert.equal(bodyRead, false);
  assert.deepEqual(output, ['HEALTH_HTTP_FAILED']);
});

test('configuration failure makes no backend or browser request and does not echo the secret', async () => {
  const output = [];
  let called = false;
  const status = await runOperationsMonitor({
    environment: { ...environment, MMI_HEALTH_URL: `https://evil.test/?secret=${token}` },
    fetchImplementation: async () => { called = true; },
    publicProbe: async () => { called = true; }, write: (line) => output.push(line),
  });
  assert.equal(status, 1);
  assert.equal(called, false);
  assert.deepEqual(output, ['MONITOR_CONFIGURATION_INVALID']);
});

test('network and browser errors containing private data are reduced to static failure codes', async () => {
  const output = [];
  const status = await runOperationsMonitor({ environment,
    fetchImplementation: async () => { throw new Error(`private response ${token} ${url}`); },
    publicProbe: async () => { throw new Error('private browser content'); },
    write: (line) => output.push(line),
  });
  assert.equal(status, 1);
  assert.deepEqual(output, ['HEALTH_REQUEST_FAILED', 'PUBLIC_LOGIN_UI_FAILED']);
});

test('a successful backend and public UI probe report a single safe success code', async () => {
  const output = [];
  assert.equal(await runOperationsMonitor({ environment, fetchImplementation: async () => json(healthy),
    publicProbe: async () => [], write: (line) => output.push(line) }), 0);
  assert.deepEqual(output, ['MONITOR_OK']);
});
