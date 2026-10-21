import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { getRules } from 'axe-core';

// axe covers the supported automated A/AA checks, not a conformance audit.
// Keyboard, screen reader, speech input, and real CAPTCHA checks remain manual.
const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
const routes = [
  { path: '/login', readyText: 'Enter the circuit', inputs: 2 },
  { path: '/signup', readyText: 'Create your account', inputs: 3 },
  { path: '/forgot-password', readyText: 'Reset your password', inputs: 1 },
  { path: '/terms', readyText: 'Terms of use', inputs: 0 },
  { path: '/privacy', readyText: 'Privacy notice', inputs: 0 },
] as const;

test.use({ serviceWorkers: 'block' });

for (const viewport of viewports) {
  for (const route of routes) {
    test(`WCAG A/AA: ${route.path} on ${viewport.name}`, async ({ context, page, baseURL }) => {
      const origin = new URL(baseURL!).origin;
      expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(origin).hostname);
      const externalRequests: string[] = [];
      await context.route('**/*', async requestRoute => {
        const url = new URL(requestRoute.request().url());
        if (url.origin === origin) return requestRoute.continue();
        externalRequests.push(`${requestRoute.request().method()} ${url.origin}${url.pathname}`);
        return requestRoute.abort('blockedbyclient');
      });
      await context.routeWebSocket('**/*', socket => {
        const url = new URL(socket.url());
        externalRequests.push(`WebSocket ${url.origin}${url.pathname}`);
        socket.close();
      });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(route.path);
      await expect(page.getByText(route.readyText, { exact: true })).toBeVisible();
      await expect(page.locator('input')).toHaveCount(route.inputs);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      expect(new URL(page.url()).pathname).toBe(route.path);

      if (route.path === '/terms' || route.path === '/privacy') {
        const documentRegion = page.getByRole('region', { name: route.readyText, exact: true });
        await page.getByRole('button', { name: 'Back', exact: true }).focus();
        await page.keyboard.press('Tab');
        await expect(documentRegion).toBeFocused();
        await page.keyboard.press('PageDown');
        await expect.poll(() => documentRegion.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      }

      // Fail if a future package/tag change accidentally produces an empty scan.
      for (const tag of wcagTags) expect(getRules([tag]).length, `Rules for ${tag}`).toBeGreaterThan(0);
      const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
      expect(results.passes.length, 'The rendered page must actually be scanned').toBeGreaterThan(0);
      expect(externalRequests, 'Signed-out scans must never contact an external service').toEqual([]);
      expect(results.violations.map(violation => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.map(node => ({ target: node.target, failure: node.failureSummary })),
      }))).toEqual([]);
    });
  }
}
