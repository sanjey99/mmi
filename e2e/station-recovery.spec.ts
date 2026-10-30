import { expect, test, type Page, type Request } from '@playwright/test';
import { scoringAllowanceFixture } from '../tests/fixtures/scoringAllowance';

const accountId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const sessionId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const activeId = 'cccccccc-3333-4333-8333-cccccccccccc';
const now = '2026-10-30T12:00:00.000Z';
const user = { id: accountId, aud: 'authenticated', role: 'authenticated', email: 'candidate@example.test', email_confirmed_at: now, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: now, updated_at: now };
const profile = { id: accountId, full_name: 'Candidate', avatar_url: null, university_target: 'Oxford', entry_year: 2027, daily_goal: 5, streak_current: 0, streak_longest: 0, streak_last_date: null, onboarding_complete: true, is_admin: false, created_at: now, updated_at: now };
const activity = { completedToday: 0, completedTotal: 0, streakCurrent: 0, streakLongest: 0, latestCompletedAt: null };
function scored(promptOrder: number) {
  return { promptOrder, status: 'scored', legacy: false, assessment: { schemaVersion: 4, questionScorePct: 75, criteria: [1, 2, 3, 4].map(index => ({ criterionId: `Q${promptOrder}_C${index}`, bulletText: `Synthetic criterion ${index}`, domain: 'communication', weightPct: 25, performanceLevel: 3, evidenceQuote: 'Synthetic supporting answer.', justification: 'The synthetic answer demonstrates the criterion well.' })) } };
}
type SyntheticFeedback = Readonly<{ promptOrder: number; status: string; legacy: boolean; assessment: ReturnType<typeof scored>['assessment'] | null }>;
function partialFeedback(): SyntheticFeedback[] {
  return [scored(1), { promptOrder: 2, status: 'failed', legacy: false, assessment: null }, { promptOrder: 3, status: 'in_progress', legacy: false, assessment: null }, { promptOrder: 4, status: 'pending', legacy: false, assessment: null }, { promptOrder: 5, status: 'feedback_unavailable', legacy: false, assessment: null }];
}
function result(feedback: readonly SyntheticFeedback[] = [1, 2, 3, 4, 5].map(scored)) {
  const complete = feedback.every(item => item.status === 'scored');
  return { sessionId, stationId: 'ADMIN_recovery-fixture', status: complete ? 'completed' : 'awaiting_scoring', overallPct: complete ? 75 : null, feedback };
}
function historyItem(id = sessionId, completedAt: string | null = now) {
  return { sessionId: id, stationId: 'ADMIN_recovery-fixture', scope: 'all', targetUniversity: null, startedAt: '2026-10-30T11:49:00.000Z', completedAt, status: 'awaiting_scoring', overallPct: null, domainAttainment: [] };
}

type Reply = Readonly<{ data: unknown; status?: number }>;
async function installMocks(page: Page, respond?: (path: string, body: Record<string, unknown>, count: number) => Promise<Reply | undefined>) {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const external: string[] = [];
  await page.addInitScript(({ storedUser, expiry }) => sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify({ access_token: 'synthetic-recovery-token', refresh_token: 'synthetic-recovery-refresh', expires_in: 3600, expires_at: expiry, token_type: 'bearer', user: storedUser })), { storedUser: user, expiry: Math.floor(Date.now() / 1000) + 3600 });
  await page.routeWebSocket('**/*', socket => { external.push('unexpected-websocket'); socket.close(); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    if (url.origin !== 'https://e2e.supabase.co') { external.push(url.origin); return route.abort('blockedbyclient'); }
    const path = url.pathname;
    const body = route.request().postData() ? route.request().postDataJSON() as Record<string, unknown> : {};
    requests.push({ path, body });
    const custom = await respond?.(path, body, requests.filter(item => item.path === path).length);
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (custom) return json(custom.data, custom.status);
    if (path === '/auth/v1/user') return json(user);
    if (path === '/rest/v1/profiles') return json(profile);
    if (path.endsWith('/get_candidate_mmi_activity_summary')) return json(activity);
    if (path.endsWith('/get_candidate_mmi_scoring_allowance')) return json(scoringAllowanceFixture());
    if (path.endsWith('/get_candidate_mmi_practice_options')) return json({ targetUniversity: 'Oxford', targetTag: 'oxford', targetCount: 3, allCount: 5 });
    if (path.endsWith('/list_candidate_mmi_history')) return json([historyItem()]);
    if (path.endsWith('/get_candidate_mmi_station_result')) return json(result());
    if (path.endsWith('/get_candidate_mmi_station_session')) return json({ sessionId, stationId: 'ADMIN_recovery-fixture', serverNow: now, phase: 'scenario', phaseStartedAt: now, phaseEndsAt: '2026-10-30T12:01:00.000Z', scenarioText: 'Synthetic restored station brief.' });
    return json({ code: 'XX000', message: 'PRIVATE_SYNTHETIC_DIAGNOSTIC' }, 500);
  });
  return { requests, assertIsolated: () => expect(external).toEqual([]) };
}

for (const query of ['sessionId=not-a-uuid', 'resultOnly=true', 'sessionId=not-a-uuid&resultOnly=true', 'sessionId=', `sessionId=${sessionId}&resultOnly=unknown`, `sessionId=${sessionId}&resultOnly=true&resultOnly=true`]) {
  test(`invalid or incomplete station links have a safe escape: ${query}`, async ({ page }) => {
    const mock = await installMocks(page);
    await page.goto(`/practice/mmi-station?${query}`);
    await expect(page.getByRole('alert')).toContainText(/link.*invalid|link.*incomplete|valid.*link/i);
    await expect(page.getByText('Restoring MMI station', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: query.endsWith('resultOnly=true') && !query.includes('resultOnly=true&') ? 'Return to progress' : 'Return to practice', exact: true }).click();
    await expect(page).toHaveURL(query.endsWith('resultOnly=true') && !query.includes('resultOnly=true&') ? /\/progress$/ : /\/practice$/);
    expect(mock.requests.filter(item => item.path.includes('/get_candidate_mmi_station_') || item.path.includes('/start_candidate_mmi_station_') || item.path.includes('/functions/'))).toHaveLength(0);
    mock.assertIsolated();
  });
}

test('a saved-result read retries without starting or scoring a station', async ({ page }) => {
  let retryReleased = false;
  const mock = await installMocks(page, async path => path.endsWith('/get_candidate_mmi_station_result') && !retryReleased ? { data: { message: 'PRIVATE_RESULT_DIAGNOSTIC' }, status: 503 } : undefined);
  await page.goto(`/practice/mmi-station?sessionId=${sessionId}&resultOnly=true`);
  await expect(page.getByRole('alert')).toContainText('saved MMI result is unavailable');
  await expect(page.getByText('Overall station score · 75%', { exact: true })).toHaveCount(0);
  const failedReads = mock.requests.filter(item => item.path.endsWith('/get_candidate_mmi_station_result')).length;
  expect(failedReads).toBeGreaterThan(0);
  retryReleased = true;
  await page.getByRole('button', { name: 'Retry loading result', exact: true }).click();
  await expect(page.getByText('Overall station score · 75%', { exact: true })).toBeVisible();
  expect(mock.requests.filter(item => item.path.endsWith('/get_candidate_mmi_station_result')).length).toBeGreaterThan(failedReads);
  expect(mock.requests.filter(item => item.path.includes('/functions/') || item.path.includes('/start_candidate_mmi_station_'))).toHaveLength(0);
  expect(await page.locator('body').innerText()).not.toContain('PRIVATE_');
  mock.assertIsolated();
});

test('a station read recovers from temporary failure without a new admission', async ({ page }) => {
  let retryReleased = false;
  const mock = await installMocks(page, async path => path.endsWith('/get_candidate_mmi_station_session') && !retryReleased ? { data: { message: 'PRIVATE_STATION_DIAGNOSTIC' }, status: 503 } : undefined);
  await page.goto(`/practice/mmi-station?sessionId=${sessionId}`);
  await expect(page.getByRole('alert')).toContainText('MMI station is unavailable');
  await expect(page.getByText('Synthetic restored station brief.', { exact: true })).toHaveCount(0);
  const failedReads = mock.requests.filter(item => item.path.endsWith('/get_candidate_mmi_station_session')).length;
  expect(failedReads).toBeGreaterThan(0);
  retryReleased = true;
  await page.getByRole('button', { name: 'Retry restoring station', exact: true }).click();
  await expect(page.getByText('Synthetic restored station brief.', { exact: true })).toBeVisible();
  expect(mock.requests.filter(item => item.path.endsWith('/get_candidate_mmi_station_session')).length).toBeGreaterThan(failedReads);
  expect(mock.requests.filter(item => item.path.includes('/start_candidate_mmi_station_') || item.path.includes('/functions/'))).toHaveLength(0);
  mock.assertIsolated();
});

test('finished partial feedback reopens read-only and retries eligible answers only on explicit action', async ({ page }) => {
  let feedback = partialFeedback();
  const mock = await installMocks(page, async (path, body) => {
    if (path.endsWith('/list_candidate_mmi_history')) return { data: [historyItem(), historyItem(activeId, null)] };
    if (path.endsWith('/get_candidate_mmi_station_result')) return { data: result(feedback) };
    if (path === '/functions/v1/score-candidate-mmi-response') {
      expect(body.sessionId).toBe(sessionId);
      feedback = feedback.map(item => item.promptOrder === body.promptOrder ? scored(item.promptOrder) : item);
      return { data: { status: 'scored' } };
    }
    return undefined;
  });
  await page.goto('/progress');
  await expect(page.getByRole('button', { name: 'View available feedback', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'View available feedback', exact: true }).click();
  await expect(page.getByText('Question 1 · 75%', { exact: true })).toBeVisible();
  await expect(page.getByText(/temporary transcript expired/)).toBeVisible();
  expect(mock.requests.filter(item => item.path.includes('/functions/'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Refresh feedback', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry AI scoring', exact: true })).toBeVisible();
  expect(mock.requests.filter(item => item.path.includes('/functions/'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Retry AI scoring', exact: true }).click();
  await expect(page.getByText('Question 2 · 75%', { exact: true })).toBeVisible();
  await expect(page.getByText('Question 4 · 75%', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry AI scoring', exact: true })).toHaveCount(0);
  expect(mock.requests.filter(item => item.path.includes('/functions/')).map(item => item.body.promptOrder).sort()).toEqual([2, 4]);
  expect(mock.requests.filter(item => item.path.includes('/start_candidate_mmi_station_'))).toHaveLength(0);
  mock.assertIsolated();
});

test('practice options show honest loading and recover through an explicit retry', async ({ page }) => {
  let release = () => {};
  let retryReleased = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mock = await installMocks(page, async path => {
    if (!path.endsWith('/get_candidate_mmi_practice_options')) return undefined;
    if (!retryReleased) { await gate; return { data: { message: 'PRIVATE_OPTIONS_DIAGNOSTIC' }, status: 503 }; }
    return { data: { targetUniversity: 'Oxford', targetTag: 'oxford', targetCount: 3, allCount: 5 } };
  });
  await page.goto('/practice');
  await expect(page.getByText('Loading practice options…', { exact: true })).toBeVisible();
  await expect(page.getByText('0 complete 11-minute stations', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Add a university target in your profile to unlock this pool.', { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByText('Practice options are unavailable right now. Please try again.', { exact: true })).toBeVisible();
  const failedReads = mock.requests.filter(item => item.path.endsWith('/get_candidate_mmi_practice_options')).length;
  expect(failedReads).toBeGreaterThan(0);
  retryReleased = true;
  await page.getByRole('button', { name: 'Retry practice options', exact: true }).click();
  await expect(page.getByText('3 complete 11-minute stations', { exact: true })).toBeVisible();
  for (const button of await page.getByRole('button', { name: 'Practise', exact: true }).all()) await expect(button).toBeEnabled();
  expect(await page.locator('body').innerText()).not.toContain('PRIVATE_');
  expect(mock.requests.filter(item => item.path.endsWith('/get_candidate_mmi_practice_options')).length).toBeGreaterThan(failedReads);
  mock.assertIsolated();
});

test('returning to practice ignores a previous-focus request and loads fresh pools', async ({ page }) => {
  let release = () => {};
  let returnedToPractice = false;
  const previousFocusRequests: Request[] = [];
  page.on('request', request => {
    if (!returnedToPractice && new URL(request.url()).pathname.endsWith('/get_candidate_mmi_practice_options')) previousFocusRequests.push(request);
  });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mock = await installMocks(page, async path => {
    if (!path.endsWith('/get_candidate_mmi_practice_options')) return undefined;
    if (!returnedToPractice) { await gate; return { data: { targetUniversity: 'Oxford', targetTag: 'oxford', targetCount: 3, allCount: 5 } }; }
    return { data: { targetUniversity: 'Cambridge', targetTag: 'cambridge', targetCount: 2, allCount: 5 } };
  });
  await page.goto('/practice');
  await expect.poll(() => mock.requests.filter(item => item.path.endsWith('/get_candidate_mmi_practice_options')).length).toBeGreaterThan(0);
  await page.getByRole('tab', { name: '01 Orient', exact: true }).click();
  returnedToPractice = true;
  await page.getByRole('tab', { name: '02 Practise', exact: true }).click();
  await expect(page.getByText('Cambridge practice', { exact: true })).toBeVisible();
  expect(previousFocusRequests.length).toBeGreaterThan(0);
  release();
  await Promise.all(previousFocusRequests.map(async request => {
    const response = await request.response();
    if (response) await response.finished();
  }));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText('Oxford practice', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Cambridge practice', { exact: true })).toBeVisible();
  mock.assertIsolated();
});

for (const onboardingComplete of [true, false]) test(`same-account authentication refresh preserves the tab until its ${onboardingComplete ? 'completed' : 'incomplete'} profile returns`, async ({ page }) => {
  let release = () => {};
  let refreshHeld = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mock = await installMocks(page, async path => {
    if (path === '/rest/v1/profiles' && refreshHeld) {
      await gate;
      return { data: { ...profile, onboarding_complete: onboardingComplete } };
    }
    return undefined;
  });
  await page.goto('/practice');
  await expect(page.getByText('Oxford practice', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '02 Practise', exact: true })).toHaveAttribute('aria-selected', 'true');
  refreshHeld = true;
  const refreshRead = page.waitForRequest(request => new URL(request.url()).pathname === '/rest/v1/profiles');
  await page.evaluate(storedUser => {
    const channel = new BroadcastChannel('sb-e2e-auth-token');
    channel.postMessage({ event: 'TOKEN_REFRESHED', session: { access_token: 'synthetic-recovery-token', refresh_token: 'synthetic-recovery-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: storedUser } });
    channel.close();
  }, user);
  await refreshRead;
  try {
    await expect(page.getByRole('tab', { name: '02 Practise', exact: true })).toHaveAttribute('aria-selected', 'true');
  } finally { release(); }
  if (onboardingComplete) {
    await expect(page.getByText('Oxford practice', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByRole('tab', { name: '02 Practise', exact: true })).toHaveAttribute('aria-selected', 'true');
  } else {
    await expect(page.getByText('Set your candidate brief', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('tablist')).toHaveCount(0);
  }
  expect(mock.requests.filter(item => item.path.includes('/start_candidate_mmi_station_') || item.path.includes('/functions/'))).toHaveLength(0);
  mock.assertIsolated();
});

test('a different account cannot retain the previous account tab while its profile loads', async ({ page }) => {
  const nextUser = { ...user, id: activeId, email: 'second-candidate@example.test' };
  const nextProfile = { ...profile, id: activeId, full_name: 'Second Candidate', university_target: 'Cambridge' };
  let switched = false;
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mock = await installMocks(page, async path => {
    if (!switched) return undefined;
    if (path === '/auth/v1/user') return { data: nextUser };
    if (path === '/rest/v1/profiles') { await gate; return { data: nextProfile }; }
    if (path.endsWith('/get_candidate_mmi_practice_options')) return { data: { targetUniversity: 'Cambridge', targetTag: 'cambridge', targetCount: 2, allCount: 5 } };
    return undefined;
  });
  await page.goto('/practice');
  await expect(page.getByText('Oxford practice', { exact: true })).toBeVisible();
  switched = true;
  const profileRead = page.waitForRequest(request => new URL(request.url()).pathname === '/rest/v1/profiles');
  await page.evaluate(storedUser => {
    const nextSession = { access_token: 'synthetic-switched-token', refresh_token: 'synthetic-switched-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: storedUser };
    sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify(nextSession));
    const channel = new BroadcastChannel('sb-e2e-auth-token');
    channel.postMessage({ event: 'SIGNED_IN', session: nextSession });
    channel.close();
  }, nextUser);
  const heldProfileRead = await profileRead;
  try {
    await expect(page.getByText('Oxford practice', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('tablist')).toHaveCount(0);
  } finally { release(); }
  const response = await heldProfileRead.response();
  if (response) await response.finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText('Oxford practice', { exact: true })).toHaveCount(0);
  expect(mock.requests.filter(item => item.path.includes('/start_candidate_mmi_station_') || item.path.includes('/functions/'))).toHaveLength(0);
  mock.assertIsolated();
});
