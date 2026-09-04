import { expect, test, type Page } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';
const questionId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const feedbackId = '44444444-4444-4444-8444-444444444444';
const candidateStationSessionId = '66666666-6666-4666-8666-666666666666';
const candidateStationId = 'MMI_001';
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
  const rpcCalls: string[] = [];
  const checkpoints: Array<Record<string, unknown>> = [];
  const finalizations: Array<Record<string, unknown>> = [];
  const scoringRequests: Array<Record<string, unknown>> = [];
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  const dimension = Object.freeze({
    score: 4,
    applicable: true,
    evidence: 'The response identified the immediate priority.',
    improvement: 'Make the escalation threshold more explicit.',
  });
  const assessment = Object.freeze({
    dimensions: Object.freeze({
      structure: dimension,
      ethics: dimension,
      communication: dimension,
      reflection: dimension,
      nhs_awareness: dimension,
    }),
    overallPct: 80,
    strengths: ['Clear prioritisation and a safe first action.'],
    improvements: ['State when senior support is required.'],
    improvementTip: 'Name the escalation trigger before closing your response.',
    rubricVersion: 1,
  });
  const feedback = Object.freeze([
    Object.freeze({ promptOrder: 1, status: 'scored', assessment }),
    ...([2, 3, 4, 5] as const).map(promptOrder => Object.freeze({
      promptOrder,
      status: 'no_response',
      assessment: null,
    })),
  ]);

  // Registered after the default route: Playwright's reverse matching gives
  // this candidate-only controller precedence without widening the wildcard.
  await page.route('https://e2e.supabase.co/rest/v1/app_config**', route => (
    route.fulfill(json({ key: 'normalized_mmi_station_enabled', value: 'true' }))
  ));
  await page.route('https://e2e.supabase.co/rest/v1/rpc/start_candidate_mmi_station_session', route => {
    rpcCalls.push('start');
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
    const result = {
      sessionId: body.p_session_id,
      promptOrder: body.p_prompt_order,
      responseState,
      finalizedAt: '2026-08-26T00:03:00.000Z',
      scoringStatus: responseState === 'response' ? 'pending' : 'no_response',
    };
    currentProjection = nextAfterFinalization;
    return route.fulfill(json(result));
  });
  await page.route('https://e2e.supabase.co/rest/v1/rpc/get_candidate_mmi_station_feedback', route => {
    rpcCalls.push('feedback');
    return route.fulfill(json(feedback));
  });
  await page.route('https://e2e.supabase.co/rest/v1/rpc/abandon_candidate_mmi_station_session', route => {
    rpcCalls.push('abandon');
    abandonCount += 1;
    return route.fulfill(json({}));
  });
  await page.route('https://e2e.supabase.co/functions/v1/score-candidate-mmi-response', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    scoringRequests.push(body);
    if (scoringFailureCode) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: scoringFailureCode }),
      });
    }
    return route.fulfill(json({ status: 'scored', assessment }));
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
    failScoringWith: (code: string) => { scoringFailureCode = code; },
    abandonCount: () => abandonCount,
    rpcCalls: () => [...rpcCalls],
    checkpoints: () => [...checkpoints],
    finalizations: () => [...finalizations],
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

test('practice presents one 11-minute MMI station without a flat question chooser', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('02 Practise').click();

  await expect(page.getByText('11-minute MMI station', { exact: true })).toBeVisible();
  await expect(page.getByText('One-minute brief, followed by five two-minute questions.', { exact: true }))
    .toBeVisible();
  await expect(page.getByText('Ethics', { exact: true })).toHaveCount(0);
  await page.getByText('Enter station', { exact: true }).click();
  await expect(page).toHaveURL(/\/practice\/mmi-station$/);
  await expect(page.getByText('Check your setup', { exact: true })).toBeVisible();
});

test('MMI station follows only the current trusted prompt across timer expiry and re-entry', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  await page.goto('/');
  await page.getByLabel('02 Practise').click();

  await page.getByText('Enter station', { exact: true }).click();
  await expect(page).toHaveURL(/\/practice\/mmi-station$/);
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
  await expect(page.getByText(/0:0[01]/)).toBeVisible();

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
  expect(controller.rpcCalls().filter(call => call === 'start' || call === 'get'))
    .toEqual(['start', 'get', 'get', 'get', 'get', 'get', 'get', 'get', 'get']);
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

test('MMI completion starts all five scores and renders ordered transcript-only feedback', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  controller.selectCompleted();
  await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

  await expect(page.getByText('Station complete', { exact: true })).toBeVisible();
  await expect(page.getByText('Overall score · 80%', { exact: true })).toBeVisible();
  await expect(page.getByText('Improvement tip', { exact: true })).toBeVisible();
  const responseCards = page.getByText(/^Response [1-5]$/);
  await expect(responseCards).toHaveCount(5);
  const firstBox = await responseCards.nth(0).boundingBox();
  const lastBox = await responseCards.nth(4).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(lastBox).not.toBeNull();
  expect(firstBox!.y).toBeLessThan(lastBox!.y);
  expect(controller.rpcCalls()).toContain('feedback');
  await expect.poll(() => controller.scoringRequests().length).toBe(5);
  expect(controller.scoringRequests()).toEqual(
    ([1, 2, 3, 4, 5] as const).map(promptOrder => ({
      sessionId: candidateStationSessionId,
      promptOrder,
    })),
  );
});

test('MMI completion explains when AI scoring is not configured', async ({ page }) => {
  const controller = await installCandidateMmiController(page);
  controller.failScoringWith('provider_not_configured');
  controller.selectCompleted();
  await page.goto(`/practice/mmi-station?sessionId=${candidateStationSessionId}`);

  await expect(page.getByText('AI scoring is not configured yet.', { exact: true })).toBeVisible();
  await expect(page.getByText('Your station is saved. You can retry the evaluation without repeating it.'))
    .toHaveCount(0);
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

test('admin profile links directly to the Question Desk', async ({ page }) => {
  await page.goto('/profile');

  await page.getByText('Question Desk', { exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/questions$/);
  await expect(page.getByText('Add practice questions')).toBeVisible();
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
  await expect(page.getByText('11-minute MMI station', { exact: true })).toBeVisible();
  await page.getByText('Enter station', { exact: true }).click();
  await expect(page.getByText('Check your setup', { exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Ready, Partner.')).toBeVisible();
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
  await expect(page.getByText('MMI practice', { exact: true })).toBeVisible();

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
