import { expect, test, type Page } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';
const responseId = '22222222-2222-4222-8222-222222222222';
const now = '2026-09-12T00:00:00.000Z';

const user = Object.freeze({
  id: userId, aud: 'authenticated', role: 'authenticated', email: 'admin@example.test',
  email_confirmed_at: now, app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Admin Tester' }, created_at: now, updated_at: now,
});

const profile = Object.freeze({
  id: userId, full_name: 'Admin Tester', avatar_url: null, university_target: 'Oxford',
  entry_year: 2027, daily_goal: 5, streak_current: 0, streak_longest: 0,
  streak_last_date: null, onboarding_complete: true, is_admin: true,
  created_at: now, updated_at: now,
});

const assessment = Object.freeze({
  accessAuditId: '33333333-3333-4333-8333-333333333333', responseId, userId,
  userDisplayName: 'Candidate A', stationId: 'MMI_001', subQuestionId: 'MMI_001_Q1',
  promptOrder: 1, questionScorePct: 25,
  criteria: Object.freeze([
    Object.freeze({ criterionId: 'MMI_001_Q1_C1', bulletText: 'Recognises the immediate safety issue.', domain: 'safety', achieved: true, weightPct: 25 }),
    Object.freeze({ criterionId: 'MMI_001_Q1_C2', bulletText: 'Explains a proportionate next step.', domain: 'communication', achieved: false, weightPct: 25 }),
    Object.freeze({ criterionId: 'MMI_001_Q1_C3', bulletText: 'Considers autonomy.', domain: 'ethics', achieved: false, weightPct: 25 }),
    Object.freeze({ criterionId: 'MMI_001_Q1_C4', bulletText: 'Escalates appropriately.', domain: 'safety', achieved: false, weightPct: 25 }),
  ]),
  provider: 'anthropic', model: 'claude-test', inputTokens: 120, cachedInputTokens: 0,
  outputTokens: 80, estimatedCost: '0.00020500', latencyMs: 300, outcome: 'scored',
  finalizedAt: now, scoredAt: now,
});

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function installSyntheticSession(page: Page) {
  await page.addInitScript(({ storedUser, expiry }) => {
    sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify({
      access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token',
      expires_in: 3600, expires_at: expiry, token_type: 'bearer', user: storedUser,
    }));
  }, { storedUser: user, expiry: Math.floor(Date.now() / 1000) + 3600 });
}

async function installSyntheticMmiApi(page: Page) {
  await page.route('https://*.supabase.co/**', async (route) => {
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected Supabase host reached by isolated E2E: ${new URL(route.request().url()).hostname}`);
  });
  await page.route('https://e2e.supabase.co/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/auth/v1/user') return route.fulfill(json(user));
    if (path === '/rest/v1/profiles') return route.fulfill(json(profile));
    if (path === '/rest/v1/rpc/get_candidate_mmi_practice_options') {
      return route.fulfill(json({ targetUniversity: 'Oxford', targetTag: 'oxford', targetCount: 115, allCount: 155 }));
    }
    if (path === '/rest/v1/rpc/get_admin_mmi_dashboard') {
      return route.fulfill(json({
        stationCounts: { draft: 1, published: 155, archived: 0 },
        universityCounts: [{ tag: 'oxford', count: 115 }, { tag: 'all', count: 155 }],
        contentHealth: { stationCount: 155, questionCount: 775, criterionCount: 3100, invalidStationCount: 0 },
        ai: { provider: 'anthropic', model: 'claude-test', isConfigured: true },
        usage: { periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-09-30T23:59:59.000Z', callCount: 1, knownCost: '0.00020500', unknownCostCount: 0, failureCount: 0 },
      }));
    }
    if (path === '/rest/v1/rpc/list_admin_mmi_assessments') {
      return route.fulfill(json({ items: [{
        responseId, userId, userDisplayName: 'Candidate A', stationId: 'MMI_001', subQuestionId: 'MMI_001_Q1', promptOrder: 1,
        questionScorePct: 25, provider: 'anthropic', model: 'claude-test', estimatedCost: '0.00020500', costKnown: true, outcome: 'scored', scoredAt: now,
      }], total: 1 }));
    }
    if (path === '/rest/v1/rpc/get_admin_mmi_assessment') return route.fulfill(json(assessment));
    if (path === '/rest/v1/rpc/get_admin_ai_config') {
      return route.fulfill(json({
        provider: 'anthropic', model: 'claude-test', baseUrl: null,
        inputRatePerMillion: 1, cachedInputRatePerMillion: 0, outputRatePerMillion: 2,
        isConfigured: true, updatedAt: now,
      }));
    }
    if (path === '/rest/v1/rpc/save_admin_ai_config') {
      return route.fulfill(json({ ok: true, auditId: '44444444-4444-4444-8444-444444444444', targetId: 'ai-config', version: 1 }));
    }
    return route.fulfill(json({ message: `Unhandled synthetic route: ${path}` }, 500));
  });
}

test.beforeEach(async ({ page }) => {
  await installSyntheticSession(page);
  await installSyntheticMmiApi(page);
});

test('targeted and all-repository cards show distinct complete 11-minute pools', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('02 Practise').click();

  await expect(page.getByText('Oxford practice', { exact: true })).toBeVisible();
  await expect(page.getByText('115 complete 11-minute stations', { exact: true })).toBeVisible();
  await expect(page.getByText('155 complete 11-minute stations', { exact: true })).toBeVisible();
});

test('admin opens an audited structured rubric and cost view without answer content', async ({ page }) => {
  await page.goto('/admin/assessments');

  await page.getByText('Candidate A · MMI_001 · Question 1', { exact: true }).click();
  await page.getByRole('button', { name: 'scoring review' }).click();
  await expect(page).toHaveURL(/\/admin\/assessment\?/);
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await expect(page.getByText(/Candidate A · MMI_001 · Question 1 · 25%/)).toBeVisible();
  await expect(page.getByText('anthropic / claude-test · scored · $0.00020500 · 300ms', { exact: true })).toBeVisible();
  await expect(page.getByText('Private candidate transcript that must never render', { exact: true })).toHaveCount(0);
});

test('admin can confirm a non-secret model and rate configuration save', async ({ page }) => {
  await page.goto('/admin/ai-config');

  await page.getByRole('button', { name: 'Save AI settings' }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved', { exact: true })).toBeVisible();
  await expect(page.getByText('synthetic-secret-value', { exact: true })).toHaveCount(0);
});
