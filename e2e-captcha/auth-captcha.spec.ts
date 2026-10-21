import { expect, test, type Page } from '@playwright/test';

const enabled = process.env.EXPO_PUBLIC_AUTH_CAPTCHA_ENABLED === 'true';
const providerScript = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const syntheticWidget = `(() => {
  const harness = window.__captchaHarness = { widgets: {}, renders: 0, removes: 0 };
  window.turnstile = {
    render(container, options) {
      const id = 'widget-' + (++harness.renders);
      const button = document.createElement('button');
      button.textContent = 'Complete synthetic security check';
      button.onclick = () => { button.disabled = true; harness.lastToken = 'synthetic-captcha-' + id; options.callback(harness.lastToken); };
      container.replaceChildren(button);
      harness.widgets[id] = { options, container, removed: false };
      return id;
    },
    remove(id) { const widget = harness.widgets[id]; if (widget) { widget.removed = true; widget.container.replaceChildren(); harness.removes++; } },
    reset(id) { const widget = harness.widgets[id]; if (widget) widget.options['expired-callback'](); }
  };
})();`;
type WidgetHarness = { widgets: Record<string, { removed: boolean; options: { callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void } }>; removes: number; lastToken: string };
async function widgetEvent(page: Page, event: 'expired-callback' | 'error-callback') {
  await page.evaluate(name => {
    const harness = (window as unknown as { __captchaHarness: WidgetHarness }).__captchaHarness;
    const widget = Object.values(harness.widgets).filter(value => !value.removed).at(-1);
    widget?.options[name]();
  }, event);
}
async function solve(page: Page) {
  await page.getByRole('button', { name: 'Complete synthetic security check', exact: true }).click();
  await expect(page.getByText('Security check ready.', { exact: true })).toBeVisible();
  return page.evaluate(() => (window as unknown as { __captchaHarness: WidgetHarness }).__captchaHarness.lastToken);
}

async function installMocks(page: Page, options: Readonly<{ scriptFailsOnce?: boolean; rejectPath?: string; deferLogin?: boolean }> = {}) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const unexpected: string[] = [];
  let scriptRequests = 0;
  let releaseLogin = () => {};
  const loginGate = options.deferLogin ? new Promise<void>(resolve => { releaseLogin = resolve; }) : Promise.resolve();
  const now = '2026-10-21T00:00:00Z';
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'candidate@example.test', email_confirmed_at: now, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now, updated_at: now };
  const session = { access_token: 'synthetic-captcha-access', refresh_token: 'synthetic-captcha-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user };
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    if (url.href === providerScript) {
      scriptRequests += 1;
      if (options.scriptFailsOnce && scriptRequests === 1) return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: syntheticWidget });
    }
    if (url.origin !== 'https://e2e.supabase.co') { unexpected.push(url.origin); return route.abort('blockedbyclient'); }
    let body: Record<string, unknown> = {}; try { body = request.postDataJSON(); } catch { /* GET has no body. */ }
    requests.push({ path: url.pathname, body });
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === options.rejectPath) return json({ code: 400, error_code: 'captcha_failed', msg: 'PRIVATE_PROVIDER_DETAIL' }, 400);
    if (url.pathname === '/auth/v1/token') { await loginGate; return json(session); }
    if (url.pathname === '/auth/v1/signup') return json({ ...user, email_confirmed_at: null });
    if (url.pathname === '/auth/v1/recover' || url.pathname === '/auth/v1/resend') return json({});
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/rest/v1/profiles') return json({ id: user.id, full_name: '', avatar_url: null, university_target: 'Oxford', entry_year: 2027, daily_goal: 5, streak_current: 0, streak_longest: 0, streak_last_date: null, onboarding_complete: true, is_admin: false, created_at: now, updated_at: now });
    if (url.pathname === '/rest/v1/rpc/get_candidate_mmi_activity_summary') return json({ completedToday: 0, completedTotal: 0, streakCurrent: 0, streakLongest: 0, latestCompletedAt: null });
    unexpected.push(url.pathname); return route.abort('blockedbyclient');
  });
  return { requests, releaseLogin, scriptRequests: () => scriptRequests, assertIsolated: () => expect(unexpected).toEqual([]) };
}

test('disabled CAPTCHA loads no third party and reports a server CAPTCHA rejection honestly', async ({ page }) => {
  test.skip(enabled, 'Checks the default OFF export.');
  const mock = await installMocks(page, { rejectPath: '/auth/v1/recover' });
  for (const route of ['/login', '/signup', '/forgot-password']) {
    await page.goto(route);
    await expect(page.getByRole('group', { name: 'Security check', exact: true })).toHaveCount(0);
  }
  await page.getByLabel('Email address', { exact: true }).fill('candidate@example.test');
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(page.getByText('The security check failed or expired. Please complete a new check and try again.', { exact: true })).toBeVisible();
  await expect(page.getByText('Reset request received', { exact: true })).toHaveCount(0);
  expect(mock.scriptRequests()).toBe(0);
  expect(mock.requests.find(request => request.path === '/auth/v1/recover')?.body).not.toHaveProperty('gotrue_meta_security.captcha_token');
  mock.assertIsolated();
});

test.describe('configured CAPTCHA with a wholly synthetic provider', () => {
  test.skip(!enabled, 'Checks only the configured dummy-key export.');

  test('login blocks before verification, forwards one token through the store, and rejects duplicate submission', async ({ page }) => {
    const mock = await installMocks(page, { deferLogin: true });
    await page.goto('/login');
    await page.getByLabel('Email address', { exact: true }).fill('candidate@example.test');
    await page.getByLabel('Password', { exact: true }).fill('synthetic-password-12');
    await expect(page.getByRole('button', { name: 'Enter circuit', exact: true })).toBeDisabled();
    expect(mock.requests).toHaveLength(0);
    const token = await solve(page);
    await page.getByRole('button', { name: 'Enter circuit', exact: true }).dblclick();
    await expect.poll(() => mock.requests.filter(request => request.path === '/auth/v1/token').length).toBe(1);
    expect(mock.requests[0].body).toHaveProperty('gotrue_meta_security.captcha_token', token);
    mock.releaseLogin();
    await expect(page.getByText('Ready, candidate.', { exact: true })).toBeVisible();
    mock.assertIsolated();
  });

  test('expiry clears a verified token and retry renders a new challenge', async ({ page }) => {
    const mock = await installMocks(page); await page.goto('/forgot-password');
    await page.getByLabel('Email address', { exact: true }).fill('candidate@example.test');
    const oldToken = await solve(page); await widgetEvent(page, 'expired-callback');
    await expect(page.getByText('The security check expired. Please try it again.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send reset link', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Retry security check', exact: true }).click(); const token = await solve(page);
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await expect(page.getByText('Reset request received', { exact: true })).toBeVisible();
    expect(token).not.toBe(oldToken);
    expect(mock.requests[0].body).toHaveProperty('gotrue_meta_security.captcha_token', token);
    mock.assertIsolated();
  });

  test('provider load failure is unavailable and manually retryable without an auth request', async ({ page }) => {
    const mock = await installMocks(page, { scriptFailsOnce: true }); await page.goto('/login');
    await expect(page.getByText('The security check is unavailable right now. Please try again later.', { exact: true })).toBeVisible();
    expect(mock.requests).toHaveLength(0);
    await page.getByRole('button', { name: 'Retry security check', exact: true }).click(); await solve(page);
    expect(mock.scriptRequests()).toBe(2);
    mock.assertIsolated();
  });

  test('signup and confirmation resend use different single-use tokens without replacing the app session', async ({ page }) => {
    const mock = await installMocks(page); await page.clock.install(); await page.goto('/signup');
    await page.getByLabel('Email address', { exact: true }).fill('candidate@example.test');
    await page.getByLabel('Password', { exact: true }).fill('synthetic-password-12');
    await page.getByLabel('Confirm password', { exact: true }).fill('synthetic-password-12'); const signupToken = await solve(page);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();
    expect(mock.requests[0].body).toHaveProperty('gotrue_meta_security.captcha_token', signupToken);
    expect(await page.evaluate(() => sessionStorage.getItem('sb-e2e-auth-token'))).toBeNull();
    await page.clock.fastForward(61_000);
    // A mode-change render can share the controller's generation. Callbacks
    // from every removed widget must also be rejected by its render instance.
    await page.evaluate(() => {
      const harness = (window as unknown as { __captchaHarness: WidgetHarness }).__captchaHarness;
      Object.values(harness.widgets).filter(widget => widget.removed).forEach(widget => widget.options.callback('STALE_RENDER_TOKEN'));
    });
    await expect(page.getByRole('button', { name: 'Send another confirmation', exact: true })).toBeDisabled();
    const resendToken = await solve(page); expect(resendToken).not.toBe(signupToken);
    await page.getByRole('button', { name: 'Send another confirmation', exact: true }).click();
    await expect.poll(() => mock.requests.filter(request => request.path === '/auth/v1/resend').length).toBe(1);
    expect(mock.requests.find(request => request.path === '/auth/v1/resend')?.body).toHaveProperty('gotrue_meta_security.captcha_token', resendToken);
    mock.assertIsolated();
  });

  for (const flow of ['signup', 'recovery'] as const) test(`${flow} CAPTCHA rejection never claims email delivery or renders provider details`, async ({ page }) => {
    const mock = await installMocks(page, { rejectPath: flow === 'signup' ? '/auth/v1/signup' : '/auth/v1/recover' });
    await page.goto(flow === 'signup' ? '/signup' : '/forgot-password');
    await page.getByLabel('Email address', { exact: true }).fill('candidate@example.test');
    if (flow === 'signup') {
      await page.getByLabel('Password', { exact: true }).fill('synthetic-password-12');
      await page.getByLabel('Confirm password', { exact: true }).fill('synthetic-password-12');
    }
    await solve(page);
    await page.getByRole('button', { name: flow === 'signup' ? 'Create account' : 'Send reset link', exact: true }).click();
    await expect(page.getByText('The security check failed or expired. Please complete a new check and try again.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('PRIVATE_PROVIDER_DETAIL');
    await expect(page.getByRole('button', { name: 'Complete synthetic security check', exact: true })).toBeEnabled();
    mock.assertIsolated();
  });

  test('blur removes the old widget and late callbacks cannot verify another form', async ({ page }) => {
    const mock = await installMocks(page); await page.goto('/login'); await solve(page);
    await page.getByRole('link', { name: 'Create an account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const harness = (window as unknown as { __captchaHarness: WidgetHarness }).__captchaHarness;
      Object.values(harness.widgets).find(value => value.removed)?.options.callback('LATE_SYNTHETIC_TOKEN');
    });
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeDisabled();
    expect(mock.requests).toHaveLength(0); expect(mock.scriptRequests()).toBe(1);
    mock.assertIsolated();
  });
});
