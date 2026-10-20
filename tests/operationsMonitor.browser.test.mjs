import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { installReadOnlyBrowserRoutes } from '../scripts/check-operations.mjs';

test('the public probe blocks redirects, popup writes, local writes, and WebSockets before contact', { timeout: 30_000 }, async () => {
  const allowedRequests = [];
  const forbiddenRequests = [];
  let upgrades = 0;
  const forbidden = createServer((request, response) => {
    forbiddenRequests.push(`${request.method} ${request.url}`);
    response.end('forbidden origin was contacted');
  });
  forbidden.on('upgrade', (_request, socket) => { upgrades += 1; socket.destroy(); });
  const listen = (server) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const close = async (server) => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  let browser;
  let allowed;
  try {
    await listen(forbidden);
    const forbiddenOrigin = `http://127.0.0.1:${forbidden.address().port}`;
    allowed = createServer((request, response) => {
      allowedRequests.push(`${request.method} ${request.url}`);
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: `${forbiddenOrigin}/outside-guard` });
        response.end();
      } else {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><title>Local read-only probe proof</title><p>Real local response</p>');
      }
    });
    await listen(allowed);
    const allowedOrigin = `http://127.0.0.1:${allowed.address().port}`;
    browser = await chromium.launch({ headless: true, timeout: 15_000 });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await installReadOnlyBrowserRoutes(context, allowedOrigin);
    const page = await context.newPage();
    await page.goto(`${allowedOrigin}/login`);
    assert.equal(await page.locator('p').innerText(), 'Real local response');

    assert.equal(await page.evaluate(async () => {
      try { await fetch('/local-write', { method: 'POST', body: 'synthetic' }); return 'sent'; }
      catch { return 'blocked'; }
    }), 'blocked');

    const failedPopupRequest = context.waitForEvent('requestfailed', {
      predicate: (request) => request.method() === 'POST' && request.url() === `${forbiddenOrigin}/popup-write`,
      timeout: 5_000,
    });
    await page.evaluate((destination) => {
      const form = document.createElement('form');
      form.method = 'POST'; form.target = 'new-probe-page'; form.action = destination;
      document.body.append(form); form.submit();
    }, `${forbiddenOrigin}/popup-write`);
    await failedPopupRequest;

    await page.evaluate((destination) => new Promise((resolve) => {
      const socket = new WebSocket(destination);
      socket.onclose = () => resolve('closed');
      socket.onerror = () => resolve('closed');
      setTimeout(() => resolve('closed'), 2_000);
    }), `${forbiddenOrigin.replace('http:', 'ws:')}/socket-write`);

    await assert.rejects(page.goto(`${allowedOrigin}/redirect`, { timeout: 5_000 }));
    assert.deepEqual(allowedRequests, ['GET /login', 'GET /redirect']);
    assert.deepEqual(forbiddenRequests, []);
    assert.equal(upgrades, 0);
  } finally {
    await browser?.close();
    if (allowed?.listening) await close(allowed);
    if (forbidden.listening) await close(forbidden);
  }
});
