-- ============================================================
-- Interview Station — Initial Schema
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── ENUMS ──────────────────────────────────────────────────

CREATE TYPE question_category AS ENUM (
  'motivation', 'ethics', 'nhs', 'teamwork', 'resilience', 'scenarios'
);

CREATE TYPE question_difficulty AS ENUM (
  'foundation', 'intermediate', 'advanced'
);

CREATE TYPE session_mode AS ENUM (
  'practice', 'timed', 'mmi_circuit'
);

-- ── PROFILES ───────────────────────────────────────────────

CREATE TABLE public.profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name           TEXT NOT NULL DEFAULT '',
  avatar_url          TEXT,
  university_target   TEXT,
  entry_year          INTEGER,
  daily_goal          INTEGER DEFAULT 5,
  streak_current      INTEGER DEFAULT 0,
  streak_longest      INTEGER DEFAULT 0,
  streak_last_date    DATE,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  is_admin            BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── QUESTIONS ──────────────────────────────────────────────

CREATE TABLE public.questions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category        question_category NOT NULL,
  subcategory     TEXT,
  text            TEXT NOT NULL,
  guidance_notes  TEXT,
  university_tags TEXT[] DEFAULT '{}',
  difficulty      question_difficulty NOT NULL DEFAULT 'intermediate',
  is_mmi_suitable BOOLEAN DEFAULT FALSE,
  is_active       BOOLEAN DEFAULT TRUE,
  times_attempted INTEGER DEFAULT 0,
  avg_score       NUMERIC(4,2) DEFAULT 0.00,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_questions_category   ON public.questions(category) WHERE is_active = TRUE;
CREATE INDEX idx_questions_difficulty ON public.questions(difficulty) WHERE is_active = TRUE;
CREATE INDEX idx_questions_university ON public.questions USING GIN (university_tags);

-- ── 2 SEED QUESTIONS (placeholder — admin adds more via CSV) ──

INSERT INTO public.questions (category, subcategory, text, difficulty, university_tags, is_mmi_suitable)
VALUES
  (
    'ethics',
    'clinical_scenarios',
    'A 16-year-old patient requests contraception without parental consent. How would you approach this situation, and what ethical principles guide your reasoning?',
    'intermediate',
    ARRAY['oxford', 'cambridge', 'ucl', 'imperial', 'kings'],
    TRUE
  ),
  (
    'motivation',
    'why_medicine',
    'Tell me about a time you witnessed healthcare in action — either through work experience, personal experience, or observation — and what it taught you about medicine as a career.',
    'foundation',
    ARRAY['oxford', 'cambridge', 'ucl', 'imperial', 'kings'],
    FALSE
  );

-- ── MOCK SESSIONS ───────────────────────────────────────────

CREATE TABLE public.mock_sessions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode                session_mode NOT NULL DEFAULT 'practice',
  category_filter     question_category,
  question_count      INTEGER NOT NULL DEFAULT 1,
  started_at          TIMESTAMPTZ DEFAULT NOW(),
  ended_at            TIMESTAMPTZ,
  total_score_pct     NUMERIC(5,2),
  completed           BOOLEAN DEFAULT FALSE,
  mmi_station_count   INTEGER,
  mmi_time_per_station INTEGER
);

CREATE INDEX idx_sessions_user ON public.mock_sessions(user_id, started_at DESC);

-- ── ANSWERS ─────────────────────────────────────────────────

CREATE TABLE public.answers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES public.mock_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_answers_session  ON public.answers(session_id);
CREATE INDEX idx_answers_user     ON public.answers(user_id, created_at DESC);

-- ── SCORES ──────────────────────────────────────────────────

CREATE TABLE public.scores (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  answer_id       UUID NOT NULL UNIQUE REFERENCES public.answers(id) ON DELETE CASCADE,
  structure       SMALLINT NOT NULL CHECK (structure BETWEEN 1 AND 5),
  ethics          SMALLINT NOT NULL CHECK (ethics BETWEEN 1 AND 5),
  communication   SMALLINT NOT NULL CHECK (communication BETWEEN 1 AND 5),
  reflection      SMALLINT NOT NULL CHECK (reflection BETWEEN 1 AND 5),
  nhs_awareness   SMALLINT NOT NULL CHECK (nhs_awareness BETWEEN 1 AND 5),
  overall_pct     NUMERIC(5,2) NOT NULL,
  ai_feedback     TEXT NOT NULL DEFAULT '',
  improvement_tip TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── APP CONFIG (AI provider + admin settings) ───────────────

CREATE TABLE public.app_config (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default AI config rows (admin fills values in-app)
INSERT INTO public.app_config (key, value) VALUES
  ('ai_provider',  'anthropic'),
  ('ai_model',     'claude-3-5-haiku-20241022'),
  ('ai_base_url',  NULL),
  ('ai_api_key',   NULL);   -- filled via admin panel, stored encrypted

-- ── ROW LEVEL SECURITY ──────────────────────────────────────

ALTER TABLE public.profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config     ENABLE ROW LEVEL SECURITY;

-- profiles: users see/edit only their own
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- questions: all authenticated users can read active questions
CREATE POLICY "questions_select_active" ON public.questions FOR SELECT
  USING (auth.role() = 'authenticated' AND is_active = TRUE);

-- questions: only admins can insert/update/delete
CREATE POLICY "questions_admin_write" ON public.questions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- sessions: own data only
CREATE POLICY "sessions_own" ON public.mock_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "answers_own"  ON public.answers       FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "scores_select_own" ON public.scores FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.answers a WHERE a.id = answer_id AND a.user_id = auth.uid()));
CREATE POLICY "scores_insert_own" ON public.scores FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.answers a WHERE a.id = answer_id AND a.user_id = auth.uid()));

-- app_config: admins read/write; authenticated users read non-secret keys
CREATE POLICY "config_read_public" ON public.app_config FOR SELECT
  USING (auth.role() = 'authenticated' AND key != 'ai_api_key');
CREATE POLICY "config_admin_all" ON public.app_config FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ── STREAK UPDATE FUNCTION ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_streak(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_last DATE;
  v_today DATE := CURRENT_DATE;
  v_current INT;
  v_longest INT;
BEGIN
  SELECT streak_current, streak_longest, streak_last_date
  INTO v_current, v_longest, v_last
  FROM public.profiles WHERE id = p_user_id;

  IF v_last = v_today THEN
    RETURN; -- already updated today
  ELSIF v_last = v_today - INTERVAL '1 day' THEN
    v_current := v_current + 1;
  ELSE
    v_current := 1; -- streak broken, restart
  END IF;

  UPDATE public.profiles SET
    streak_current   = v_current,
    streak_longest   = GREATEST(v_longest, v_current),
    streak_last_date = v_today,
    updated_at       = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
