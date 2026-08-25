import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock('../src/lib/ai', () => ({ scoreAnswer: vi.fn() }));
vi.mock('../src/lib/questions', () => ({ getQuestionById: vi.fn() }));

import { supabase } from '../src/lib/supabase';
import { scoreAnswer } from '../src/lib/ai';
import { getQuestionById } from '../src/lib/questions';
import { usePracticeStore } from '../src/stores/practiceStore';
import type { MockSession, Question, ScoreResult } from '../src/types';

const session = { id: 'session-a', user_id: 'user-a' } as MockSession;
const secondSession = { id: 'session-b', user_id: 'user-b' } as MockSession;
const question = { id: 'question-a', text: 'Private prompt' } as Question;
const secondQuestion = { id: 'question-b', text: 'User B prompt' } as Question;
const score = { overall_pct: 72, ai_feedback: 'Private feedback' } as ScoreResult;
const secondScore = { overall_pct: 64, ai_feedback: 'User B feedback' } as ScoreResult;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createDeferredQuery<T>() {
  let resolve!: (value: { data: T }) => void;
  const promise = new Promise<{ data: T }>(resolvePromise => {
    resolve = resolvePromise;
  });
  const query = {
    select: vi.fn(() => query),
    insert: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    gte: vi.fn(() => query),
    single: vi.fn(() => query),
    maybeSingle: vi.fn(() => query),
    then: promise.then.bind(promise),
  };

  return { query, resolve };
}

describe('practiceStore account isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePracticeStore.setState({
      session,
      currentQuestion: question,
      answerText: 'Private answer from user A',
      scoreResult: score,
      scoring: true,
      scoringError: 'private error',
      sessionAnswers: [{ text: 'private history' } as never],
      recentSessions: [session],
      streakData: [{ date: '2026-08-25', practiced: true }],
      dimensionAverages: { ethics: 4.2 },
    });
  });

  it('clears every account-bound practice value with one reset', () => {
    usePracticeStore.getState().reset();

    expect(usePracticeStore.getState()).toMatchObject({
      session: null,
      currentQuestion: null,
      answerText: '',
      scoreResult: null,
      scoring: false,
      scoringError: null,
      sessionAnswers: [],
      recentSessions: [],
      streakData: [],
      dimensionAverages: {},
    });
  });

  it('discards progress responses that finish after an account reset', async () => {
    const recent = createDeferredQuery<MockSession[]>();
    const streak = createDeferredQuery<{ started_at: string }[]>();
    const dimensions = createDeferredQuery<Record<string, number>[]>();
    vi.mocked(supabase.from)
      .mockReturnValueOnce(recent.query as never)
      .mockReturnValueOnce(streak.query as never)
      .mockReturnValueOnce(dimensions.query as never);

    const requests = [
      usePracticeStore.getState().fetchRecentSessions('user-a'),
      usePracticeStore.getState().fetchStreakData('user-a'),
      usePracticeStore.getState().fetchDimensionAverages('user-a'),
    ];

    usePracticeStore.getState().reset();
    usePracticeStore.setState({
      recentSessions: [secondSession],
      streakData: [{ date: '2026-08-25', practiced: false }],
      dimensionAverages: { ethics: 2.5 },
    });

    recent.resolve({ data: [session] });
    streak.resolve({ data: [{ started_at: '2026-08-25T00:00:00.000Z' }] });
    dimensions.resolve({
      data: [{ structure: 5, ethics: 5, communication: 5, reflection: 5, nhs_awareness: 5 }],
    });
    await Promise.all(requests);

    expect(usePracticeStore.getState()).toMatchObject({
      recentSessions: [secondSession],
      streakData: [{ date: '2026-08-25', practiced: false }],
      dimensionAverages: { ethics: 2.5 },
    });
  });

  it('rejects stale session creation before its caller can navigate', async () => {
    const insertion = createDeferredQuery<MockSession>();
    vi.mocked(supabase.from).mockReturnValueOnce(insertion.query as never);

    const request = usePracticeStore.getState().startSession('user-a', question);
    usePracticeStore.getState().reset();
    usePracticeStore.setState({ session: secondSession, currentQuestion: secondQuestion });
    insertion.resolve({ data: session });

    await expect(request).rejects.toThrow(/practice request is no longer active/i);
    expect(usePracticeStore.getState()).toMatchObject({
      session: secondSession,
      currentQuestion: secondQuestion,
    });
  });

  it('rejects stale restoration without replacing the new account session', async () => {
    const restoration = createDeferredQuery<MockSession | null>();
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'user-a' } },
      error: null,
    } as never);
    vi.mocked(supabase.from).mockReturnValueOnce(restoration.query as never);
    vi.mocked(getQuestionById).mockResolvedValue(question);

    const request = usePracticeStore.getState().restoreSession(session.id, question.id);
    await vi.waitFor(() => expect(supabase.from).toHaveBeenCalledWith('mock_sessions'));
    usePracticeStore.getState().reset();
    usePracticeStore.setState({ session: secondSession, currentQuestion: secondQuestion });
    restoration.resolve({ data: session });

    await expect(request).rejects.toThrow(/practice request is no longer active/i);
    expect(usePracticeStore.getState()).toMatchObject({
      session: secondSession,
      currentQuestion: secondQuestion,
    });
  });

  it('rejects stale scoring without exposing the old account feedback', async () => {
    const scoring = createDeferred<ScoreResult>();
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'user-a' } },
      error: null,
    } as never);
    vi.mocked(scoreAnswer).mockReturnValue(scoring.promise);

    const request = usePracticeStore.getState().submitAnswer(session.id, question.id);
    await vi.waitFor(() => expect(scoreAnswer).toHaveBeenCalledOnce());
    usePracticeStore.getState().reset();
    usePracticeStore.setState({
      session: secondSession,
      currentQuestion: secondQuestion,
      answerText: 'User B answer',
      scoreResult: secondScore,
    });
    scoring.resolve(score);

    await expect(request).rejects.toThrow(/practice request is no longer active/i);
    expect(usePracticeStore.getState()).toMatchObject({
      session: secondSession,
      currentQuestion: secondQuestion,
      answerText: 'User B answer',
      scoreResult: secondScore,
    });
  });
});
