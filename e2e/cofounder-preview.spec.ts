import { expect, test, type Page } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';
const questionId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const feedbackId = '44444444-4444-4444-8444-444444444444';
const now = '2026-08-25T00:00:00.000Z';

const user = {
  id: userId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'partner@example.test',
  email_confirmed_at: now,
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Partner Tester' },
  created_at: now,
  updated_at: now,
};

const secondUser = {
  ...user,
  id: '55555555-5555-4555-8555-555555555555',
  email: 'second@example.test',
  user_metadata: { full_name: 'Second Tester' },
};

const profile = {
  id: userId,
  full_name: 'Partner Tester',
  avatar_url: null,
  university_target: 'ucl',
  entry_year: 2027,
  daily_goal: 5,
  streak_current: 2,
  streak_longest: 4,
  streak_last_date: '2026-08-24',
  onboarding_complete: true,
  is_admin: true,
  created_at: now,
  updated_at: now,
};

const secondProfile = {
  ...profile,
  id: secondUser.id,
  full_name: 'Second Tester',
  is_admin: false,
};

const question = {
  id: questionId,
  category: 'ethics',
  subcategory: 'autonomy',
  text: 'A patient declines recommended treatment. How would you balance autonomy, communication, and safety?',
  university_tags: ['ucl'],
  difficulty: 'intermediate',
  is_mmi_suitable: true,
  times_attempted: 0,
  avg_score: 0,
  created_at: now,
};

const practiceSession = {
  id: sessionId,
  user_id: userId,
  mode: 'practice',
  category_filter: 'ethics',
  question_count: 1,
  started_at: now,
  ended_at: now,
  total_score_pct: 80,
  completed: true,
};

async function installSyntheticSession(page: Page) {
  await page.addInitScript(({ storedUser, expiry }) => {
    if (sessionStorage.getItem('sb-e2e-auth-token')) return;
    sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify({
      access_token: 'synthetic-access-token',
      refresh_token: 'synthetic-refresh-token',
      expires_in: 3600,
      expires_at: expiry,
      token_type: 'bearer',
      user: storedUser,
    }));
  }, { storedUser: user, expiry: Math.floor(Date.now() / 1000) + 3600 });
}

async function installSupabaseMocks(page: Page) {
  let activeUser = user;

  await page.route('https://*.supabase.co/**', async route => {
    const hostname = new URL(route.request().url()).hostname;
    await route.abort('blockedbyclient');
    throw new Error(`Unexpected Supabase host reached by isolated E2E: ${hostname}`);
  });

  // Playwright evaluates routes in reverse registration order, so this narrow
  // synthetic route takes precedence over the fail-closed wildcard above.
  await page.route('https://e2e.supabase.co/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
      const credentials = request.postDataJSON() as { email?: string };
      activeUser = credentials.email === secondUser.email ? secondUser : user;
      return json({
        access_token: `synthetic-access-token-${activeUser.id}`,
        refresh_token: `synthetic-refresh-token-${activeUser.id}`,
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: activeUser,
      });
    }
    if (url.pathname === '/auth/v1/user') return json(activeUser);
    if (url.pathname === '/auth/v1/logout') return json({});
    if (url.pathname === '/rest/v1/profiles') {
      return json(activeUser.id === secondUser.id ? secondProfile : profile);
    }

    if (url.pathname === '/rest/v1/rpc/get_legacy_question_counts') {
      return json([
        { category: 'ethics', question_count: 1 },
        { category: 'motivation', question_count: 1 },
      ]);
    }
    if (url.pathname === '/rest/v1/rpc/list_legacy_questions') return json([question]);
    if (url.pathname === '/rest/v1/rpc/get_legacy_question') return json([question]);
    if (url.pathname === '/rest/v1/rpc/create_legacy_questions') {
      return json([{ source_index: 0, id: questionId }]);
    }
    if (url.pathname === '/rest/v1/rpc/submit_cofounder_feedback') return json(feedbackId);
    if (url.pathname === '/rest/v1/rpc/list_cofounder_feedback') {
      return json([{
        id: feedbackId,
        category: 'usability',
        severity: 'major',
        screen: 'practice',
        message: 'The station submit state needed a clearer progress indicator.',
        app_version: '1.0.0',
        allow_reply: false,
        author_id: null,
        created_at: now,
      }]);
    }
    if (url.pathname === '/rest/v1/mock_sessions' && request.method() === 'POST') {
      return json({ ...practiceSession, completed: false, ended_at: null, total_score_pct: null });
    }
    if (url.pathname === '/rest/v1/mock_sessions') return json([]);
    if (url.pathname === '/rest/v1/scores') return json([]);
    if (url.pathname === '/functions/v1/score-answer') {
      return json({
        structure: 4,
        ethics: 4,
        communication: 4,
        reflection: 4,
        nhs_awareness: 4,
        overall_pct: 80,
        ai_feedback: 'Your response balanced autonomy with a clear safety plan.',
        improvement_tip: 'State when and how you would seek senior support.',
      });
    }

    return json({ message: `Unhandled synthetic route: ${url.pathname}` }, 500);
  });
}

test.beforeEach(async ({ page }) => {
  await installSyntheticSession(page);
  await installSupabaseMocks(page);
});

test('orientation keeps the next-station plate above its heading', async ({ page }) => {
  await page.goto('/');

  const stationPlate = page.getByText('NEXT STATION', { exact: true }).locator('..');
  const heading = page.getByText('Choose an interview station', { exact: true });
  await expect(stationPlate).toBeVisible();
  await expect(heading).toBeVisible();

  const [stationPlateBox, headingBox] = await Promise.all([
    stationPlate.boundingBox(),
    heading.boundingBox(),
  ]);

  expect(stationPlateBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(stationPlateBox!.y + stationPlateBox!.height).toBeLessThanOrEqual(headingBox!.y);
});

test('admin profile links directly to the Question Desk', async ({ page }) => {
  await page.goto('/profile');

  await page.getByText('Question Desk', { exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/questions$/);
  await expect(page.getByText('Add practice questions')).toBeVisible();
});

test('partner completes practice, sends feedback, and signs out', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Ready, Partner.')).toBeVisible();

  await page.getByText('SEND FEEDBACK', { exact: true }).click();
  await expect(page.getByText('Tell us what happened')).toBeVisible();
  await page.getByText('Practice', { exact: true }).click();
  await page.getByPlaceholder(/What did you try/i).fill(
    'The selected station was clear, but I expected stronger confirmation after submitting.',
  );
  await page.getByText('Review report', { exact: true }).click();
  await page.getByText('Send report', { exact: true }).click();
  await expect(page.getByText('Feedback received')).toBeVisible();

  await page.getByText('Back to orient', { exact: true }).click();
  await page.getByLabel('02 Practise').click();
  await expect(page.getByText('2 ACTIVE')).toBeVisible();
  await expect(page.getByText('CLOSED', { exact: true }).first()).toBeVisible();
  await page.getByText('Ethics', { exact: true }).click();
  await page.getByText('Enter station', { exact: true }).click();
  await expect(page.getByText('LAMINATED CANDIDATE BRIEF')).toBeVisible();
  await page.getByLabel('Your practice response').fill(
    'I would first explore the patient’s concerns, confirm capacity, explain benefits and risks clearly, respect autonomy, and seek senior support if safety concerns remained.',
  );
  await page.getByText('Submit answer', { exact: true }).click();
  await expect(page.getByText('Station feedback')).toBeVisible();
  await expect(page.getByText('80%')).toBeVisible();

  await page.getByText('Open progress', { exact: true }).click();
  await expect(page.getByText('Progress record')).toBeVisible();
  await page.getByRole('tab', { name: '01 Orient' }).click();
  await page.getByRole('button', { name: 'Open profile' }).last().click();
  await page.getByText('Sign out', { exact: true }).click();
  await page.getByText('Sign out', { exact: true }).last().click();
  await expect(page.getByText('Enter the circuit')).toBeVisible();
  await expect(page.evaluate(() => sessionStorage.getItem('sb-e2e-auth-token'))).resolves.toBeNull();

  await page.getByLabel('Email address').fill('second@example.test');
  await page.getByLabel('Password').fill('synthetic-password');
  await page.getByText('Enter circuit', { exact: true }).click();
  await expect(page.getByText('Ready, Second.').last()).toBeVisible();

  await page.goto(`/practice/feedback?sessionId=${sessionId}`);
  await expect(page.getByText('Feedback unavailable')).toBeVisible();
  await expect(page.getByText('Your response balanced autonomy with a clear safety plan.')).toHaveCount(0);
  await expect(page.getByText(/I would first explore the patient/)).toHaveCount(0);
  await page.getByText('Choose a station', { exact: true }).click();
  await expect(page.getByText('Choose a station door')).toBeVisible();

  await page.goto('/admin/questions');
  await expect(page.getByText('Ready, Second.').last()).toBeVisible();
  await expect(page.getByText('Add practice questions')).toHaveCount(0);
});

test('admin creates a draft and reviews masked partner feedback', async ({ page }) => {
  await page.goto('/admin/questions');
  await expect(page.getByText('Add practice questions')).toBeVisible();
  await page.getByPlaceholder('Write the exact prompt shown to the candidate.').fill(
    'How would you respond when a patient’s family disagrees with the patient’s informed decision?',
  );
  await page.getByText('Review draft', { exact: true }).click();
  await page.getByText('Save draft', { exact: true }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();

  await page.goto('/admin/feedback');
  await expect(page.getByText('Partner field reports')).toBeVisible();
  await expect(page.getByText('The station submit state needed a clearer progress indicator.')).toBeVisible();
  await expect(page.getByText('FOLLOW-UP NOT REQUESTED')).toBeVisible();
  await expect(page.getByText(userId)).toHaveCount(0);
});
