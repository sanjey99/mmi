import { expect, test, type Page } from '@playwright/test';
import { scoringAllowanceFixture } from '../tests/fixtures/scoringAllowance';

const userId = '77777777-7777-4777-8777-777777777777';
const providerDetail = 'PRIVATE_PROVIDER_DIAGNOSTIC';
const tokenHash = 'synthetic-one-time-email-proof';
const refreshToken = 'synthetic-refresh-proof';
const timestamp = '2026-10-20T00:00:00.000Z';
const accessToken = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  'synthetic-signature',
].join('.');
const user = {
  id: userId, aud: 'authenticated', role: 'authenticated', email: 'invited@example.test',
  email_confirmed_at: timestamp, app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {}, created_at: timestamp, updated_at: timestamp,
};
const session = {
  access_token: accessToken, refresh_token: refreshToken,
  expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer', user,
};

type AuthRequest = Readonly<{ path: string; method: string; body: unknown; authorization: string | null }>;

async function installAuthMocks(page: Page, options: Readonly<{
  onboardingComplete?: boolean;
  rejectVerification?: boolean;
  holdVerification?: boolean;
  resetUnknownAccount?: boolean;
  verifiedUserMismatch?: boolean;
  holdUserLookup?: boolean;
  signupUnavailable?: boolean;
  existingSignupAccount?: boolean;
}> = {}) {
  const requests: AuthRequest[] = [];
  const unexpectedHosts: string[] = [];
  const consoleMessages: string[] = [];
  await page.addInitScript(() => {
    const requestLocations: { href: string; requestPath: string }[] = [];
    Object.assign(window, { __authRequestLocations: requestLocations });
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const requestUrl = new URL(address, window.location.origin);
      if (requestUrl.hostname.endsWith('.supabase.co')) requestLocations.push({ href: window.location.href, requestPath: requestUrl.pathname });
      return originalFetch(input, init);
    };
  });
  let releaseVerification = () => {};
  const verificationGate = options.holdVerification ? new Promise<void>((resolve) => { releaseVerification = resolve; }) : Promise.resolve();
  let releaseUserLookup = () => {};
  let userLookupGate = Promise.resolve();
  const holdUserLookup = () => { userLookupGate = new Promise<void>((resolve) => { releaseUserLookup = resolve; }); };
  if (options.holdUserLookup) holdUserLookup();
  let profile = {
    id: userId, full_name: options.onboardingComplete ? 'Invited Tester' : '', avatar_url: null,
    university_target: options.onboardingComplete ? 'Oxford' : null, entry_year: 2027,
    daily_goal: 5, streak_current: 0, streak_longest: 0, streak_last_date: null,
    onboarding_complete: options.onboardingComplete ?? false, is_admin: false,
    created_at: timestamp, updated_at: timestamp,
  };
  page.on('console', (message) => { consoleMessages.push(message.text()); });
  await page.route('https://*.supabase.co/**', async (route) => {
    unexpectedHosts.push(new URL(route.request().url()).hostname);
    await route.abort('blockedbyclient');
  });
  await page.route('https://e2e.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { /* GET requests have no body. */ }
    requests.push({ path: url.pathname, method: request.method(), body, authorization: request.headers().authorization ?? null });
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname === '/auth/v1/verify') {
      await verificationGate;
      return options.rejectVerification
        ? json({ code: 403, error_code: 'otp_expired', msg: providerDetail }, 403)
        : json(session);
    }
    if (url.pathname === '/auth/v1/user') {
      if (request.method() === 'GET') await userLookupGate;
      return json(options.verifiedUserMismatch && request.method() === 'GET'
        ? { ...user, id: '88888888-8888-4888-8888-888888888888' }
        : user);
    }
    if (url.pathname === '/auth/v1/recover') return options.resetUnknownAccount
      ? json({ code: 422, error_code: 'user_not_found', msg: providerDetail }, 422)
      : json({});
    if (url.pathname === '/auth/v1/signup') return options.signupUnavailable
      ? json({ code: 400, error_code: 'signup_disabled', msg: providerDetail }, 400)
      : options.existingSignupAccount
        ? json({ code: 422, error_code: 'user_already_exists', msg: providerDetail }, 422)
        : json({ ...user, email_confirmed_at: null });
    if (url.pathname === '/auth/v1/resend') return json({});
    if (url.pathname === '/auth/v1/logout') return json({});
    if (url.pathname === '/auth/v1/token') return json(session);
    if (url.pathname === '/rest/v1/profiles') {
      if (request.method() === 'PATCH' && body && typeof body === 'object') profile = { ...profile, ...body };
      return json(profile);
    }
    if (url.pathname === '/rest/v1/rpc/get_candidate_mmi_practice_options') return json({ targetUniversity: 'Oxford', targetTag: 'oxford', targetCount: 1, allCount: 1 });
    if (url.pathname === '/rest/v1/rpc/get_candidate_mmi_scoring_allowance') return json(scoringAllowanceFixture());
    if (url.pathname === '/rest/v1/rpc/list_candidate_mmi_history') return json([]);
    return json({ message: `Unhandled synthetic path ${url.pathname}` }, 500);
  });
  return {
    requests,
    releaseVerification,
    holdUserLookup,
    releaseUserLookup: () => releaseUserLookup(),
    verifyCalls: () => requests.filter((request) => request.path === '/auth/v1/verify'),
    passwordUpdates: () => requests.filter((request) => request.path === '/auth/v1/user' && request.method === 'PUT'),
    resetRequests: () => requests.filter((request) => request.path === '/auth/v1/recover'),
    assertIsolated: async () => {
      expect(unexpectedHosts).toEqual([]);
      const requestLocations = await page.evaluate(() => (window as Window & { __authRequestLocations?: { href: string; requestPath: string }[] }).__authRequestLocations ?? []);
      for (const location of requestLocations) {
        const browserUrl = new URL(location.href);
        expect(browserUrl.search, `Credential query before ${location.requestPath}`).toBe('');
        expect(browserUrl.hash, `Credential fragment before ${location.requestPath}`).toBe('');
      }
      const visible = await page.locator('body').innerText();
      for (const secret of [tokenHash, refreshToken, accessToken, providerDetail]) {
        expect(visible).not.toContain(secret);
        expect(consoleMessages.join('\n')).not.toContain(secret);
      }
    },
  };
}

test('an invitation requires a matching password and completed orientation before entering the app', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await installAuthMocks(page, { holdVerification: true });
  await page.goto(`/auth/callback#token_hash=${tokenHash}&type=invite`);
  await expect(page.getByRole('heading', { name: 'Checking your email link', exact: true })).toBeVisible();
  await expect.poll(() => mock.verifyCalls().length).toBe(1);
  expect(new URL(page.url()).pathname).toBe('/auth/callback');
  expect(new URL(page.url()).hash).toBe('');
  mock.releaseVerification();

  await expect(page.getByRole('heading', { name: 'Set your password', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mmi-auth-password-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save password and continue', exact: true }).click();
  await expect(page.getByText('Use at least 12 characters.', { exact: true })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('A unique beta password!');
  await page.getByLabel('Confirm new password', { exact: true }).fill('Different password!');
  await page.getByRole('button', { name: 'Save password and continue', exact: true }).click();
  await expect(page.getByText('The passwords do not match.', { exact: true })).toBeVisible();
  expect(mock.passwordUpdates()).toHaveLength(0);
  await page.getByLabel('Confirm new password', { exact: true }).fill('A unique beta password!');
  await page.getByRole('button', { name: 'Save password and continue', exact: true }).click();
  await expect(page.getByText('Set your candidate brief', { exact: true })).toBeVisible();
  expect(mock.passwordUpdates()).toHaveLength(1);
  expect(mock.verifyCalls()).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).toBeNull();
  await page.getByText('Oxford', { exact: true }).click();
  await page.getByRole('button', { name: 'Enter the circuit', exact: true }).click();
  await expect(page.getByText('Please read the Terms and Privacy Notice before continuing.', { exact: true })).toBeVisible();
  expect(mock.requests.filter((request) => request.path === '/rest/v1/profiles' && request.method === 'PATCH')).toHaveLength(0);
  await page.getByRole('checkbox', { name: 'I have read the Terms and Privacy Notice', exact: true }).click();
  await page.getByRole('button', { name: 'Enter the circuit', exact: true }).click();
  await expect(page.getByText('Choose an interview station', { exact: true })).toBeVisible();
  await mock.assertIsolated();
});

test('email verification remains safe when font loading delays the root navigator', async ({ page }) => {
  let releaseFonts = () => {};
  let fontRequests = 0;
  const fontGate = new Promise<void>((resolve) => { releaseFonts = resolve; });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'font') {
      fontRequests += 1;
      await fontGate;
    }
    await route.continue();
  });
  const mock = await installAuthMocks(page);
  const navigationErrors: string[] = [];
  page.on('pageerror', (error) => { navigationErrors.push(error.message); });
  page.on('console', (message) => {
    if (/Attempted to navigate before mounting|NAVIGATE.*not handled/i.test(message.text())) navigationErrors.push(message.text());
  });
  try {
    await page.goto(`/auth/callback#token_hash=${tokenHash}&type=invite`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => fontRequests).toBeGreaterThan(0);
    await expect.poll(() => mock.verifyCalls().length).toBe(1);
  } finally {
    releaseFonts();
  }
  await expect(page.getByRole('heading', { name: 'Set your password', exact: true })).toBeVisible();
  expect(mock.verifyCalls()).toHaveLength(1);
  expect(navigationErrors).toEqual([]);
  await mock.assertIsolated();
});

test('a cold signed-out root waits for delayed fonts before opening sign in', async ({ page }) => {
  let releaseFonts = () => {};
  let fontRequests = 0;
  const fontGate = new Promise<void>((resolve) => { releaseFonts = resolve; });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'font') {
      fontRequests += 1;
      await fontGate;
    }
    await route.continue();
  });
  const mock = await installAuthMocks(page);
  const navigationErrors: string[] = [];
  page.on('pageerror', (error) => { navigationErrors.push(error.message); });
  page.on('console', (message) => {
    if (/Attempted to navigate before mounting|NAVIGATE.*not handled/i.test(message.text())) navigationErrors.push(message.text());
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => fontRequests).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Enter circuit', exact: true })).toHaveCount(0);
    expect(mock.requests.filter((request) => request.path.startsWith('/rest/v1/rpc/'))).toHaveLength(0);
  } finally {
    releaseFonts();
  }
  await expect(page.getByRole('button', { name: 'Enter circuit', exact: true })).toBeVisible();
  expect(navigationErrors).toEqual([]);
  await mock.assertIsolated();
});

test('a recovery link resumes after reload and returns an oriented user to the app', async ({ page }) => {
  const mock = await installAuthMocks(page, { onboardingComplete: true });
  await page.goto(`/auth/callback?token_hash=${tokenHash}&type=recovery`);
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
  expect(mock.verifyCalls()).toHaveLength(1);
  await page.getByLabel('New password', { exact: true }).fill('A replacement password!');
  await page.getByLabel('Confirm new password', { exact: true }).fill('A replacement password!');
  await page.getByRole('button', { name: 'Save password and continue', exact: true }).click();
  await expect(page.getByText('Choose an interview station', { exact: true })).toBeVisible();
  expect(mock.passwordUpdates()).toHaveLength(1);
  expect(mock.passwordUpdates()[0]?.authorization).toBe(`Bearer ${accessToken}`);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes('password-operation')))).toEqual([]);
  await mock.assertIsolated();
});

test('pending-action restoration holds protected deep links and reloads before data requests', async ({ page }) => {
  const mock = await installAuthMocks(page, { onboardingComplete: true, holdUserLookup: true });
  await page.addInitScript(({ savedSession }) => {
    sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify(savedSession));
    sessionStorage.setItem('interview-station:email-action:v1', JSON.stringify({ mode: 'recovery', userId: savedSession.user.id }));
  }, { savedSession: session });
  await page.goto('/practice');
  await expect.poll(() => mock.requests.filter((request) => request.path === '/auth/v1/user').length).toBeGreaterThan(0);
  await expect(page.getByLabel('Restoring account access', { exact: true })).toBeVisible();
  expect(mock.requests.filter((request) => request.path.startsWith('/rest/v1/rpc/'))).toHaveLength(0);
  await expect(page.getByText('MMI practice', { exact: true })).toHaveCount(0);
  mock.releaseUserLookup();
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();

  const userLookupCount = mock.requests.filter((request) => request.path === '/auth/v1/user').length;
  mock.holdUserLookup();
  await page.reload();
  await expect.poll(() => mock.requests.filter((request) => request.path === '/auth/v1/user').length).toBeGreaterThan(userLookupCount);
  await expect(page.getByLabel('Restoring account access', { exact: true })).toBeVisible();
  expect(mock.requests.filter((request) => request.path.startsWith('/rest/v1/rpc/'))).toHaveLength(0);
  mock.releaseUserLookup();
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
  await mock.assertIsolated();
});

test('setup keeps Terms and Privacy readable without clearing the pending action', async ({ page }) => {
  const mock = await installAuthMocks(page);
  await page.goto(`/auth/callback#token_hash=${tokenHash}&type=invite`);
  await expect(page.getByRole('heading', { name: 'Set your password', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Privacy', exact: true }).click();
  await expect(page.getByText('Privacy notice', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Set your password', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Terms', exact: true }).click();
  await expect(page.getByText('Terms of use', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).not.toBeNull();
  expect(mock.passwordUpdates()).toHaveLength(0);
  await mock.assertIsolated();
});

test('legacy implicit recovery credentials are removed before any backend request', async ({ page }) => {
  const mock = await installAuthMocks(page, { onboardingComplete: true });
  await page.goto(`/#access_token=${accessToken}&refresh_token=${refreshToken}&type=recovery&expires_in=3600&token_type=bearer`);
  await expect(page.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/set-password');
  expect(mock.verifyCalls()).toHaveLength(0);
  await mock.assertIsolated();
});

test('an invitation arriving at the root still requires password setup', async ({ page }) => {
  const mock = await installAuthMocks(page);
  await page.goto(`/#access_token=${accessToken}&refresh_token=${refreshToken}&type=invite&expires_in=3600&token_type=bearer`);
  await expect(page.getByRole('heading', { name: 'Set your password', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/set-password');
  expect(mock.passwordUpdates()).toHaveLength(0);
  await mock.assertIsolated();
});

test('a prior expired session cannot expose a new invitation URL during refresh', async ({ page }) => {
  const mock = await installAuthMocks(page);
  await page.addInitScript(({ savedSession }) => {
    sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify({ ...savedSession, expires_at: 1 }));
  }, { savedSession: session });
  await page.goto(`/auth/callback#token_hash=${tokenHash}&type=invite`);
  await expect(page.getByRole('heading', { name: 'Set your password', exact: true })).toBeVisible();
  await mock.assertIsolated();
});

test('cancelling setup signs out before returning to sign in', async ({ page }) => {
  const mock = await installAuthMocks(page);
  await page.goto(`/auth/callback#token_hash=${tokenHash}&type=invite`);
  await expect(page.getByRole('heading', { name: 'Set your password', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enter circuit', exact: true })).toBeVisible();
  expect(mock.requests.filter((request) => request.path === '/auth/v1/logout')).toHaveLength(1);
  expect(mock.passwordUpdates()).toHaveLength(0);
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('sb-e2e-auth-token'))).toBeNull();
  await mock.assertIsolated();
});

test('a saved password action for another account cannot authorize a password update', async ({ page }) => {
  const mock = await installAuthMocks(page, { onboardingComplete: true });
  await page.addInitScript(({ savedSession }) => {
    sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify(savedSession));
    sessionStorage.setItem('interview-station:email-action:v1', JSON.stringify({
      mode: 'recovery', userId: '88888888-8888-4888-8888-888888888888',
    }));
  }, { savedSession: session });
  await page.goto('/set-password');
  await expect(page.getByText('Password link required', { exact: true })).toBeVisible();
  expect(mock.passwordUpdates()).toHaveLength(0);
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).toBeNull();
  await mock.assertIsolated();
});

test('verification cannot bind a password action to another authenticated account', async ({ page }) => {
  const mock = await installAuthMocks(page, { verifiedUserMismatch: true });
  await page.goto(`/auth/callback#token_hash=${tokenHash}&type=invite`);
  await expect(page.getByRole('heading', { name: 'Email link unavailable', exact: true })).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
  expect(mock.passwordUpdates()).toHaveLength(0);
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).toBeNull();
  await mock.assertIsolated();
});

test('leaving an in-flight callback cannot revive its password action', async ({ page }) => {
  const mock = await installAuthMocks(page, { holdVerification: true });
  await page.goto(`/auth/callback#token_hash=${tokenHash}&type=invite`);
  await expect.poll(() => mock.verifyCalls().length).toBe(1);
  await page.goto('/login');
  mock.releaseVerification();
  await expect(page.getByRole('button', { name: 'Enter circuit', exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('sb-e2e-auth-token'))).toBeNull();
  expect(mock.passwordUpdates()).toHaveLength(0);
  await mock.assertIsolated();
});

for (const label of ['expired', 'already used']) {
  test(`an ${label} email link shows a safe error and allows a fresh reset request`, async ({ page }) => {
    const mock = await installAuthMocks(page, { rejectVerification: true });
    await page.goto(`/auth/callback#token_hash=${tokenHash}&type=invite`);
    await expect(page.getByRole('heading', { name: 'Email link unavailable', exact: true })).toBeVisible();
    await expect(page.getByText('This account link has expired or has already been used. Request a new link.', { exact: true })).toBeVisible();
    expect(mock.passwordUpdates()).toHaveLength(0);
    await page.getByRole('button', { name: 'Request a new reset link', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password', exact: true })).toBeVisible();
    await mock.assertIsolated();
  });
}

test('an invalid link is cleaned and rejected before verification', async ({ page }) => {
  const mock = await installAuthMocks(page);
  await page.goto(`/auth/callback#token_hash=${tokenHash}&type=magiclink`);
  await expect(page.getByRole('heading', { name: 'Email link unavailable', exact: true })).toBeVisible();
  expect(mock.verifyCalls()).toHaveLength(0);
  expect(new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enter circuit', exact: true })).toBeVisible();
  await mock.assertIsolated();
});

for (const unknownAccount of [false, true]) {
  test(`reset confirmation is generic for an ${unknownAccount ? 'unknown' : 'invited'} email`, async ({ page }) => {
    const mock = await installAuthMocks(page, { resetUnknownAccount: unknownAccount });
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await expect(page.getByText('Enter a valid email address.', { exact: true })).toBeVisible();
    expect(mock.resetRequests()).toHaveLength(0);
    await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(unknownAccount ? 'unknown@example.test' : 'invited@example.test');
    await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();
    await expect(page.getByText('If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder.', { exact: true })).toBeVisible();
    expect(mock.resetRequests()).toHaveLength(1);
    await mock.assertIsolated();
  });
}

test('a direct password page still needs an invitation or recovery link', async ({ page }) => {
  const mock = await installAuthMocks(page);
  await page.goto('/set-password');
  await expect(page.getByText('Password link required', { exact: true })).toBeVisible();
  expect(mock.passwordUpdates()).toHaveLength(0);
  await mock.assertIsolated();
});

test('registration validates credentials, requests confirmation, and stays signed out', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await installAuthMocks(page);
  await page.goto('/login');
  await page.getByRole('link', { name: 'Create an account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mmi-public-registration-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.screenshot({ path: testInfo.outputPath('mmi-public-registration-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Enter a valid email address.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill('student@example.test');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('A unique student password!');
  await page.getByLabel('Confirm password', { exact: true }).fill('A different student password!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('The passwords do not match.', { exact: true })).toBeVisible();
  expect(mock.requests.filter(request => request.path === '/auth/v1/signup')).toHaveLength(0);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('A unique student password!');
  await page.getByLabel('Confirm password', { exact: true }).fill('A unique student password!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send another confirmation', exact: true })).toBeDisabled();
  const registration = mock.requests.filter(request => request.path === '/auth/v1/signup');
  expect(registration).toHaveLength(1);
  expect(registration[0]?.body).toMatchObject({ email: 'student@example.test', password: 'A unique student password!' });
  expect(registration[0]?.body).not.toHaveProperty('data.is_admin');
  expect(await page.evaluate(() => sessionStorage.getItem('sb-e2e-auth-token'))).toBeNull();
  expect(mock.requests.filter(request => request.path.startsWith('/rest/v1/'))).toHaveLength(0);
  await mock.assertIsolated();
});

test('signup confirmation permits orientation without granting password replacement', async ({ page }) => {
  const mock = await installAuthMocks(page);
  await page.goto(`/auth/callback#token_hash=${tokenHash}&type=signup`);
  await expect(page.getByRole('heading', { name: 'Email confirmed', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to the circuit', exact: true })).toBeEnabled();
  expect(mock.verifyCalls()).toHaveLength(1);
  expect(mock.verifyCalls()[0]?.body).toMatchObject({ type: 'signup', token_hash: tokenHash });
  expect(await page.evaluate(() => sessionStorage.getItem('interview-station:email-action:v1'))).toBeNull();
  expect(mock.passwordUpdates()).toHaveLength(0);
  await page.getByRole('button', { name: 'Continue to the circuit', exact: true }).click();
  await expect(page.getByText('Set your candidate brief', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'I have read the Terms and Privacy Notice', exact: true })).toBeVisible();
  await expect(page.getByText(/adults aged 18|I am 18 or older/)).toHaveCount(0);
  await page.goto('/set-password');
  await expect(page.getByText('Password link required', { exact: true })).toBeVisible();
  expect(mock.passwordUpdates()).toHaveLength(0);
  await mock.assertIsolated();
});

test('disabled registration gives an honest retry message without claiming delivery', async ({ page }) => {
  const mock = await installAuthMocks(page, { signupUnavailable: true });
  await page.goto('/signup');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill('student@example.test');
  await page.getByLabel('Password', { exact: true }).fill('A unique student password!');
  await page.getByLabel('Confirm password', { exact: true }).fill('A unique student password!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Registration emails are unavailable right now. Please try again later. Existing accounts can still sign in.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Confirm password', { exact: true })).toHaveValue('');
  await mock.assertIsolated();
});

test('existing-address registration has the same public confirmation', async ({ page }) => {
  const mock = await installAuthMocks(page, { existingSignupAccount: true });
  await page.goto('/signup');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill('student@example.test');
  await page.getByLabel('Password', { exact: true }).fill('A unique student password!');
  await page.getByLabel('Confirm password', { exact: true }).fill('A unique student password!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();
  await expect(page.getByText('If this address can be registered, a confirmation email will arrive shortly. Check your inbox and spam folder. If you already have an account, sign in or reset your password.', { exact: true })).toBeVisible();
  await mock.assertIsolated();
});

test('confirmation resend needs an explicit request and observes its cooldown', async ({ page }) => {
  await page.clock.install();
  const mock = await installAuthMocks(page);
  await page.goto('/signup');
  await page.getByRole('button', { name: 'Already waiting for a confirmation?', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill('student@example.test');
  await page.getByRole('button', { name: 'Send confirmation email', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible();
  expect(mock.requests.filter(request => request.path === '/auth/v1/resend')).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Send another confirmation', exact: true })).toBeDisabled();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('button', { name: 'Send another confirmation', exact: true })).toBeEnabled();
  expect(mock.requests.filter(request => request.path === '/auth/v1/resend')).toHaveLength(1);
  await page.getByRole('button', { name: 'Send another confirmation', exact: true }).click();
  await expect.poll(() => mock.requests.filter(request => request.path === '/auth/v1/resend').length).toBe(2);
  await mock.assertIsolated();
});
