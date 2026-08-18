-- Capture and reconcile the canonical hosted MMI content schema.
-- This migration is intentionally additive: it must preserve curated content.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mmi_stations (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  station_id TEXT NOT NULL,
  category TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty public.question_difficulty NOT NULL DEFAULT 'intermediate',
  uni_tags TEXT[] DEFAULT '{}',
  prep_time_sec INTEGER NOT NULL DEFAULT 60,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scenario_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT mmi_stations_pkey PRIMARY KEY (id),
  CONSTRAINT mmi_stations_station_id_key UNIQUE (station_id)
);

CREATE TABLE IF NOT EXISTS public.mmi_sub_questions (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  sub_q_id TEXT NOT NULL,
  station_id TEXT NOT NULL,
  order_num INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  time_limit_sec INTEGER NOT NULL DEFAULT 120,
  model_answer_cached TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT mmi_sub_questions_pkey PRIMARY KEY (id),
  CONSTRAINT mmi_sub_questions_sub_q_id_key UNIQUE (sub_q_id),
  CONSTRAINT mmi_sub_questions_station_id_fkey
    FOREIGN KEY (station_id)
    REFERENCES public.mmi_stations (station_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.roleplay_stations (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  station_id TEXT NOT NULL,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty public.question_difficulty NOT NULL DEFAULT 'intermediate',
  uni_tags TEXT[] DEFAULT '{}',
  actor_persona TEXT NOT NULL,
  background_info TEXT NOT NULL,
  opening_line TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  category TEXT NOT NULL DEFAULT 'scenarios',
  prep_time_sec INTEGER NOT NULL DEFAULT 120,
  time_limit_sec INTEGER NOT NULL DEFAULT 300,
  CONSTRAINT roleplay_stations_pkey PRIMARY KEY (id),
  CONSTRAINT roleplay_stations_station_id_key UNIQUE (station_id)
);

-- The hosted table predates the Phase 4 role-play timing and category fields.
ALTER TABLE public.roleplay_stations
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'scenarios',
  ADD COLUMN IF NOT EXISTS prep_time_sec INTEGER DEFAULT 120,
  ADD COLUMN IF NOT EXISTS time_limit_sec INTEGER DEFAULT 300;

ALTER TABLE public.roleplay_stations
  ALTER COLUMN category SET DEFAULT 'scenarios',
  ALTER COLUMN prep_time_sec SET DEFAULT 120,
  ALTER COLUMN time_limit_sec SET DEFAULT 300;

UPDATE public.roleplay_stations
SET category = 'scenarios'
WHERE category IS NULL;

ALTER TABLE public.roleplay_stations
  ALTER COLUMN category SET NOT NULL,
  ALTER COLUMN prep_time_sec SET NOT NULL,
  ALTER COLUMN time_limit_sec SET NOT NULL;

COMMENT ON COLUMN public.roleplay_stations.category IS
  'Phase 4 backfills scenarios; curators must review categories before release.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mmi_stations'::regclass
      AND conname = 'mmi_stations_prep_time_positive'
  ) THEN
    ALTER TABLE public.mmi_stations
      ADD CONSTRAINT mmi_stations_prep_time_positive
      CHECK (prep_time_sec > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mmi_stations'::regclass
      AND conname = 'mmi_stations_status_check'
  ) THEN
    ALTER TABLE public.mmi_stations
      ADD CONSTRAINT mmi_stations_status_check
      CHECK (status IN ('draft', 'published')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mmi_sub_questions'::regclass
      AND conname = 'mmi_sub_questions_station_order_key'
  ) THEN
    ALTER TABLE public.mmi_sub_questions
      ADD CONSTRAINT mmi_sub_questions_station_order_key
      UNIQUE (station_id, order_num);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mmi_sub_questions'::regclass
      AND conname = 'mmi_sub_questions_time_limit_positive'
  ) THEN
    ALTER TABLE public.mmi_sub_questions
      ADD CONSTRAINT mmi_sub_questions_time_limit_positive
      CHECK (time_limit_sec > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.roleplay_stations'::regclass
      AND conname = 'roleplay_stations_prep_time_positive'
  ) THEN
    ALTER TABLE public.roleplay_stations
      ADD CONSTRAINT roleplay_stations_prep_time_positive
      CHECK (prep_time_sec > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.roleplay_stations'::regclass
      AND conname = 'roleplay_stations_time_limit_positive'
  ) THEN
    ALTER TABLE public.roleplay_stations
      ADD CONSTRAINT roleplay_stations_time_limit_positive
      CHECK (time_limit_sec > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.roleplay_stations'::regclass
      AND conname = 'roleplay_stations_status_check'
  ) THEN
    ALTER TABLE public.roleplay_stations
      ADD CONSTRAINT roleplay_stations_status_check
      CHECK (status IN ('draft', 'published')) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.mmi_stations
  VALIDATE CONSTRAINT mmi_stations_prep_time_positive;
ALTER TABLE public.mmi_stations
  VALIDATE CONSTRAINT mmi_stations_status_check;
ALTER TABLE public.mmi_sub_questions
  VALIDATE CONSTRAINT mmi_sub_questions_time_limit_positive;
ALTER TABLE public.roleplay_stations
  VALIDATE CONSTRAINT roleplay_stations_prep_time_positive;
ALTER TABLE public.roleplay_stations
  VALIDATE CONSTRAINT roleplay_stations_time_limit_positive;
ALTER TABLE public.roleplay_stations
  VALIDATE CONSTRAINT roleplay_stations_status_check;

CREATE INDEX IF NOT EXISTS idx_mmi_stations_published
  ON public.mmi_stations (status)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_mmi_stations_category
  ON public.mmi_stations (category)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_mmi_stations_difficulty
  ON public.mmi_stations (difficulty)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_mmi_stations_university
  ON public.mmi_stations USING GIN (uni_tags);

CREATE INDEX IF NOT EXISTS idx_mmi_sub_questions_station
  ON public.mmi_sub_questions (station_id);
CREATE INDEX IF NOT EXISTS idx_mmi_sub_questions_station_order
  ON public.mmi_sub_questions (station_id, order_num);

CREATE INDEX IF NOT EXISTS idx_roleplay_stations_published
  ON public.roleplay_stations (status)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_roleplay_stations_category
  ON public.roleplay_stations (category)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_roleplay_stations_difficulty
  ON public.roleplay_stations (difficulty)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_roleplay_stations_university
  ON public.roleplay_stations USING GIN (uni_tags);

ALTER TABLE public.mmi_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_sub_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roleplay_stations ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.mmi_stations
  TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.mmi_sub_questions
  TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.roleplay_stations
  TO postgres, anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mmi_stations'
      AND policyname = 'mmi_stations_admin'
  ) THEN
    CREATE POLICY mmi_stations_admin
      ON public.mmi_stations
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM public.profiles
          WHERE profiles.id = auth.uid()
            AND profiles.is_admin = TRUE
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mmi_stations'
      AND policyname = 'mmi_stations_read'
  ) THEN
    CREATE POLICY mmi_stations_read
      ON public.mmi_stations
      FOR SELECT
      USING (auth.role() = 'authenticated' AND status = 'published');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mmi_sub_questions'
      AND policyname = 'mmi_sub_questions_admin'
  ) THEN
    CREATE POLICY mmi_sub_questions_admin
      ON public.mmi_sub_questions
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM public.profiles
          WHERE profiles.id = auth.uid()
            AND profiles.is_admin = TRUE
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mmi_sub_questions'
      AND policyname = 'mmi_sub_questions_read'
  ) THEN
    CREATE POLICY mmi_sub_questions_read
      ON public.mmi_sub_questions
      FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'roleplay_stations'
      AND policyname = 'roleplay_stations_admin'
  ) THEN
    CREATE POLICY roleplay_stations_admin
      ON public.roleplay_stations
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM public.profiles
          WHERE profiles.id = auth.uid()
            AND profiles.is_admin = TRUE
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'roleplay_stations'
      AND policyname = 'roleplay_stations_read'
  ) THEN
    CREATE POLICY roleplay_stations_read
      ON public.roleplay_stations
      FOR SELECT
      USING (auth.role() = 'authenticated' AND status = 'published');
  END IF;
END;
$$;

COMMIT;
