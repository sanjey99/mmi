import { expect, test, type Page } from '@playwright/test';
import { scoringAllowanceFixture } from '../tests/fixtures/scoringAllowance';

const accountId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const now = '2026-10-20T12:00:00.000Z';
const user = { id: accountId, aud: 'authenticated', role: 'authenticated', email: 'candidate@example.test', email_confirmed_at: now, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now, updated_at: now };
const profile = { id: accountId, full_name: 'Candidate', avatar_url: null, university_target: 'Oxford', entry_year: 2027, daily_goal: 5, streak_current: 0, streak_longest: 0, streak_last_date: null, onboarding_complete: true, is_admin: false, created_at: now, updated_at: now };

async function installMocks(page: Page, options: Readonly<{ signedOut?: boolean; respond?: (call: number) => Promise<Readonly<{ data: unknown; status?: number }>> }> = {}) {
  const allowanceRequests: unknown[] = [];
  const unexpectedHosts: string[] = [];
  if (!options.signedOut) await page.addInitScript(({ storedUser, expiry }) => {
    sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify({ access_token: 'synthetic-allowance-token', refresh_token: 'synthetic-allowance-refresh', expires_in: 3600, expires_at: expiry, token_type: 'bearer', user: storedUser }));
  }, { storedUser: user, expiry: Math.floor(Date.now() / 1000) + 3600 });
  await page.route('https://*.supabase.co/**', async route => { unexpectedHosts.push(new URL(route.request().url()).hostname); await route.abort('blockedbyclient'); });
  await page.route('https://e2e.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/auth/v1/user') return json(user);
    if (path === '/rest/v1/profiles') return json(profile);
    if (path === '/rest/v1/rpc/get_candidate_mmi_practice_options') return json({ targetUniversity: 'Oxford', targetTag: 'oxford', targetCount: 1, allCount: 1 });
    if (path === '/rest/v1/rpc/get_candidate_mmi_scoring_allowance') {
      allowanceRequests.push(route.request().postDataJSON());
      const response = options.respond ? await options.respond(allowanceRequests.length) : { data: scoringAllowanceFixture() };
      return json(response.data, response.status);
    }
    if (path === '/rest/v1/mock_sessions' || path === '/rest/v1/rpc/list_candidate_mmi_history') return json([]);
    return json({ code: 'XX000', message: 'PRIVATE_SYNTHETIC_DIAGNOSTIC' }, 500);
  });
  return { allowanceRequests, assertIsolated: () => expect(unexpectedHosts).toEqual([]) };
}

test('practice explains the full-station allowance and local reset before starting', async ({ page }, testInfo) => {
  const mock = await installMocks(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/practice');
  await expect(page.getByRole('heading', { name: 'Up to 2 complete stations of AI feedback left today', exact: true })).toBeVisible();
  await expect(page.getByText(/Daily allowance resets at .* in your local time \(00:00 UTC\)\./)).toBeVisible();
  await expect(page.getByText('This is your remaining daily allowance. Retries also use it, and shared availability is checked again when feedback is requested.', { exact: true })).toBeVisible();
  expect(mock.allowanceRequests).toEqual([{}]);
  for (const button of await page.getByRole('button', { name: 'Practise', exact: true }).all()) await expect(button).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('mmi-practice-allowance-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('mmi-practice-allowance-mobile.png'), fullPage: true });
  mock.assertIsolated();
});

for (const state of [
  { title: "Today's AI feedback allowance is used", value: scoringAllowanceFixture({ responsesRemaining: 0, stationAllowanceRemaining: 0 }) },
  { title: 'Less than a full station of AI feedback remains', value: scoringAllowanceFixture({ attemptsRemaining: 4 }) },
  { title: 'AI feedback is temporarily paused', value: scoringAllowanceFixture({ scoringPaused: true, globalCapacityAvailable: false }) },
  { title: 'AI feedback is temporarily unavailable', value: scoringAllowanceFixture({ globalCapacityAvailable: false }) },
]) test(`${state.title} is clear and keeps question practice available`, async ({ page }) => {
  const mock = await installMocks(page, { respond: async () => ({ data: state.value }) });
  await page.goto('/practice');
  await expect(page.getByRole('heading', { name: state.title, exact: true })).toBeVisible();
  for (const button of await page.getByRole('button', { name: 'Practise', exact: true }).all()) await expect(button).toBeEnabled();
  if (state.value.attemptsRemaining === 4) await expect(page.getByText(/up to 4 more answers today/)).toBeVisible();
  mock.assertIsolated();
});

test('a counter failure is polite, private, retryable, and never blocks practice', async ({ page }) => {
  const mock = await installMocks(page, { respond: async call => call === 1
    ? { data: { ...scoringAllowanceFixture(), accountId: 'PRIVATE_ACCOUNT_ID', transcript: 'PRIVATE_ANSWER' } }
    : { data: scoringAllowanceFixture() } });
  await page.goto('/practice');
  await expect(page.getByRole('heading', { name: 'AI feedback allowance could not be checked', exact: true })).toBeVisible();
  await expect(page.getByText(/Check again before starting if you need feedback for the whole station/)).toBeVisible();
  for (const button of await page.getByRole('button', { name: 'Practise', exact: true }).all()) await expect(button).toBeEnabled();
  expect(await page.locator('body').innerText()).not.toContain('PRIVATE_');
  await page.getByRole('button', { name: 'Check allowance again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Up to 2 complete stations of AI feedback left today', exact: true })).toBeVisible();
  expect(mock.allowanceRequests).toEqual([{}, {}]);
  mock.assertIsolated();
});

test('returning to practice refreshes the snapshot and discards an old in-flight result', async ({ page }) => {
  let release = () => {};
  const firstGate = new Promise<void>(resolve => { release = resolve; });
  const mock = await installMocks(page, { respond: async call => {
    if (call === 1) { await firstGate; return { data: scoringAllowanceFixture() }; }
    return { data: scoringAllowanceFixture({ responsesRemaining: 0, stationAllowanceRemaining: 0 }) };
  } });
  await page.goto('/practice');
  await expect.poll(() => mock.allowanceRequests.length).toBe(1);
  await page.getByLabel('01 Orient', { exact: true }).click();
  await expect(page.getByText('Choose an interview station', { exact: true })).toBeVisible();
  await page.getByLabel('02 Practise', { exact: true }).click();
  await expect(page.getByRole('heading', { name: "Today's AI feedback allowance is used", exact: true })).toBeVisible();
  const completed = page.waitForResponse(response => response.url().includes('/get_candidate_mmi_scoring_allowance'));
  release();
  await (await completed).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('heading', { name: "Today's AI feedback allowance is used", exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Up to 2 complete stations of AI feedback left today', exact: true })).toHaveCount(0);
  mock.assertIsolated();
});

test('signed-out navigation does not request an account allowance', async ({ page }) => {
  const mock = await installMocks(page, { signedOut: true });
  await page.goto('/practice');
  await expect(page.getByRole('button', { name: 'Enter circuit', exact: true })).toBeVisible();
  expect(mock.allowanceRequests).toHaveLength(0);
  await expect(page.getByText('BEFORE YOU START / AI FEEDBACK', { exact: true })).toHaveCount(0);
  mock.assertIsolated();
});
