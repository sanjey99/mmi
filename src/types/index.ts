// ── Database types ───────────────────────────────────────────────────────────

export type QuestionCategory =
  | 'motivation'
  | 'ethics'
  | 'nhs'
  | 'teamwork'
  | 'resilience'
  | 'scenarios';

export type QuestionDifficulty = 'foundation' | 'intermediate' | 'advanced';

export type SessionMode = 'practice' | 'timed' | 'mmi_circuit';

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  university_target: string | null;
  entry_year: number | null;
  daily_goal: number;
  streak_current: number;
  streak_longest: number;
  streak_last_date: string | null;
  onboarding_complete: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  category: QuestionCategory;
  subcategory: string | null;
  text: string;
  guidance_notes: string | null;
  university_tags: string[];
  difficulty: QuestionDifficulty;
  is_mmi_suitable: boolean;
  times_attempted: number;
  avg_score: number;
  created_at: string;
}

export interface MockSession {
  id: string;
  user_id: string;
  mode: SessionMode;
  category_filter: QuestionCategory | null;
  question_count: number;
  started_at: string;
  ended_at: string | null;
  total_score_pct: number | null;
  completed: boolean;
}

export interface Answer {
  id: string;
  session_id: string;
  question_id: string;
  text: string;
  created_at: string;
  question?: Question;
  score?: ScoreRecord;
}

export interface ScoreRecord {
  id: string;
  answer_id: string;
  structure: number;
  ethics: number;
  communication: number;
  reflection: number;
  nhs_awareness: number;
  overall_pct: number;
  ai_feedback: string;
  improvement_tip: string;
  created_at: string;
}

// ── AI adapter types ──────────────────────────────────────────────────────────

export type AIProvider = 'anthropic' | 'openai' | 'openai_compatible';

export interface AIConfig {
  provider: AIProvider;
  api_key: string;
  model: string;
  base_url: string | null; // only for openai_compatible
}

export interface ScoreResult {
  structure: number;      // 1–5
  ethics: number;
  communication: number;
  reflection: number;
  nhs_awareness: number;
  overall_pct: number;    // 0–100
  ai_feedback: string;
  improvement_tip: string;
}

// ── Navigation types ──────────────────────────────────────────────────────────

export interface PracticeSessionParams {
  sessionId: string;
  questionId: string;
  questionNumber: number;
  totalQuestions: number;
  category?: QuestionCategory;
  timedMode?: boolean;
  timeLimitSeconds?: number;
}
