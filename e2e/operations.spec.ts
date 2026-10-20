import { expect, test, type Page } from '@playwright/test';
import { operationsDashboardFixture } from '../tests/fixtures/operationsDashboard';
import { scoringAllowanceFixture } from '../tests/fixtures/scoringAllowance';

const userId = '99999999-9999-4999-8999-999999999999';
const now = '2026-10-20T12:00:00.000Z';
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'private-admin@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now, updated_at: now };
const profile = { id: userId, full_name: 'PRIVATE_ADMIN_NAME', avatar_url: null, university_target: 'Oxford', entry_year: 2027, daily_goal: 5, streak_current: 0, streak_longest: 0, streak_last_date: null, onboarding_complete: true, is_admin: true, created_at: now, updated_at: now };

async function installMocks(page: Page, options: Readonly<{ admin?: boolean; respond?: (testersOnly: boolean, call: number) => Promise<Readonly<{ data: unknown; status?: number }>> }> = {}) {
  const calls: boolean[] = [];
  const unexpectedHosts: string[] = [];
  await page.addInitScript(({ storedUser, expiry }) => {
    sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify({ access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', expires_in: 3600, expires_at: expiry, token_type: 'bearer', user: storedUser }));
  }, { storedUser: user, expiry: Math.floor(Date.now() / 1000) + 3600 });
  await page.route('https://*.supabase.co/**', async (route) => {
    unexpectedHosts.push(new URL(route.request().url()).hostname);
    await route.abort('blockedbyclient');
  });
  await page.route('https://e2e.supabase.co/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/auth/v1/user') return json(user);
    if (path === '/rest/v1/profiles') return json({ ...profile, is_admin: options.admin ?? true });
    if (path === '/rest/v1/rpc/get_mmi_operations_dashboard') {
      const { p_testers_only: testersOnly } = route.request().postDataJSON() as { p_testers_only: boolean };
      calls.push(testersOnly);
      const result = options.respond ? await options.respond(testersOnly, calls.length) : { data: operationsDashboardFixture(testersOnly ? 'testers' : 'all') };
      return json(result.data, result.status);
    }
    if (path === '/rest/v1/rpc/get_admin_mmi_dashboard') return json({
      stationCounts: { draft: 1, published: 155, archived: 0 }, universityCounts: [{ tag: 'oxford', count: 115 }], contentHealth: { stationCount: 155, questionCount: 775, criterionCount: 3100, invalidStationCount: 0 }, ai: { provider: 'anthropic', model: 'claude-test', isConfigured: true }, usage: { periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', callCount: 1, knownCost: '0.00020500', unknownCostCount: 0, failureCount: 0 },
    });
    if (path === '/rest/v1/rpc/get_candidate_mmi_practice_options') return json({ targetUniversity: 'Oxford', targetTag: 'oxford', targetCount: 1, allCount: 1 });
    if (path === '/rest/v1/rpc/get_candidate_mmi_scoring_allowance') return json(scoringAllowanceFixture());
    if (path === '/rest/v1/rpc/get_legacy_question_counts' || path === '/rest/v1/rpc/list_candidate_mmi_history' || path === '/rest/v1/mock_sessions') return json([]);
    return json({ message: 'Unhandled synthetic route' }, 500);
  });
  return { calls, assertIsolated: () => expect(unexpectedHosts).toEqual([]) };
}

function metric(page: Page, label: string, value: string) {
  return page.getByText(label, { exact: true }).locator('..').getByText(value, { exact: true });
}

test('admin navigation opens seven-day aggregate operations without account or answer content', async ({ page }) => {
  const mock = await installMocks(page);
  await page.goto('/admin');
  await page.getByRole('button', { name: /Operations overview\. Track aggregate/ }).click();
  await expect(page.getByRole('heading', { name: 'Operations overview', exact: true })).toBeVisible();
  await expect(metric(page, 'Practising accounts', '8')).toBeVisible();
  await expect(metric(page, 'Stations started', '20')).toBeVisible();
  await expect(metric(page, 'Stations finished', '13')).toBeVisible();
  await expect(metric(page, 'Provider attempts', '80')).toBeVisible();
  await expect(metric(page, 'Known cost · USD', '$0.00700000')).toBeVisible();
  await expect(metric(page, 'Cost unavailable', '2')).toBeVisible();
  await expect(page.getByLabel('2026-10-14 UTC: 2 stations started, 1 finished', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Today is partial · UTC', { exact: true })).toBeVisible();
  await expect(page.getByText('Scoring needs attention', { exact: true })).toBeVisible();
  await expect(page.getByText('Recent scoring failures increased', { exact: true })).toBeVisible();
  const body = await page.locator('body').innerText();
  for (const secret of [userId, profile.full_name, user.email, 'transcript', 'api_key', 'rawResponse']) expect(body).not.toContain(secret);
  expect(mock.calls).toEqual([true]);
  mock.assertIsolated();
});

test('a late tester response cannot replace a newer all-account cohort', async ({ page }) => {
  let releaseTesters = () => {};
  const testerGate = new Promise<void>((resolve) => { releaseTesters = resolve; });
  const mock = await installMocks(page, { respond: async (testersOnly) => {
    if (testersOnly) await testerGate;
    const value = operationsDashboardFixture(testersOnly ? 'testers' : 'all');
    return { data: { ...value, activity: { ...value.activity, practisingUsers: testersOnly ? 8 : 9 } } };
  } });
  await page.goto('/admin/operations');
  await expect.poll(() => mock.calls.length).toBe(1);
  await page.getByRole('button', { name: 'All accounts', exact: true }).click();
  await expect(metric(page, 'Practising accounts', '9')).toBeVisible();
  releaseTesters();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(metric(page, 'Practising accounts', '9')).toBeVisible();
  await expect(metric(page, 'Practising accounts', '8')).toHaveCount(0);
  expect(mock.calls).toEqual([true, false]);
  mock.assertIsolated();
});

test('operations errors are safe and a failed request can be retried', async ({ page }) => {
  const mock = await installMocks(page, { respond: async (_testersOnly, call) => call === 1 ? { data: { message: 'PRIVATE_DATABASE_SENTINEL' }, status: 500 } : { data: operationsDashboardFixture() } });
  await page.goto('/admin/operations');
  await expect(page.getByText('Operations not loaded', { exact: true })).toBeVisible();
  await expect(page.getByText('PRIVATE_DATABASE_SENTINEL', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(metric(page, 'Stations started', '20')).toBeVisible();
  expect(mock.calls).toEqual([true, true]);
  mock.assertIsolated();
});

test('a widened aggregate payload fails closed without displaying private material', async ({ page }) => {
  const mock = await installMocks(page, { respond: async () => ({ data: { ...operationsDashboardFixture(), runtime: { ...operationsDashboardFixture().runtime, message: 'PRIVATE_RUNTIME_SENTINEL' } } }) });
  await page.goto('/admin/operations');
  await expect(page.getByText('Operations not loaded', { exact: true })).toBeVisible();
  await expect(page.getByText('PRIVATE_RUNTIME_SENTINEL', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Practising accounts', { exact: true })).toHaveCount(0);
  mock.assertIsolated();
});

test('empty cohorts distinguish no provider timing from a zero-duration call', async ({ page }) => {
  const mock = await installMocks(page, { respond: async () => ({ data: operationsDashboardFixture('testers', true) }) });
  await page.goto('/admin/operations');
  await expect(page.getByText('No activity recorded in this period', { exact: true })).toBeVisible();
  await expect(page.getByText('No calls yet', { exact: true })).toHaveCount(2);
  await expect(page.getByText('0.00s', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Retention needs attention', { exact: true })).toHaveCount(0);
  mock.assertIsolated();
});

test('retention warnings remain global when showing tester-only activity', async ({ page }) => {
  const dashboard = operationsDashboardFixture('testers', true);
  const mock = await installMocks(page, { respond: async () => ({ data: { ...dashboard, retention: { ...dashboard.retention, heartbeatAgeSeconds: 901, overdueResponses: 3, overdueDrafts: 2 } } }) });
  await page.goto('/admin/operations');
  await expect(page.getByText('Retention needs attention', { exact: true })).toBeVisible();
  await expect(metric(page, 'Overdue responses', '3')).toBeVisible();
  await expect(metric(page, 'Overdue drafts', '2')).toBeVisible();
  await expect(page.getByText('These checks always include tester and administrator accounts, regardless of the selected cohort.', { exact: true })).toBeVisible();
  mock.assertIsolated();
});

test('missing default scoring setup is visible even without provider attempts', async ({ page }) => {
  const dashboard = operationsDashboardFixture('testers', true);
  const mock = await installMocks(page, { respond: async () => ({ data: { ...dashboard, scoring: { ...dashboard.scoring, isConfigured: false } } }) });
  await page.goto('/admin/operations');
  await expect(page.getByText('Scoring setup needs attention', { exact: true })).toBeVisible();
  await expect(metric(page, 'Default scoring setup', 'Missing')).toBeVisible();
  await expect(metric(page, 'Provider attempts', '0')).toBeVisible();
  await expect(page.getByText('Checks the stored default provider key and rates. No live provider call is made.', { exact: true })).toBeVisible();
  mock.assertIsolated();
});

test('a non-administrator cannot request operations aggregates', async ({ page }) => {
  const mock = await installMocks(page, { admin: false });
  await page.goto('/admin/operations');
  await expect(page.getByText('Choose an interview station', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operations overview', exact: true })).toHaveCount(0);
  expect(mock.calls).toEqual([]);
  mock.assertIsolated();
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`operations remains readable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const mock = await installMocks(page);
    await page.goto('/admin/operations');
    await expect(metric(page, 'Stations started', '20')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`operations-${viewport.width}.png`), fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    mock.assertIsolated();
  });
}
