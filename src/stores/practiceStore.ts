import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { scoreAnswer } from '../lib/ai';
import { getQuestionById } from '../lib/questions';
import { restorePracticeSession } from '../features/practice/restoration';
import type { Answer, MockSession, Question, ScoreResult } from '../types';

interface PracticeState {
  accountEpoch: number;

  // Active session
  session: MockSession | null;
  currentQuestion: Question | null;
  answerText: string;

  // Feedback (after submit)
  scoreResult: ScoreResult | null;
  scoring: boolean;
  scoringError: string | null;

  // History
  sessionAnswers: (Answer & { score?: ScoreResult })[];

  setCurrentQuestion: (q: Question) => void;
  setAnswerText: (text: string) => void;
  startSession: (userId: string, question: Question) => Promise<string>; // returns sessionId
  restoreSession: (sessionId: string, questionId: string) => Promise<void>;
  submitAnswer: (sessionId: string, questionId: string) => Promise<void>;
  clearFeedback: () => void;

  // Progress data
  recentSessions: MockSession[];
  fetchRecentSessions: (userId: string) => Promise<void>;
  streakData: { date: string; practiced: boolean }[];
  fetchStreakData: (userId: string) => Promise<void>;
  dimensionAverages: Record<string, number>;
  fetchDimensionAverages: (userId: string) => Promise<void>;
  reset: () => void;
}

class StalePracticeRequestError extends Error {
  constructor() {
    super('This practice request is no longer active because the account changed.');
    this.name = 'StalePracticeRequestError';
  }
}

function assertCurrentAccountEpoch(currentEpoch: number, requestEpoch: number) {
  if (currentEpoch !== requestEpoch) throw new StalePracticeRequestError();
}

function emptyPracticeData() {
  return {
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
  } satisfies Pick<
    PracticeState,
    | 'session'
    | 'currentQuestion'
    | 'answerText'
    | 'scoreResult'
    | 'scoring'
    | 'scoringError'
    | 'sessionAnswers'
    | 'recentSessions'
    | 'streakData'
    | 'dimensionAverages'
  >;
}

export const usePracticeStore = create<PracticeState>((set, get) => ({
  ...emptyPracticeData(),
  accountEpoch: 0,

  setCurrentQuestion: (q) => set({ currentQuestion: q, answerText: '', scoreResult: null, scoringError: null }),
  setAnswerText: (text) => set({ answerText: text }),
  clearFeedback: () => set({ scoreResult: null, scoringError: null }),

  startSession: async (userId, question) => {
    const requestEpoch = get().accountEpoch;
    const { data, error } = await supabase
      .from('mock_sessions')
      .insert({
        user_id: userId,
        mode: 'practice',
        question_count: 1,
        category_filter: question.category,
      })
      .select()
      .single();
    assertCurrentAccountEpoch(get().accountEpoch, requestEpoch);
    if (error) throw error;
    set({ session: data as MockSession, currentQuestion: question, answerText: '' });
    return data.id;
  },

  restoreSession: async (sessionId, questionId) => {
    const requestEpoch = get().accountEpoch;
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    assertCurrentAccountEpoch(get().accountEpoch, requestEpoch);
    if (userError) throw userError;
    if (!user) throw new Error('Authentication is required to restore this session.');

    const restored = await restorePracticeSession({
      getOwnedSession: async (userId, ownedSessionId) => {
        const { data, error } = await supabase
          .from('mock_sessions')
          .select('*')
          .eq('id', ownedSessionId)
          .eq('user_id', userId)
          .maybeSingle();
        if (error) throw error;
        return data as MockSession | null;
      },
      getActiveQuestion: getQuestionById,
    }, { userId: user.id, sessionId, questionId });
    assertCurrentAccountEpoch(get().accountEpoch, requestEpoch);

    set({
      session: restored.session,
      currentQuestion: restored.question,
      answerText: '',
      scoreResult: null,
      scoringError: null,
    });
  },

  submitAnswer: async (sessionId, questionId) => {
    const requestEpoch = get().accountEpoch;
    const { answerText, currentQuestion } = get();
    if (!answerText.trim()) throw new Error('Please write an answer before submitting.');
    if (!currentQuestion || currentQuestion.id !== questionId) {
      throw new Error('The current question is unavailable.');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    assertCurrentAccountEpoch(get().accountEpoch, requestEpoch);
    if (userError) throw userError;
    if (!user) throw new Error('Authentication is required to submit an answer.');

    set({ scoring: true, scoringError: null });
    try {
      const result = await scoreAnswer({
        sessionId,
        questionId,
        answerText,
      });
      assertCurrentAccountEpoch(get().accountEpoch, requestEpoch);

      set({ scoreResult: result, scoring: false });
    } catch (error) {
      assertCurrentAccountEpoch(get().accountEpoch, requestEpoch);
      const message = error instanceof Error ? error.message : 'submission_failed';
      set({ scoring: false, scoringError: message });
      throw error;
    }
  },

  fetchRecentSessions: async (userId) => {
    const requestEpoch = get().accountEpoch;
    const { data } = await supabase
      .from('mock_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('completed', true)
      .order('started_at', { ascending: false })
      .limit(10);
    if (get().accountEpoch !== requestEpoch) return;
    set({ recentSessions: (data ?? []) as MockSession[] });
  },

  fetchStreakData: async (userId) => {
    const requestEpoch = get().accountEpoch;
    // Get last 30 days of session dates
    const since = new Date();
    since.setDate(since.getDate() - 29);
    const { data } = await supabase
      .from('mock_sessions')
      .select('started_at')
      .eq('user_id', userId)
      .gte('started_at', since.toISOString());
    if (get().accountEpoch !== requestEpoch) return;

    const practicedDates = new Set(
      (data ?? []).map(s => s.started_at.split('T')[0])
    );

    const streakData = Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      const dateStr = d.toISOString().split('T')[0];
      return { date: dateStr, practiced: practicedDates.has(dateStr) };
    });
    set({ streakData });
  },

  fetchDimensionAverages: async (userId) => {
    const requestEpoch = get().accountEpoch;
    const { data } = await supabase
      .from('scores')
      .select('structure, ethics, communication, reflection, nhs_awareness, answers!inner(user_id)')
      .eq('answers.user_id', userId)
      .limit(50);
    if (get().accountEpoch !== requestEpoch) return;

    if (!data?.length) {
      set({ dimensionAverages: {} });
      return;
    }
    const avg = (key: string) =>
      Math.round((data.reduce((s: number, r: any) => s + (r[key] ?? 0), 0) / data.length) * 10) / 10;

    set({
      dimensionAverages: {
        structure: avg('structure'),
        ethics: avg('ethics'),
        communication: avg('communication'),
        reflection: avg('reflection'),
        nhs_awareness: avg('nhs_awareness'),
      },
    });
  },

  reset: () => set(state => ({
    ...emptyPracticeData(),
    accountEpoch: state.accountEpoch + 1,
  })),
}));
