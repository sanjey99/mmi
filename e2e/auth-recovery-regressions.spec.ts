import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const syntheticBackend = 'https://e2e.supabase.co';
const userId = '77777777-7777-4777-8777-777777777777';
const timestamp = '2026-10-20T00:00:00.000Z';
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'candidate@example.test', email_confirmed_at: timestamp, app_metadata: {}, user_metadata: {}, created_at: timestamp, updated_at: timestamp };
const session = {
  access_token: [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'synthetic-signature'].join('.'),
  refresh_token: 'synthetic-refresh-only', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
};

test.use({ serviceWorkers: 'block' });

async function isolatedAuth(context: BrowserContext, page: Page, baseURL: string, pending = false) {
  const localOrigin = new URL(baseURL).origin;
  expect(new URL(localOrigin).hostname).toBe('127.0.0.1');
  const unexpected: string[] = [];
  const requests: Array<{ path: string; method: string }> = [];
  let lookupUnavailable = pending;
  let logoutFails = false;
  let releaseLogout = () => {};
  let logoutGate = Promise.resolve();
  if (pending) await page.addInitScript(({ savedSession, accountId }) => {
    sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify(savedSession));
    sessionStorage.setItem('interview-station:email-action:v1', JSON.stringify({ mode: 'recovery', userId: accountId }));
  }, { savedSession: session, accountId: userId });
  await context.routeWebSocket('**/*', socket => { unexpected.push('WebSocket'); socket.close(); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === localOrigin) return route.continue();
    if (url.origin !== syntheticBackend) { unexpected.push(url.origin); return route.abort('blockedbyclient'); }
    const method = route.request().method();
    requests.push({ path: url.pathname, method });
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname === '/auth/v1/user' && method === 'GET') return lookupUnavailable ? json({ code: 503, msg: 'PRIVATE_PROVIDER_DETAIL' }, 503) : json(user);
    if (url.pathname === '/auth/v1/logout') { await logoutGate; return logoutFails ? json({ code: 503, msg: 'PRIVATE_PROVIDER_DETAIL' }, 503) : json({}); }
    if (url.pathname === '/auth/v1/token') return json({ code: 400, error_code: 'invalid_credentials', msg: 'PRIVATE_PROVIDER_DETAIL' }, 400);
    if (url.pathname === '/auth/v1/signup') return json({ ...user, email_confirmed_at: null });
    if (url.pathname === '/auth/v1/resend' || url.pathname === '/auth/v1/recover') return json({});
    if (url.pathname === '/rest/v1/profiles') return json({ id: userId, full_name: 'Candidate', avatar_url: null, university_target: 'Oxford', entry_year: 2027, daily_goal: 5, streak_current: 0, streak_longest: 0, streak_last_date: null, onboarding_complete: true, is_admin: false, created_at: timestamp, updated_at: timestamp });
    unexpected.push(url.pathname); return route.abort('blockedbyclient');
  });
  return {
    requests,
    recoverLookup: () => { lookupUnavailable = false; },
    setLogoutFailure: (value: boolean) => { logoutFails = value; },
    holdLogout: () => { logoutGate = new Promise<void>(resolve => { releaseLogout = resolve; }); },
    releaseLogout: () => releaseLogout(),
    assertIsolated: async () => { expect(unexpected).toEqual([]); expect(await page.locator('body').innerText()).not.toContain('PRIVATE_PROVIDER_DETAIL'); },
  };
}

test('a temporary password-action check can retry without discarding its verified marker', async ({ context, page, baseURL }) => {
  const mock = await isolatedAuth(context, page, baseURL!, true);
  await page.goto('/set-password');
  await expect(page.getByText('Password check unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'New password', exact: true })).toHaveCount(0);
  mock.recoverLookup();
  await page.getByRole('button', { name: 'Retry password link check', exact: true }).click();
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).not.toBeNull();
  expect(mock.requests.filter(request => request.path === '/auth/v1/user' && request.method === 'PUT')).toHaveLength(0);
  await mock.assertIsolated();
});

for (const destination of [
  { button: 'Back to sign in', path: '/login' },
  { button: 'Request a new reset link', path: '/forgot-password' },
]) test(`a failed password-action check signs out before ${destination.button.toLowerCase()}`, async ({ context, page, baseURL }) => {
  const mock = await isolatedAuth(context, page, baseURL!, true);
  await page.goto('/set-password');
  await expect(page.getByText('Password check unavailable', { exact: true })).toBeVisible();
  mock.holdLogout();
  await page.getByRole('button', { name: destination.button, exact: true }).click();
  await expect.poll(() => mock.requests.filter(request => request.path === '/auth/v1/logout').length).toBe(1);
  expect(new URL(page.url()).pathname).toBe('/set-password');
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).not.toBeNull();
  mock.releaseLogout();
  await expect.poll(() => new URL(page.url()).pathname).toBe(destination.path);
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).toBeNull();
  expect(mock.requests.filter(request => request.path === '/auth/v1/recover')).toHaveLength(0);
  await mock.assertIsolated();
});

test('a failed password-action cancellation retains the marker and offers a real retry', async ({ context, page, baseURL }) => {
  const mock = await isolatedAuth(context, page, baseURL!, true);
  await page.goto('/set-password');
  await expect(page.getByText('Password check unavailable', { exact: true })).toBeVisible();
  mock.setLogoutFailure(true);
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await expect(page.getByText('We could not sign you out. Please try again.', { exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/set-password');
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).not.toBeNull();
  mock.setLogoutFailure(false);
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/login');
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).toBeNull();
  await mock.assertIsolated();
});

test('Enter on the login password validates the form without sending invalid credentials', async ({ context, page, baseURL }) => {
  const mock = await isolatedAuth(context, page, baseURL!);
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('invalid-address');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password-12');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByText('Enter a valid email', { exact: true })).toBeVisible();
  expect(mock.requests.filter(request => request.path === '/auth/v1/token')).toHaveLength(0);
  await mock.assertIsolated();
});

test('Enter on signup confirmation validates the form without requesting an invalid account', async ({ context, page, baseURL }) => {
  const mock = await isolatedAuth(context, page, baseURL!);
  await page.goto('/signup');
  await page.getByLabel('Email address', { exact: true }).fill('invalid-address');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password-12');
  await page.getByLabel('Confirm password', { exact: true }).fill('synthetic-password-12');
  await page.getByLabel('Confirm password', { exact: true }).press('Enter');
  await expect(page.getByText('Enter a valid email address.', { exact: true })).toBeVisible();
  expect(mock.requests.filter(request => request.path === '/auth/v1/signup')).toHaveLength(0);
  await mock.assertIsolated();
});

test('Enter on the login password uses the normal single-request sign-in path', async ({ context, page, baseURL }) => {
  const mock = await isolatedAuth(context, page, baseURL!);
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('candidate@example.test');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password-12');
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByText('Sign in failed', { exact: true })).toBeVisible();
  expect(mock.requests.filter(request => request.path === '/auth/v1/token')).toHaveLength(1);
  await mock.assertIsolated();
});

test('Enter on signup confirmation requests one confirmation and preserves its cooldown', async ({ context, page, baseURL }) => {
  const mock = await isolatedAuth(context, page, baseURL!);
  await page.goto('/signup');
  await page.getByLabel('Email address', { exact: true }).fill('candidate@example.test');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password-12');
  await page.getByLabel('Confirm password', { exact: true }).fill('synthetic-password-12');
  await page.getByLabel('Confirm password', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();
  expect(mock.requests.filter(request => request.path === '/auth/v1/signup')).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Send another confirmation', exact: true })).toBeDisabled();
  expect(mock.requests.filter(request => request.path === '/auth/v1/resend')).toHaveLength(0);
  await mock.assertIsolated();
});

test('Enter on the resend email uses the explicit confirmation request path', async ({ context, page, baseURL }) => {
  const mock = await isolatedAuth(context, page, baseURL!);
  await page.goto('/signup');
  await page.getByRole('button', { name: 'Already waiting for a confirmation?', exact: true }).click();
  await page.getByLabel('Email address', { exact: true }).fill('candidate@example.test');
  await page.getByLabel('Email address', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();
  expect(mock.requests.filter(request => request.path === '/auth/v1/signup')).toHaveLength(0);
  expect(mock.requests.filter(request => request.path === '/auth/v1/resend')).toHaveLength(1);
  await mock.assertIsolated();
});

test('short login screens retain the start of the page and allow scrolling to every account action', async ({ context, page, baseURL }) => {
  const mock = await isolatedAuth(context, page, baseURL!);
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto('/login');
  const branding = page.getByText('00', { exact: true });
  await expect(branding).toBeVisible();
  await expect.poll(async () => (await branding.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
  const privacy = page.getByRole('link', { name: 'Privacy', exact: true });
  await privacy.scrollIntoViewIfNeeded();
  await expect(privacy).toBeInViewport();
  await page.getByRole('button', { name: 'Enter circuit', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Enter circuit', exact: true })).toBeInViewport();
  await branding.scrollIntoViewIfNeeded();
  await expect(branding).toBeInViewport();
  await mock.assertIsolated();
});
