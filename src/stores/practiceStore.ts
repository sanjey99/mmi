import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { scoreAnswer } from '../lib/ai';
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

  submitAnswer: async (sessionId, questionId) => {
    const { answerText, currentQuestion } = get();
    if (!answerText.trim()) throw new Error('Please write an answer before submitting.');

    // 1. Save answer to DB
    const { data: answerData, error: answerError } = await supabase
      .from('answers')
      .insert({
        session_id: sessionId,
        question_id: questionId,
        user_id: (await supabase.auth.getUser()).data.user?.id,
        text: answerText,
      })
      .select()
      .single();
    if (answerError) throw answerError;

    // 2. Score with AI
    set({ scoring: true, scoringError: null });
    try {
      const result = await scoreAnswer(currentQuestion!.text, answerText);
      set({ scoreResult: result, scoring: false });

      // 3. Save score to DB
      await supabase.from('scores').insert({
        answer_id: answerData.id,
        structure: result.structure,
        ethics: result.ethics,
        communication: result.communication,
        reflection: result.reflection,
        nhs_awareness: result.nhs_awareness,
        overall_pct: result.overall_pct,
        ai_feedback: result.ai_feedback,
        improvement_tip: result.improvement_tip,
      });

      // 4. Update streak via DB function
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (userId) {
        await supabase.rpc('update_streak', { p_user_id: userId });
      }
    } catch (e: any) {
      set({ scoring: false, scoringError: e.message });
      throw e;
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
      .select('structure, ethics, communication, reflection, nhs_awareness')
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
