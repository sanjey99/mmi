import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { scoreAnswer } from '../lib/ai';
import { getQuestionById } from '../lib/questions';
import { restorePracticeSession } from '../features/practice/restoration';
import { submitLegacyAnswer } from '../features/practice/submission';
import type { Answer, MockSession, Question, ScoreResult } from '../types';

interface PracticeState {
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
  endSession: (sessionId: string) => Promise<void>;
  clearFeedback: () => void;

  // Progress data
  recentSessions: MockSession[];
  fetchRecentSessions: (userId: string) => Promise<void>;
  streakData: { date: string; practiced: boolean }[];
  fetchStreakData: (userId: string) => Promise<void>;
  dimensionAverages: Record<string, number>;
  fetchDimensionAverages: (userId: string) => Promise<void>;
}

export const usePracticeStore = create<PracticeState>((set, get) => ({
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

  setCurrentQuestion: (q) => set({ currentQuestion: q, answerText: '', scoreResult: null, scoringError: null }),
  setAnswerText: (text) => set({ answerText: text }),
  clearFeedback: () => set({ scoreResult: null, scoringError: null }),

  startSession: async (userId, question) => {
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
    if (error) throw error;
    set({ session: data as MockSession, currentQuestion: question, answerText: '' });
    return data.id;
  },

  restoreSession: async (sessionId, questionId) => {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
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

    set({
      session: restored.session,
      currentQuestion: restored.question,
      answerText: '',
      scoreResult: null,
      scoringError: null,
    });
  },

  submitAnswer: async (sessionId, questionId) => {
    const { answerText, currentQuestion } = get();
    if (!answerText.trim()) throw new Error('Please write an answer before submitting.');
    if (!currentQuestion) throw new Error('The current question is unavailable.');

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error('Authentication is required to submit an answer.');

    set({ scoring: true, scoringError: null });
    try {
      const result = await submitLegacyAnswer({
        findAnswer: async (identity) => {
          const { data, error } = await supabase
            .from('answers')
            .select('id, text')
            .eq('session_id', identity.sessionId)
            .eq('question_id', identity.questionId)
            .eq('user_id', identity.userId)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (error) throw error;
          return data;
        },
        createAnswer: async (input) => {
          const { data, error } = await supabase
            .from('answers')
            .insert({
              session_id: input.sessionId,
              question_id: input.questionId,
              user_id: input.userId,
              text: input.text,
            })
            .select('id, text')
            .single();
          if (error) throw error;
          return data;
        },
        findScore: async (answerId) => {
          const { data, error } = await supabase
            .from('scores')
            .select('structure, ethics, communication, reflection, nhs_awareness, overall_pct, ai_feedback, improvement_tip')
            .eq('answer_id', answerId)
            .limit(1)
            .maybeSingle();
          if (error) throw error;
          return data as ScoreResult | null;
        },
        createScore: async (answerId, score) => {
          const { error } = await supabase.from('scores').insert({
            answer_id: answerId,
            structure: score.structure,
            ethics: score.ethics,
            communication: score.communication,
            reflection: score.reflection,
            nhs_awareness: score.nhs_awareness,
            overall_pct: score.overall_pct,
            ai_feedback: score.ai_feedback,
            improvement_tip: score.improvement_tip,
          });
          if (error) throw error;
        },
        finalizeSession: async (ownedSessionId, score) => {
          const { error: sessionError } = await supabase
            .from('mock_sessions')
            .update({ total_score_pct: score.overall_pct })
            .eq('id', ownedSessionId)
            .eq('user_id', user.id);
          if (sessionError) throw sessionError;

          const { error: streakError } = await supabase.rpc('update_streak', { p_user_id: user.id });
          if (streakError) throw streakError;
        },
        scoreAnswer,
      }, {
        userId: user.id,
        sessionId,
        questionId,
        questionText: currentQuestion.text,
        answerText,
      });

      set({ scoreResult: result, scoring: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'submission_failed';
      set({ scoring: false, scoringError: message });
      throw error;
    }
  },

  endSession: async (sessionId) => {
    await supabase
      .from('mock_sessions')
      .update({ ended_at: new Date().toISOString(), completed: true })
      .eq('id', sessionId);
    set({ session: null });
  },

  fetchRecentSessions: async (userId) => {
    const { data } = await supabase
      .from('mock_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('completed', true)
      .order('started_at', { ascending: false })
      .limit(10);
    set({ recentSessions: (data ?? []) as MockSession[] });
  },

  fetchStreakData: async (userId) => {
    // Get last 30 days of session dates
    const since = new Date();
    since.setDate(since.getDate() - 29);
    const { data } = await supabase
      .from('mock_sessions')
      .select('started_at')
      .eq('user_id', userId)
      .gte('started_at', since.toISOString());

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
    const { data } = await supabase
      .from('scores')
      .select('structure, ethics, communication, reflection, nhs_awareness, answers!inner(user_id)')
      .eq('answers.user_id', userId)
      .limit(50);

    if (!data?.length) return;
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
}));
