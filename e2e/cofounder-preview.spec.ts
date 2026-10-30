import { expect, test, type Page, type Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { scoringAllowanceFixture } from '../tests/fixtures/scoringAllowance';

const userId = '11111111-1111-4111-8111-111111111111';
const questionId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const feedbackId = '44444444-4444-4444-8444-444444444444';
const candidateStationSessionId = '66666666-6666-4666-8666-666666666666';
const candidateStationId = 'ADMIN_e2e-station';
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
  university_target: 'Oxford',
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

type CandidateMmiProjection = Readonly<{
  sessionId: string;
  stationId: string;
  serverNow: string;
  phase: 'scenario' | 'response' | 'completed';
  phaseStartedAt: string;
  phaseEndsAt: string | null;
  scenarioText?: string;
  promptOrder?: 1 | 2 | 3 | 4 | 5;
  promptText?: string;
  draftTranscript?: string;
  draftRevision?: number;
  responseStatus?: 'open';
}>;

const candidateScenarioProjection: CandidateMmiProjection = Object.freeze({
  sessionId: candidateStationSessionId,
  stationId: candidateStationId,
  serverNow: '2026-08-26T00:00:59.500Z',
  phase: 'scenario',
  phaseStartedAt: '2026-08-26T00:00:00.000Z',
  phaseEndsAt: '2026-08-26T00:01:00.000Z',
  scenarioText: 'Synthetic candidate scenario.',
});

const candidateResponseProjections: Readonly<Record<1 | 2 | 3 | 4 | 5, CandidateMmiProjection>> = Object.freeze({
  1: Object.freeze({
    sessionId: candidateStationSessionId, stationId: candidateStationId,
    serverNow: '2026-08-26T00:01:10.000Z', phase: 'response',
    phaseStartedAt: '2026-08-26T00:01:00.000Z', phaseEndsAt: '2026-08-26T00:03:00.000Z',
    promptOrder: 1, promptText: 'Synthetic prompt 1.',
    draftTranscript: '', draftRevision: 0, responseStatus: 'open',
  }),
  2: Object.freeze({
    sessionId: candidateStationSessionId, stationId: candidateStationId,
    serverNow: '2026-08-26T00:03:10.000Z', phase: 'response',
    phaseStartedAt: '2026-08-26T00:03:00.000Z', phaseEndsAt: '2026-08-26T00:05:00.000Z',
    promptOrder: 2, promptText: 'Synthetic prompt 2.',
    draftTranscript: '', draftRevision: 0, responseStatus: 'open',
  }),
  3: Object.freeze({
    sessionId: candidateStationSessionId, stationId: candidateStationId,
    serverNow: '2026-08-26T00:05:10.000Z', phase: 'response',
    phaseStartedAt: '2026-08-26T00:05:00.000Z', phaseEndsAt: '2026-08-26T00:07:00.000Z',
    promptOrder: 3, promptText: 'Synthetic prompt 3.',
    draftTranscript: '', draftRevision: 0, responseStatus: 'open',
  }),
  4: Object.freeze({
    sessionId: candidateStationSessionId, stationId: candidateStationId,
    serverNow: '2026-08-26T00:07:10.000Z', phase: 'response',
    phaseStartedAt: '2026-08-26T00:07:00.000Z', phaseEndsAt: '2026-08-26T00:09:00.000Z',
    promptOrder: 4, promptText: 'Synthetic prompt 4.',
    draftTranscript: '', draftRevision: 0, responseStatus: 'open',
  }),
  5: Object.freeze({
    sessionId: candidateStationSessionId, stationId: candidateStationId,
    serverNow: '2026-08-26T00:09:10.000Z', phase: 'response',
    phaseStartedAt: '2026-08-26T00:09:00.000Z', phaseEndsAt: '2026-08-26T00:11:00.000Z',
    promptOrder: 5, promptText: 'Synthetic prompt 5.',
    draftTranscript: '', draftRevision: 0, responseStatus: 'open',
  }),
});

const candidateCompletedProjection: CandidateMmiProjection = Object.freeze({
  sessionId: candidateStationSessionId,
  stationId: candidateStationId,
  serverNow: '2026-08-26T00:11:00.000Z',
  phase: 'completed',
  phaseStartedAt: '2026-08-26T00:11:00.000Z',
  phaseEndsAt: null,
});

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

async function installSyntheticSpeechRecognition(page: Page) {
  await page.addInitScript(() => {
    type ResultHandler = (event: {
      resultIndex: number;
      results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
    }) => void;
    type ErrorHandler = (event: { error: string }) => void;
    let active: SyntheticSpeechRecognition | null = null;
    let startCount = 0;
    let stopCount = 0;

    class SyntheticSpeechRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ErrorHandler | null = null;
      onresult: ResultHandler | null = null;

      start() {
        active = this;
        startCount += 1;
        queueMicrotask(() => this.onstart?.());
      }

      stop() {
        if (active === this) active = null;
        stopCount += 1;
        queueMicrotask(() => this.onend?.());
      }

      abort() {
        this.stop();
      }
    }

    const emit = (text: string, isFinal: boolean) => {
      active?.onresult?.({
        resultIndex: 0,
        results: [{ isFinal, 0: { transcript: text } }],
      });
    };
    const harness = Object.freeze({
      emitFinal: (text: string) => emit(text, true),
      emitInterim: (text: string) => emit(text, false),
      deny: () => active?.onerror?.({ error: 'not-allowed' }),
      end: () => {
        const ending = active;
        active = null;
        ending?.onend?.();
      },
      counts: () => ({ startCount, stopCount }),
    });
    Object.assign(window, {
      SpeechRecognition: SyntheticSpeechRecognition,
      webkitSpeechRecognition: undefined,
      __candidateMmiSpeech: harness,
    });
  });
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
    if (url.pathname === '/rest/v1/app_config') {
      return json({ key: 'normalized_mmi_station_enabled', value: 'false' });
    }
    if (url.pathname === '/rest/v1/rpc/get_candidate_mmi_practice_options') {
      return json({ targetUniversity: 'Oxford', targetTag: 'oxford', targetCount: 115, allCount: 155 });
    }
    if (url.pathname === '/rest/v1/rpc/get_candidate_mmi_scoring_allowance') return json(scoringAllowanceFixture());
    if (url.pathname === '/rest/v1/rpc/get_candidate_mmi_activity_summary') return json({
      completedToday: 1, completedTotal: 1, streakCurrent: 1, streakLongest: 1, latestCompletedAt: now,
    });
    if (url.pathname === '/rest/v1/rpc/list_candidate_mmi_history') return json([]);

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

async function installCandidateMmiController(page: Page) {
  let currentProjection: CandidateMmiProjection = candidateScenarioProjection;
  let nextAfterFinalization: CandidateMmiProjection = candidateResponseProjections[2];
  let abandonCount = 0;
  let scoringFailureCode: string | null = null;
  let checkpointFailuresRemaining = 0;
  let checkpointWindowClosed = false;
  let feedbackFollowsFinalization = false;
  const rpcCalls: string[] = [];
  const startRequests: Array<Record<string, unknown>> = [];
  const checkpoints: Array<Record<string, unknown>> = [];
  const finalizations: Array<Record<string, unknown>> = [];
  const finalizedResponses: Array<{ responseState: 'response' | 'no_response'; transcript: string }> = [];
  const scoringRequests: Array<Record<string, unknown>> = [];
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  const criterion = Object.freeze({
    criterionId: 'MMI_001_Q1_C1',
    achieved: true,
    weightPct: 25,
    bulletText: 'Identifies the immediate priority.',
    domain: 'safety',
  });
  const assessment = Object.freeze({
    schemaVersion: 3 as const,
    questionScorePct: 25,
    criteria: Object.freeze([
      criterion,
      Object.freeze({ criterionId: 'MMI_001_Q1_C2', achieved: false, weightPct: 25, bulletText: 'Explains a proportionate next step.', domain: 'communication' }),
      Object.freeze({ criterionId: 'MMI_001_Q1_C3', achieved: false, weightPct: 25, bulletText: 'Considers autonomy.', domain: 'ethics' }),
      Object.freeze({ criterionId: 'MMI_001_Q1_C4', achieved: false, weightPct: 25, bulletText: 'Escalates appropriately.', domain: 'safety' }),
    ]),
  });
  const feedback = Object.freeze([
    Object.freeze({ promptOrder: 1, status: 'scored', legacy: false, assessment }),
    ...([2, 3, 4, 5] as const).map(promptOrder => Object.freeze({
      promptOrder,
      status: 'no_response',
      legacy: false,
      assessment: Object.freeze({
        ...assessment,
        questionScorePct: 0,
        criteria: Object.freeze(assessment.criteria.map((item) => ({ ...item, achieved: false }))),
      }),
    })),
  ]);
  const pendingFeedback = Object.freeze(
    ([1, 2, 3, 4, 5] as const).map((promptOrder) => Object.freeze({
      promptOrder,
      status: 'pending' as const,
      legacy: false,
      assessment: null,
    })),
  );
  let feedbackMode: 'terminal' | 'pending' = 'terminal';
  let partialFeedback: Array<{ promptOrder: number; status: 'pending' | 'in_progress' | 'failed' | 'scored' | 'no_response'; legacy: false; assessment: unknown }> | null = null;
  let partialFailure = true;
  const scoringAttempts = new Map<number, number>();
  let activeScoring = 0;
  let peakScoring = 0;

  // Registered after the default route: Playwright's reverse matching gives
  // this candidate-only controller precedence without widening the wildcard.
  await page.route('https://e2e.supabase.co/rest/v1/app_config**', route => (
    route.fulfill(json({ key: 'normalized_mmi_station_enabled', value: 'true' }))
  ));
  await page.route('https://e2e.supabase.co/rest/v1/rpc/start_candidate_mmi_station_session', route => {
    rpcCalls.push('start');
    startRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill(json(candidateScenarioProjection));
  });
  await page.route('https://e2e.supabase.co/rest/v1/rpc/get_candidate_mmi_station_session', route => {
    rpcCalls.push('get');
    return route.fulfill(json(currentProjection));
  });
  await page.route('https://e2e.supabase.co/rest/v1/rpc/checkpoint_candidate_mmi_station_response', route => {
    rpcCalls.push('checkpoint');
    const body = route.request().postDataJSON() as Record<string, unknown>;
    checkpoints.push(body);
    if (checkpointWindowClosed) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'candidate_response_not_open' }) });
    }
    if (checkpointFailuresRemaining > 0) {
      checkpointFailuresRemaining--;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'synthetic_checkpoint_failure' }) });
    }
    if (currentProjection.phase === 'response') {
      currentProjection = Object.freeze({
        ...currentProjection,
        draftTranscript: body.p_transcript as string,
        draftRevision: body.p_client_revision as number,
      });
    }
    return route.fulfill(json({
      sessionId: body.p_session_id,
      promptOrder: body.p_prompt_order,
      draftRevision: body.p_client_revision,
      acceptedAt: '2026-08-26T00:01:30.000Z',
    }));
  });
  await page.route('https://e2e.supabase.co/rest/v1/rpc/finalize_candidate_mmi_station_response', route => {
    rpcCalls.push('finalize');
    const body = route.request().postDataJSON() as Record<string, unknown>;
    finalizations.push(body);
    const responseState = currentProjection.draftTranscript?.trim() ? 'response' : 'no_response';
    finalizedResponses.push({ responseState, transcript: currentProjection.draftTranscript ?? '' });
    const result = {
      sessionId: body.p_session_id,
      promptOrder: body.p_prompt_order,
      responseState,
      finalizedAt: '2026-08-26T00:03:00.000Z',
      scoringStatus: responseState === 'response' ? 'pending' : 'no_response',
    };
    if (feedbackFollowsFinalization) {
      partialFeedback = feedback.map((item) => item.promptOrder === body.p_prompt_order ? {
        promptOrder: item.promptOrder,
        status: responseState === 'response' ? 'pending' : 'no_response',
        legacy: false,
        assessment: responseState === 'response' ? null : { ...assessment, questionScorePct: 0, criteria: assessment.criteria.map((criterion) => ({ ...criterion, achieved: false })) },
      } : item);
    }
    currentProjection = nextAfterFinalization;
    return route.fulfill(json(result));
  });
  await page.route('https://e2e.supabase.co/rest/v1/rpc/get_candidate_mmi_station_feedback', route => {
    rpcCalls.push('feedback');
    return route.fulfill(json(partialFeedback ?? (feedbackMode === 'terminal' ? feedback : pendingFeedback)));
  });
  await page.route('https://e2e.supabase.co/rest/v1/rpc/abandon_candidate_mmi_station_session', route => {
    rpcCalls.push('abandon');
    abandonCount += 1;
    return route.fulfill(json({}));
  });
  await page.route('https://e2e.supabase.co/functions/v1/score-candidate-mmi-response', async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    scoringRequests.push(body);
    if (partialFeedback) {
      const order = body.promptOrder as 1 | 2 | 3 | 4 | 5;
      const attempt = (scoringAttempts.get(order) ?? 0) + 1;
      scoringAttempts.set(order, attempt);
      peakScoring = Math.max(peakScoring, ++activeScoring);
      partialFeedback[order - 1] = { promptOrder: order, status: 'in_progress', legacy: false, assessment: null };
      await new Promise(resolve => setTimeout(resolve, 100));
      activeScoring--;
      if ((order === 2 && attempt === 1) || (order === 4 && partialFailure)) {
        partialFeedback[order - 1] = { promptOrder: order, status: 'failed', legacy: false, assessment: null };
        return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'invalid_provider_response' }) });
      }
      partialFeedback[order - 1] = { promptOrder: order, status: 'scored', legacy: false, assessment };
      return route.fulfill(json({ status: 'scored' }));
    }
    if (scoringFailureCode) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: scoringFailureCode }),
      });
    }
    return route.fulfill(json({ status: 'scored' }));
  });

  return Object.freeze({
    selectScenario: () => { currentProjection = candidateScenarioProjection; },
    selectResponse: (order: 1 | 2 | 3 | 4 | 5, draftTranscript = '', draftRevision = 0) => {
      currentProjection = Object.freeze({
        ...candidateResponseProjections[order],
        draftTranscript,
        draftRevision,
      });
    },
    selectExpiringResponse: (order: 1 | 2 | 3 | 4 | 5, draftTranscript: string) => {
      const projection = candidateResponseProjections[order];
      currentProjection = Object.freeze({
        ...projection,
        serverNow: new Date(Date.parse(projection.phaseEndsAt!) - 3_500).toISOString(),
        draftTranscript,
        draftRevision: draftTranscript ? 1 : 0,
      });
    },
    advanceTo: (nextProjection: CandidateMmiProjection) => {
      nextAfterFinalization = nextProjection;
    },
    selectCompleted: () => { currentProjection = candidateCompletedProjection; },
    failScoringWith: (code: string) => { scoringFailureCode = code; feedbackMode = 'pending'; },
    selectPartialFeedback: () => { partialFeedback = [...pendingFeedback]; partialFeedback[0] = feedback[0]; partialFeedback[4] = feedback[4]; },
    recoverPartialFailure: () => { partialFailure = false; },
    failNextCheckpoint: () => { checkpointFailuresRemaining = 1; feedbackFollowsFinalization = true; },
    closeCheckpointWindow: () => { checkpointWindowClosed = true; },
    peakScoring: () => peakScoring,
    abandonCount: () => abandonCount,
    rpcCalls: () => [...rpcCalls],
    startRequests: () => startRequests.map((request) => ({ ...request })),
    checkpoints: () => [...checkpoints],
    finalizations: () => [...finalizations],
    finalizedResponses: () => [...finalizedResponses],
    scoringRequests: () => [...scoringRequests],
  });
}

test.beforeEach(async ({ page }) => {
  await installSyntheticSession(page);
  await installSyntheticSpeechRecognition(page);
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

test('MMI activity uses server totals and refreshes on focus, request, and profile', async ({ page }) => {
  let summary = { completedToday: 1, completedTotal: 37, streakCurrent: 3, streakLongest: 7, latestCompletedAt: now };
  const requests: unknown[] = [];
  await page.route('https://e2e.supabase.co/rest/v1/rpc/get_candidate_mmi_activity_summary', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary) });
  });
  await page.goto('/');
  await expect(page.getByTestId('mmi-completed-today')).toHaveText('1');
  await expect(page.getByTestId('mmi-completed-total')).toHaveText('37');
  await expect(page.getByTestId('mmi-current-streak')).toHaveText('3');
  await expect(page.getByText('TODAY (UTC)', { exact: true })).toBeVisible();
  await expect(page.getByText('COMPLETED STATIONS', { exact: true })).toBeVisible();
  await page.getByLabel('02 Practise', { exact: true }).click();
  summary = { ...summary, completedToday: 2, completedTotal: 38 };
  await page.getByLabel('01 Orient', { exact: true }).click();
  await expect(page.getByTestId('mmi-completed-total')).toHaveText('38');
  summary = { ...summary, completedToday: 3, completedTotal: 39 };
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByTestId('mmi-completed-today')).toHaveText('3');
  await expect(page.getByTestId('mmi-completed-total')).toHaveText('39');
  await page.getByRole('button', { name: /^profile$/i }).click();
  await expect(page.getByTestId('profile-current-streak')).toHaveText('3');
  await expect(page.getByTestId('profile-longest-streak')).toHaveText('7');
  expect(requests.length).toBeGreaterThanOrEqual(4);
  expect(requests.every(body => JSON.stringify(body) === '{}')).toBe(true);
});

test('MMI activity failure clears old totals and never presents an unverified zero', async ({ page }) => {
  let failed = false;
  await page.route('https://e2e.supabase.co/rest/v1/rpc/get_candidate_mmi_activity_summary', route => route.fulfill({
    status: failed ? 500 : 200, contentType: 'application/json',
    body: JSON.stringify(failed ? { message: 'PRIVATE_ACTIVITY_DIAGNOSTIC' } : { completedToday: 2, completedTotal: 27, streakCurrent: 2, streakLongest: 6, latestCompletedAt: now }),
  }));
  await page.goto('/');
  await expect(page.getByTestId('mmi-completed-total')).toHaveText('27');
  failed = true;
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByText('Your practice activity is unavailable. Refresh to try again.', { exact: true })).toBeVisible();
  for (const id of ['mmi-completed-today', 'mmi-completed-total', 'mmi-current-streak']) await expect(page.getByTestId(id)).toHaveText('—');
  expect(await page.locator('body').innerText()).not.toContain('PRIVATE_ACTIVITY_DIAGNOSTIC');
  failed = false;
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByTestId('mmi-completed-total')).toHaveText('27');
});

test('MMI activity refreshes at UTC midnight and after the browser resumes', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-21T23:55:00.000Z') });
  await page.addInitScript(() => {
    const stored = sessionStorage.getItem('sb-e2e-auth-token');
    if (stored) sessionStorage.setItem('sb-e2e-auth-token', JSON.stringify({ ...JSON.parse(stored), expires_at: 4_102_444_800 }));
  });
  let calls = 0;
  let beforeMidnight = true;
  await page.route('https://e2e.supabase.co/rest/v1/rpc/get_candidate_mmi_activity_summary', route => {
    calls++;
    return route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({
        completedToday: beforeMidnight ? 1 : 0, completedTotal: 4, streakCurrent: 1, streakLongest: 2, latestCompletedAt: now,
      }),
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('mmi-completed-today')).toHaveText('1');
  await page.clock.pauseAt(new Date('2026-10-21T23:59:59.500Z'));
  const beforeBoundary = calls;
  beforeMidnight = false;
  await page.clock.fastForward(2_000);
  await expect.poll(() => calls).toBeGreaterThan(beforeBoundary);
  await expect(page.getByTestId('mmi-completed-today')).toHaveText('0');
  const beforeResume = calls;
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await expect.poll(() => calls).toBeGreaterThan(beforeResume);
  await expect(page.getByTestId('mmi-completed-today')).toHaveText('0');
});

test('MMI activity drops an earlier request after leaving and returning to the tab', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  let initialPhase = true;
  const heldRequests: Request[] = [];
  await page.route('https://e2e.supabase.co/rest/v1/rpc/get_candidate_mmi_activity_summary', async route => {
    calls++;
    const earlier = initialPhase;
    if (earlier) { heldRequests.push(route.request()); await gate; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      completedToday: 1, completedTotal: earlier ? 99 : 1, streakCurrent: 1, streakLongest: 1, latestCompletedAt: now,
    }) });
  });
  await page.goto('/');
  await expect.poll(() => calls).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('mmi-completed-total')).toHaveText('—');
  await page.getByLabel('02 Practise', { exact: true }).click();
  initialPhase = false;
  await page.getByLabel('01 Orient', { exact: true }).click();
  await expect(page.getByTestId('mmi-completed-total')).toHaveText('1');
  const completed = Promise.all(heldRequests.map(request => page.waitForResponse(response => response.request() === request).then(response => response.finished())));
  release();
  await completed;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByTestId('mmi-completed-total')).toHaveText('1');
});

test('MMI activity cannot publish the previous account request after sign-out and sign-in', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const heldRequests: Request[] = [];
  await page.route('https://e2e.supabase.co/rest/v1/rpc/get_candidate_mmi_activity_summary', async route => {
    calls++;
    const nextAccount = (route.request().headers().authorization ?? '').includes(secondUser.id);
    if (!nextAccount) { heldRequests.push(route.request()); await gate; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      completedToday: 1, completedTotal: nextAccount ? 2 : 99, streakCurrent: 1, streakLongest: 1, latestCompletedAt: now,
    }) });
  });
  await page.goto('/');
  await expect.poll(() => calls).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: /^profile$/i }).click();
  await page.getByText('Sign out', { exact: true }).click();
  await page.getByText('Sign out', { exact: true }).last().click();
  await page.getByLabel('Email address').fill(secondUser.email);
  await page.getByLabel('Password').fill('synthetic-password');
  await page.getByText('Enter circuit', { exact: true }).click();
  await expect(page.getByText('Ready, Second.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('mmi-completed-total')).toHaveText('2');
  const completed = Promise.all(heldRequests.map(request => page.waitForResponse(response => response.request() === request).then(response => response.finished())));
  release();
  await completed;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByTestId('mmi-completed-total')).toHaveText('2');
});

test('Review refreshes on focus, ignores an old request, and clears rows on failure', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  let failed = false;
  let initialPhase = true;
  const heldRequests: Request[] = [];
  await page.route('https://e2e.supabase.co/rest/v1/rpc/list_candidate_mmi_history', async route => {
    calls++;
    const earlier = initialPhase;
    if (earlier) { heldRequests.push(route.request()); await gate; }
    return route.fulfill({ status: failed ? 500 : 200, contentType: 'application/json', body: JSON.stringify(failed ? { message: 'PRIVATE_HISTORY_DIAGNOSTIC' } : [{
      sessionId: candidateStationSessionId, stationId: candidateStationId, scope: 'all', targetUniversity: null,
      startedAt: now, completedAt: now, status: 'completed', overallPct: earlier ? 12.5 : 58.75, domainAttainment: [],
    }]) });
  });
  await page.goto('/');
  await expect(page.getByText('Ready, Partner.', { exact: true })).toBeVisible();
  await page.getByLabel('03 Review', { exact: true }).click();
  await expect.poll(() => calls).toBeGreaterThanOrEqual(1);
  await expect(page.getByText('Loading your progress record…', { exact: true })).toBeVisible();
  await expect(page.getByText('NO COMPLETED STATIONS', { exact: true })).toHaveCount(0);
  await page.getByLabel('01 Orient', { exact: true }).click();
  initialPhase = false;
  await page.getByLabel('03 Review', { exact: true }).click();
  await expect(page.getByText('58.75%', { exact: true })).toBeVisible();
  const completed = Promise.all(heldRequests.map(request => page.waitForResponse(response => response.request() === request).then(response => response.finished())));
  release();
  await completed;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText('12.5%', { exact: true })).toHaveCount(0);
  failed = true;
  await page.getByRole('button', { name: 'Refresh progress', exact: true }).click();
  await expect(page.getByText('Your progress record is unavailable right now.', { exact: true })).toBeVisible();
  await expect(page.getByText('58.75%', { exact: true })).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('PRIVATE_HISTORY_DIAGNOSTIC');
});

test('practice presents distinct Oxford and all-repository 11-minute station pools', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  await page.goto('/');
  await page.getByLabel('02 Practise').click();

  await expect(page.getByText('Oxford practice', { exact: true })).toBeVisible();
  await expect(page.getByText('115 complete 11-minute stations', { exact: true })).toBeVisible();
  await expect(page.getByText('155 complete 11-minute stations', { exact: true })).toBeVisible();
  await expect(page.getByText('Ethics', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Practise' }).first().click();
  await expect(page).toHaveURL(/\/practice\/mmi-station\?scope=target$/);
  await expect(page.getByText('Check your setup', { exact: true })).toBeVisible();
  await page.getByText('Start station', { exact: true }).click();
  await expect(page.getByText('ADMIN_e2e-station', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Synthetic candidate scenario.', { exact: true })).toBeVisible();
  await expect.poll(() => controller.startRequests()).toEqual([{ p_scope: 'target' }]);

  await page.goto('/');
  await page.getByLabel('02 Practise').click();
  await page.getByRole('button', { name: 'Practise' }).nth(1).click();
  await expect(page).toHaveURL(/\/practice\/mmi-station\?scope=all$/);
  await page.getByText('Start station', { exact: true }).click();
  await expect(page.getByText('Synthetic candidate scenario.', { exact: true })).toBeVisible();
  await expect.poll(() => controller.startRequests()).toEqual([
    { p_scope: 'target' },
    { p_scope: 'all' },
  ]);
});

test('MMI station follows only the current trusted prompt across timer expiry and re-entry', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  await page.goto('/');
  await page.getByLabel('02 Practise').click();

  await page.getByRole('button', { name: 'Practise' }).first().click();
  await expect(page).toHaveURL(/\/practice\/mmi-station\?scope=target$/);
  await expect(page.getByText('Check your setup', { exact: true })).toBeVisible();
  await expect(page.getByLabel(/seconds remaining/)).toHaveCount(0);
  expect(controller.rpcCalls()).toEqual([]);

  await page.getByText('Test microphone', { exact: true }).click();
  await expect(page.getByText(/Microphone ready/)).toBeVisible();
  expect(controller.rpcCalls()).toEqual([]);
  await page.getByText('Start station', { exact: true }).click();
  await expect(page).toHaveURL(/\/practice\/mmi-station\?sessionId=/);
  await expect(page.getByText('60-second brief', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic candidate scenario.', { exact: true })).toBeVisible();
  await expect(page.getByText(/^0:0[01]$/)).toBeVisible();

  controller.selectResponse(1);
  await expect(page.getByText('Synthetic prompt 1.', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Response 1 · 120-second response', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic prompt 2.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Your response transcript' })).toBeVisible();

  controller.selectResponse(2);
  await page.reload();
  await expect(page.getByText('Synthetic prompt 2.', { exact: true })).toBeVisible();
  await expect(page.getByText('Response 2 · 120-second response', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic prompt 1.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('2:00', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/1:4[89]/)).toBeVisible();

  await page.reload();
  await expect(page.getByText('Synthetic prompt 2.', { exact: true })).toBeVisible();
  await expect(page.getByText('2:00', { exact: true })).toHaveCount(0);

  controller.selectResponse(3);
  await page.reload();
  await expect(page.getByText('Synthetic prompt 3.', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic prompt 2.', { exact: true })).toHaveCount(0);

  controller.selectResponse(4);
  await page.reload();
  await expect(page.getByText('Synthetic prompt 4.', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic prompt 3.', { exact: true })).toHaveCount(0);

  controller.selectResponse(5);
  await page.reload();
  await expect(page.getByText('Synthetic prompt 5.', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic prompt 4.', { exact: true })).toHaveCount(0);

  controller.selectCompleted();
  await page.reload();
  await expect(page.getByText('Station complete', { exact: true })).toBeVisible();
  await expect(page.getByText(/Synthetic prompt/)).toHaveCount(0);
  const stationReads = controller.rpcCalls().filter(call => call === 'start' || call === 'get');
  expect(stationReads[0]).toBe('start');
  expect(stationReads.filter(call => call === 'start')).toHaveLength(1);
  // Deadline reconciliation can add reads while the trusted prompt assertions above remain exact.
  expect(stationReads.filter(call => call === 'get').length).toBeGreaterThanOrEqual(8);
  expect(stationReads.slice(1).every(call => call === 'get')).toBe(true);
});

test('MMI speech stays editable, checkpoints text, restarts safely, and restores paused', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  controller.selectResponse(1, 'Restored opening', 2);
  await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

  const transcript = page.getByRole('textbox', { name: 'Your response transcript' });
  await expect(transcript).toHaveValue('Restored opening');
  await expect(page.getByText(/Microphone paused/)).toBeVisible();
  await page.getByText('Resume microphone', { exact: true }).click();
  await expect(page.getByText(/Listening/)).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as {
      __candidateMmiSpeech: { emitInterim: (text: string) => void };
    }).__candidateMmiSpeech.emitInterim('working thought');
  });
  await expect(page.getByText('Hearing: working thought', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as {
      __candidateMmiSpeech: { emitFinal: (text: string) => void };
    }).__candidateMmiSpeech.emitFinal('spoken conclusion');
  });
  await expect(transcript).toHaveValue('Restored opening spoken conclusion');

  const startsBeforeEnd = await page.evaluate(() => (
    (window as unknown as {
      __candidateMmiSpeech: { counts: () => { startCount: number } };
    }).__candidateMmiSpeech.counts().startCount
  ));
  await page.evaluate(() => {
    (window as unknown as {
      __candidateMmiSpeech: { end: () => void };
    }).__candidateMmiSpeech.end();
  });
  await expect.poll(async () => page.evaluate(() => (
    (window as unknown as {
      __candidateMmiSpeech: { counts: () => { startCount: number } };
    }).__candidateMmiSpeech.counts().startCount
  ))).toBe(startsBeforeEnd + 1);

  await transcript.fill('Manually corrected response');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => controller.checkpoints().length).toBe(1);
  expect(controller.checkpoints()[0]).toMatchObject({
    p_session_id: candidateStationSessionId,
    p_prompt_order: 1,
    p_transcript: 'Manually corrected response',
    p_client_revision: 3,
  });

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Your response transcript' }))
    .toHaveValue('Manually corrected response');
  await expect(page.getByText(/Microphone paused/)).toBeVisible();
  await page.getByText('Resume microphone', { exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as {
      __candidateMmiSpeech: { deny: () => void };
    }).__candidateMmiSpeech.deny();
  });
  await expect(page.getByText(/permission was denied/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your response transcript' })).toBeEditable();
});

test('MMI deadline stops speech and finalizes without early scoring or media', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  controller.selectExpiringResponse(1, '');
  controller.advanceTo(candidateResponseProjections[2]);
  await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

  await page.getByRole('textbox', { name: 'Your response transcript' })
    .fill('Last-seconds response');
  await page.getByText('Resume microphone', { exact: true }).click();
  await expect(page.getByText(/Listening/)).toBeVisible();
  await expect(page.getByText('Synthetic prompt 2.', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => controller.checkpoints().length).toBe(1);
  expect(controller.checkpoints()[0]).toMatchObject({
    p_transcript: 'Last-seconds response',
  });
  await expect.poll(() => controller.finalizations().length).toBe(1);
  expect(Object.keys(controller.finalizations()[0]).sort()).toEqual([
    'p_finalization_key',
    'p_prompt_order',
    'p_session_id',
  ]);
  expect(controller.finalizations()[0]).toMatchObject({
    p_session_id: candidateStationSessionId,
    p_prompt_order: 1,
  });
  await expect.poll(() => controller.scoringRequests().length).toBe(0);
  const nativeStops = await page.evaluate(() => (
    (window as unknown as {
      __candidateMmiSpeech: { counts: () => { stopCount: number } };
    }).__candidateMmiSpeech.counts().stopCount
  ));
  expect(nativeStops).toBeGreaterThanOrEqual(1);
});

test('MMI responses can be submitted early or deliberately skipped with softer readable type', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  controller.selectResponse(1);
  controller.advanceTo(Object.freeze({
    ...candidateResponseProjections[2],
    draftTranscript: 'Draft to discard by skipping',
    draftRevision: 2,
  }));
  await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

  const prompt = page.getByText('Synthetic prompt 1.', { exact: true });
  const transcript = page.getByRole('textbox', { name: 'Your response transcript' });
  const promptType = await prompt.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { family: computed.fontFamily, size: Number.parseFloat(computed.fontSize) };
  });
  expect(promptType.family).toContain('SourceSans3');
  expect(promptType.size).toBeGreaterThanOrEqual(20);
  await transcript.fill('A complete early response');
  await page.getByText('Submit answer now', { exact: true }).click();
  await expect(page.getByText('Synthetic prompt 2.', { exact: true })).toBeVisible();
  expect(controller.checkpoints()[0]).toMatchObject({
    p_prompt_order: 1,
    p_transcript: 'A complete early response',
  });

  await expect(page.getByRole('textbox', { name: 'Your response transcript' }))
    .toHaveValue('Draft to discard by skipping');
  controller.advanceTo(candidateResponseProjections[3]);
  await page.getByText('Skip question', { exact: true }).click();
  await expect(page.getByText('Synthetic prompt 3.', { exact: true })).toBeVisible();
  expect(controller.checkpoints()[1]).toMatchObject({
    p_prompt_order: 2,
    p_transcript: '',
  });
});

for (const action of ['submit', 'skip'] as const) {
  test(`MMI retry preserves a failed ${action} and its original transcript`, async ({ page }) => {
    const controller = await installCandidateMmiController(page);
    const answer = 'I would identify the immediate priority and escalate proportionately.';
    controller.selectResponse(1, action === 'skip' ? 'Previously saved draft to discard' : '', action === 'skip' ? 1 : 0);
    controller.advanceTo(candidateCompletedProjection);
    controller.failNextCheckpoint();
    await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

    const transcript = page.getByRole('textbox', { name: 'Your response transcript' });
    await expect(transcript).toHaveValue(action === 'skip' ? 'Previously saved draft to discard' : '');
    if (action === 'submit') await transcript.fill(answer);
    await page.getByRole('button', { name: action === 'submit' ? 'Submit answer now' : 'Skip question', exact: true }).click();

    await expect(page.getByText('The MMI station could not advance safely.', { exact: true })).toBeVisible();
    await expect(transcript).not.toBeEditable();
    expect(controller.finalizations()).toHaveLength(0);
    expect(controller.checkpoints()).toHaveLength(1);
    const originalFinalizationKey = await page.evaluate((id) => sessionStorage.getItem(`candidate-mmi-finalization:${id}:1`), candidateStationSessionId);
    expect(originalFinalizationKey).toMatch(/^[0-9a-f-]{36}$/i);

    await page.getByRole('button', { name: 'Retry advance', exact: true }).click();
    await expect(page.getByText('Station complete', { exact: true })).toBeVisible();
    await expect(page.getByText(`Question 1 · ${action === 'submit' ? 25 : 0}%`, { exact: true })).toBeVisible();
    expect(controller.checkpoints()).toHaveLength(2);
    expect(controller.checkpoints().map((request) => request.p_transcript)).toEqual(action === 'submit' ? [answer, answer] : ['', '']);
    expect(controller.finalizations()).toHaveLength(1);
    expect(controller.finalizations()[0]).toMatchObject({ p_prompt_order: 1, p_finalization_key: originalFinalizationKey });
    expect(controller.finalizedResponses()).toEqual([{ responseState: action === 'submit' ? 'response' : 'no_response', transcript: action === 'submit' ? answer : '' }]);
    expect(controller.scoringRequests().map((request) => request.promptOrder)).toEqual(action === 'submit' ? [1] : []);
  });
}

test('MMI deadline finalizes the saved draft after a failed submit without retrying late checkpoints', async ({ page }) => {
  await page.clock.install();
  const controller = await installCandidateMmiController(page);
  const savedDraft = 'I would identify the immediate priority.';
  const unsavedAnswer = `${savedDraft} I would also escalate proportionately.`;
  controller.selectResponse(1, savedDraft, 1);
  controller.advanceTo(candidateCompletedProjection);
  controller.failNextCheckpoint();
  await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);
  await page.getByRole('textbox', { name: 'Your response transcript' }).fill(unsavedAnswer);
  await page.getByRole('button', { name: 'Submit answer now', exact: true }).click();
  await expect(page.getByText('The MMI station could not advance safely.', { exact: true })).toBeVisible();
  expect(controller.checkpoints()).toHaveLength(1);
  expect(controller.finalizations()).toHaveLength(0);
  const originalFinalizationKey = await page.evaluate((id) => sessionStorage.getItem(`candidate-mmi-finalization:${id}:1`), candidateStationSessionId);

  controller.closeCheckpointWindow();
  await page.clock.fastForward(111_000);
  await expect(page.getByText('Station complete', { exact: true })).toBeVisible();
  await expect(page.getByText('Question 1 · 25%', { exact: true })).toBeVisible();
  expect(controller.checkpoints()).toHaveLength(1);
  expect(controller.finalizations()).toHaveLength(1);
  expect(controller.finalizations()[0]).toMatchObject({ p_finalization_key: originalFinalizationKey });
  expect(controller.finalizedResponses()).toEqual([{ responseState: 'response', transcript: savedDraft }]);
  await expect(page.getByRole('button', { name: 'Retry advance', exact: true })).toHaveCount(0);
});

test('MMI completion renders retained strict rubric-only feedback without re-scoring', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  controller.selectCompleted();
  await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

  await expect(page.getByText('Station complete', { exact: true })).toBeVisible();
  await expect(page.getByText('Question 1 · 25%', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await expect(page.getByText('Covered', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Identifies the immediate priority.', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Question 4 · 0%', { exact: true })).toBeVisible();
  await expect(page.getByText('Identifies the immediate priority.: 0/25', { exact: true })).toHaveCount(4);
  await expect(page.getByText('Demonstrated well', { exact: true })).toHaveCount(4);
  await expect(page.getByText(/Not demonstrated · 0% of criterion marks/)).toHaveCount(16);
  await expect(page.getByText('No supporting evidence identified in your answer.', { exact: true })).toHaveCount(16);
  await expect(page.getByText('No answer was recorded for this question, so this criterion was not demonstrated.', { exact: true })).toHaveCount(16);
  await expect(page.getByText('No response was saved. A compatible rubric result is unavailable for this question.')).toHaveCount(0);
  expect(controller.rpcCalls()).toContain('feedback');
  await expect.poll(() => controller.scoringRequests().length).toBe(0);
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`five-level feedback shows weighted marks and answer evidence at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const controller = await installCandidateMmiController(page);
    controller.selectCompleted();
    const evidenceQuote = "I acknowledged the patient's frustration and asked what worried them about treatment.";
    const justification = 'You acknowledged frustration and asked about the concern, but did not explore its impact or check understanding.';
    const feedback = [1, 2, 3, 4, 5].map((promptOrder) => {
      const levels = promptOrder === 2 ? [3, 3, 3, 3] : [0, 1, 2, 4];
      return {
        promptOrder, status: 'scored', legacy: false,
        assessment: {
          schemaVersion: 4, questionScorePct: promptOrder === 2 ? 75 : 43.75,
          criteria: levels.map((performanceLevel, index) => ({
            criterionId: `Q${promptOrder}_C${index + 1}`, performanceLevel, weightPct: 25,
            bulletText: ['Explore the concern', 'Explain the approach', 'Listen to concerns', 'Agree the next step'][index],
            domain: 'communication', evidenceQuote: performanceLevel === 0 ? null : evidenceQuote,
            justification: performanceLevel === 0 ? 'The answer did not explore the reason for the concern.' : justification,
          })),
        },
      };
    });
    await page.route('https://e2e.supabase.co/rest/v1/rpc/get_candidate_mmi_station_feedback', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(feedback),
    }));
    await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

    await expect(page.getByText('Question 1 · 43.75%', { exact: true })).toBeVisible();
    await expect(page.getByText('Listen to concerns: 12.5/25', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`From your answer: “${evidenceQuote}”`, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(justification, { exact: true }).first()).toBeVisible();
    for (const label of ['Not demonstrated', 'Mentioned only', 'Basic demonstration', 'Good demonstration', 'Excellent demonstration']) {
      await expect(page.getByText(new RegExp(`${label} ·`)).first()).toHaveCount(1);
    }
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    expect(controller.scoringRequests()).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath(`mmi-five-level-${viewport.width}.png`), fullPage: false });
  });
}

test('MMI completion explains when AI scoring is not configured', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  controller.failScoringWith('provider_not_configured');
  controller.selectCompleted();
  await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

  await expect(page.getByText('AI scoring is not configured yet.', { exact: true })).toBeVisible();
  await expect(page.getByText('Your station is saved. You can retry the evaluation without repeating it.'))
    .toHaveCount(0);
});

test('MMI partial feedback recovers transient failures and retries only unscored answers', async ({ page }, testInfo) => {
  const controller = await installCandidateMmiController(page);
  controller.selectPartialFeedback();
  controller.selectCompleted();
  await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

  await expect(page.getByText('Question 2 · 25%', { exact: true })).toBeVisible();
  await expect(page.getByText('Question 3 · 25%', { exact: true })).toBeVisible();
  await expect(page.getByText('Question 4', { exact: true })).toBeVisible();
  await expect(page.getByText('AI scoring could not complete for this answer. Retry AI scoring to try again.', { exact: true })).toBeVisible();
  expect(controller.peakScoring()).toBe(2);
  expect(controller.scoringRequests().filter(request => request.promptOrder === 1 || request.promptOrder === 5)).toHaveLength(0);
  expect(controller.scoringRequests().filter(request => request.promptOrder === 2)).toHaveLength(2);
  expect(controller.scoringRequests().filter(request => request.promptOrder === 4)).toHaveLength(2);

  controller.recoverPartialFailure();
  await page.getByRole('button', { name: 'Retry AI scoring', exact: true }).click();
  await expect(page.getByText('Question 4 · 25%', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry AI scoring', exact: true })).toHaveCount(0);
  expect(controller.scoringRequests().filter(request => request.promptOrder === 4)).toHaveLength(3);
  expect(controller.scoringRequests().filter(request => request.promptOrder === 2)).toHaveLength(2);
  await page.getByText('Question 2 · 25%', { exact: true }).evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: testInfo.outputPath('mmi-feedback-recovery.jpg'), fullPage: true });
});

test('MMI leave abandons exactly once from a current response and returns to practice', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  controller.selectResponse(1);
  await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

  await expect(page.getByText('Synthetic prompt 1.', { exact: true })).toBeVisible();
  await page.getByText('Leave', { exact: true }).click();
  await expect(page.getByText('Leave MMI station?', { exact: true })).toBeVisible();
  await page.getByText('Leave station', { exact: true }).click();
  await expect(page).toHaveURL(/\/practice$/);
  expect(controller.abandonCount()).toBe(1);
  expect(controller.rpcCalls()).toEqual(['get', 'abandon']);
  await expect(page.getByRole('textbox')).toHaveCount(0);
});

test('admin profile links directly to the station repository', async ({ page }) => {
  await page.goto('/profile');

  await page.getByText('Question Desk', { exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/stations$/);
  await expect(page.getByText('Station repository', { exact: true })).toBeVisible();
});

test('partner sends feedback, opens the MMI station, and signs out safely', async ({ page }) => {
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
  await expect(page.getByText('Oxford practice', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Practise' }).first().click();
  await expect(page.getByText('Check your setup', { exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Ready, Partner.')).toBeVisible();
  await page.getByRole('button', { name: /^profile$/i }).last().click();
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
  await expect(page.getByText('MMI practice', { exact: true })).toBeVisible();

  await page.goto('/admin/questions');
  await expect(page.getByText('Ready, Second.').last()).toBeVisible();
  await expect(page.getByText('Add practice questions')).toHaveCount(0);
});

test('admin opens the repository and reviews masked partner feedback', async ({ page }) => {
  await page.goto('/admin/questions');
  await expect(page).toHaveURL(/\/admin\/stations$/);
  await expect(page.getByText('Station repository', { exact: true })).toBeVisible();

  await page.goto('/admin/feedback');
  await expect(page.getByText('Partner field reports')).toBeVisible();
  await expect(page.getByText('The station submit state needed a clearer progress indicator.')).toBeVisible();
  await expect(page.getByText('FOLLOW-UP NOT REQUESTED')).toBeVisible();
  await expect(page.getByText(userId)).toHaveCount(0);
});

test('profile cancel discards the draft and recognizes a lowercase saved target', async ({ page }) => {
  let profileWrites = 0;
  await page.route('https://e2e.supabase.co/rest/v1/profiles**', route => {
    if (route.request().method() === 'PATCH') profileWrites++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...profile, university_target: 'oxford' }) });
  });
  await page.goto('/profile');
  await page.getByText('Edit', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Target university: Oxford', exact: true })).toBeChecked();
  await page.getByPlaceholder('Your full name', { exact: true }).fill('UNSAVED SYNTHETIC NAME');
  await page.getByText('Cambridge', { exact: true }).click();
  await page.getByText('Cancel', { exact: true }).click();
  await page.getByText('Edit', { exact: true }).click();
  await expect(page.getByPlaceholder('Your full name', { exact: true })).toHaveValue('Partner Tester');
  await expect(page.getByRole('radio', { name: 'Target university: Oxford', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Target university: Cambridge', exact: true })).not.toBeChecked();
  expect(profileWrites).toBe(0);
});

test('signed-out profile and station deep links lead to sign in', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const unsigned = await context.newPage();
  try {
    await installSupabaseMocks(unsigned);
    for (const path of ['/profile', '/practice/mmi-station', '/practice/mmi-station?sessionId=not-a-uuid']) {
      await unsigned.goto(path);
      await expect(unsigned.getByText('Enter the circuit', { exact: true })).toBeVisible();
      await expect(unsigned).toHaveURL(/\/login$/);
      await expect(unsigned.getByRole('button', { name: 'Start station', exact: true })).toHaveCount(0);
    }
  } finally { await context.close(); }
});

test('report confirmation focuses cancel and restores its keyboard launcher', async ({ page }) => {
  await page.goto('/cofounder-feedback');
  await page.getByPlaceholder(/What did you try/i).fill('Synthetic keyboard report that will not be sent.');
  const review = page.getByRole('button', { name: 'Review report', exact: true });
  await review.focus();
  await review.press('Enter');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send report', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(review).toBeFocused();
  await expect(page.getByPlaceholder(/What did you try/i)).toHaveValue('Synthetic keyboard report that will not be sent.');
  await page.getByPlaceholder(/What did you try/i).fill('');
});

test('report navigation asks before discarding and keeps an unsent draft on cancel', async ({ page }) => {
  await page.goto('/');
  await page.getByText('SEND FEEDBACK', { exact: true }).click();
  const message = page.getByPlaceholder(/What did you try/i);
  await message.fill('Synthetic draft must survive cancelled navigation.');
  await page.getByRole('button', { name: 'Back to orient', exact: true }).click();
  await expect(page.getByText('Discard this unsent report?', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(message).toHaveValue('Synthetic draft must survive cancelled navigation.');
  await page.getByRole('button', { name: 'Back to orient', exact: true }).click();
  await page.getByRole('button', { name: 'Discard report', exact: true }).click();
  await expect(page.getByText('Ready, Partner.', { exact: true }).filter({ visible: true })).toBeVisible();
});

test('pending report submission locks its draft and prevents duplicate sends or navigation', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let sends = 0;
  await page.route('https://e2e.supabase.co/rest/v1/rpc/submit_cofounder_feedback', async route => {
    sends++;
    await held;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feedbackId) });
  });
  await page.goto('/');
  await page.getByText('SEND FEEDBACK', { exact: true }).click();
  const message = page.getByPlaceholder(/What did you try/i);
  await message.fill('Synthetic draft A must remain locked while sending.');
  await page.getByRole('button', { name: 'Review report', exact: true }).click();
  try {
    await page.getByRole('button', { name: 'Send report', exact: true }).dblclick();
    await expect.poll(() => sends).toBe(1);
    await expect(page.getByRole('button', { name: 'Send report', exact: true })).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('button', { name: 'Send report', exact: true })).toBeDisabled();
    await expect(message).not.toBeEditable();
    await expect(page.getByRole('button', { name: 'Back to orient', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: /Allow a cofounder to follow up/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Bug', exact: true })).toBeDisabled();
    await expect(message).toHaveValue('Synthetic draft A must remain locked while sending.');
  } finally { release(); }
  await expect(page.getByText('Feedback received', { exact: true })).toBeVisible();
  await expect(message).toBeEditable();
  await expect(message).toHaveValue('');
  expect(sends).toBe(1);
});

test('sign-out confirmation focuses the safe action and cancellation restores focus', async ({ page }) => {
  await page.goto('/profile');
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  await signOut.focus();
  await signOut.press('Enter');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(signOut).toBeFocused();
  await expect(page.getByText('Partner Tester', { exact: true })).toBeVisible();
});


for (const size of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  for (const route of [
    { path: '/', ready: 'Ready, Partner.' },
    { path: '/practice', ready: 'MMI practice' },
    { path: '/progress', ready: 'Progress record' },
    { path: '/profile', ready: 'Partner Tester' },
    { path: '/cofounder-feedback', ready: 'Tell us what happened' },
  ]) {
    test(`signed-in accessibility ${route.path} at ${size.width}px`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(route.path);
      await expect(page.getByText(route.ready, { exact: true }).filter({ visible: true })).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(result.passes.length).toBeGreaterThan(0);
      expect(result.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })) ).toEqual([]);
    });
  }
}

test('browser Back keeps an unsent report until discard is confirmed', async ({ page }) => {
  await page.goto('/');
  await page.getByText('SEND FEEDBACK', { exact: true }).click();
  await page.getByPlaceholder(/What did you try/i).fill('Synthetic draft retained across browser Back.');
  await page.goBack();
  await expect(page.getByText('Discard this unsent report?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByPlaceholder(/What did you try/i)).toHaveValue('Synthetic draft retained across browser Back.');
  await page.getByRole('button', { name: 'Back to orient', exact: true }).click();
  await page.getByRole('button', { name: 'Discard report', exact: true }).click();
  await expect(page.getByText('Ready, Partner.', { exact: true }).filter({ visible: true })).toBeVisible();
});
