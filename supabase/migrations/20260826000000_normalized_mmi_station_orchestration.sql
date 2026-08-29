-- Forward-only normalized candidate MMI station orchestration.
-- Private source content arrives only through service-role RPCs; this file
-- contains identities, counts, timing, and digests only.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.mmi_stations') IS NULL
    OR to_regclass('public.mmi_sub_questions') IS NULL
    OR to_regclass('public.questions') IS NULL
    OR to_regclass('public.question_import_batches') IS NULL
    OR to_regclass('public.app_config') IS NULL THEN
    RAISE EXCEPTION 'normalized candidate MMI station prerequisites are missing';
  END IF;
END;
$$;

ALTER TABLE public.mmi_stations
  ADD COLUMN IF NOT EXISTS source_namespace text,
  ADD COLUMN IF NOT EXISTS source_manifest_sha256 text,
  ADD COLUMN IF NOT EXISTS normalized_manifest_sha256 text,
  ADD COLUMN IF NOT EXISTS source_artifact_sha256 text;

ALTER TABLE public.mmi_sub_questions
  ADD COLUMN IF NOT EXISTS source_namespace text,
  ADD COLUMN IF NOT EXISTS source_manifest_sha256 text,
  ADD COLUMN IF NOT EXISTS normalized_manifest_sha256 text,
  ADD COLUMN IF NOT EXISTS source_artifact_sha256 text,
  ADD COLUMN IF NOT EXISTS source_flat_id text;

CREATE TABLE public.mmi_normalized_station_import_batches (
  source_namespace text NOT NULL,
  source_manifest_sha256 text NOT NULL,
  normalized_manifest_sha256 text NOT NULL,
  batch_id text NOT NULL,
  artifact_sha256 text NOT NULL,
  payload_fingerprint text NOT NULL,
  station_count integer NOT NULL,
  sub_question_count integer NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz,
  PRIMARY KEY (source_namespace, source_manifest_sha256, normalized_manifest_sha256, batch_id),
  CONSTRAINT mmi_normalized_batch_identity_valid CHECK (
    source_namespace = 'med_interview_question_bank'
    AND source_manifest_sha256 = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
    AND normalized_manifest_sha256 = 'd5410fe8b21130737b80fb02be8de024889c33065303cbafd104f332e7f31edb'
    AND batch_id IN ('normalized-stations-part-1', 'normalized-stations-part-2')
    AND artifact_sha256 ~ '^[a-f0-9]{64}$'
    AND payload_fingerprint ~ '^[a-f0-9]{64}$'
    AND station_count BETWEEN 1 AND 155
    AND sub_question_count BETWEEN 1 AND 775
  )
);

CREATE TABLE public.candidate_mmi_station_sessions (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  station_id text NOT NULL REFERENCES public.mmi_stations(station_id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  abandoned_at timestamptz,
  CONSTRAINT candidate_mmi_station_sessions_abandoned_after_start CHECK (
    abandoned_at IS NULL OR abandoned_at >= started_at
  )
);

CREATE INDEX candidate_mmi_station_sessions_owner
  ON public.candidate_mmi_station_sessions (user_id, started_at DESC);

CREATE UNIQUE INDEX mmi_sub_questions_normalized_flat_identity_unique
  ON public.mmi_sub_questions (source_namespace, source_manifest_sha256, source_flat_id)
  WHERE source_flat_id IS NOT NULL
    AND source_namespace IS NOT NULL
    AND source_manifest_sha256 IS NOT NULL;

ALTER TABLE public.mmi_normalized_station_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_station_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mmi_normalized_station_import_batches
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.candidate_mmi_station_sessions
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the hardened 010 browser boundary and remove the pre-cutover
-- service-role access to assessor-bearing normalized source material.
REVOKE ALL ON TABLE public.mmi_stations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.mmi_sub_questions FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.app_config (key, value)
VALUES ('normalized_mmi_station_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  v_flag text;
BEGIN
  SELECT value INTO v_flag
  FROM public.app_config
  WHERE key = 'normalized_mmi_station_enabled';
  IF v_flag IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'normalized candidate MMI feature flag must begin disabled';
  END IF;
END;
$$;

CREATE FUNCTION public.import_normalized_mmi_station_batch(
  p_batch_id text,
  p_normalized_manifest_sha256 text,
  p_artifact_sha256 text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_expected_artifact_sha256 text;
  v_expected_payload_fingerprint text;
  v_expected_station_count integer;
  v_expected_sub_question_count integer;
  v_payload_fingerprint text;
  v_existing_fingerprint text;
  v_existing_station_count integer;
  v_existing_sub_question_count integer;
  v_station_index integer;
  v_question_index integer;
  v_station jsonb;
  v_question jsonb;
  v_station_id text;
  v_sub_q_id text;
  v_source_flat_id text;
  v_category text;
  v_topic text;
  v_difficulty text;
  v_tags text[];
  v_seen_station_ids text[] := ARRAY[]::text[];
  v_seen_sub_question_ids text[] := ARRAY[]::text[];
  v_seen_flat_ids text[] := ARRAY[]::text[];
  v_station_count integer;
  v_sub_question_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_batch_id = 'normalized-stations-part-1' THEN
    v_expected_artifact_sha256 := 'cf1ddfacf222b520f7237257e266009cff5f90db4e9c6fefb7bdc18e8f1f2c2e';
    v_expected_payload_fingerprint := '83164f9cbac54447edd13e023b5d83ace389d5bc0d82629e525ae3ad680c1f3a';
    v_expected_station_count := 80;
    v_expected_sub_question_count := 400;
  ELSIF p_batch_id = 'normalized-stations-part-2' THEN
    v_expected_artifact_sha256 := '2ff3c3ca74131b4987c0b3efb09aafc521fb7c507daf94e3abd71ccc7e6c708e';
    v_expected_payload_fingerprint := 'fd91a790ac99e6fb87facb1f121abd54d407abe7c7f6315c379cb966230e2cf0';
    v_expected_station_count := 75;
    v_expected_sub_question_count := 375;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unverified normalized import batch';
  END IF;
  IF p_normalized_manifest_sha256 IS DISTINCT FROM 'd5410fe8b21130737b80fb02be8de024889c33065303cbafd104f332e7f31edb'
    OR p_artifact_sha256 IS DISTINCT FROM v_expected_artifact_sha256
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR p_payload - ARRAY['artifact_version', 'source_namespace', 'source_manifest_sha256', 'stations'] <> '{}'::jsonb
    OR (p_payload->>'artifact_version') IS DISTINCT FROM '1'
    OR (p_payload->>'source_namespace') IS DISTINCT FROM 'med_interview_question_bank'
    OR (p_payload->>'source_manifest_sha256') IS DISTINCT FROM '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
    OR jsonb_typeof(p_payload->'stations') <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized import provenance is invalid';
  END IF;
  v_payload_fingerprint := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  IF v_payload_fingerprint IS DISTINCT FROM v_expected_payload_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized import payload fingerprint is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.question_import_batches
    WHERE source_namespace = 'med_interview_question_bank'
      AND source_manifest_sha256 = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
      AND batch_id = 'questions-part-1' AND row_count = 500
  ) OR NOT EXISTS (
    SELECT 1 FROM public.question_import_batches
    WHERE source_namespace = 'med_interview_question_bank'
      AND source_manifest_sha256 = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
      AND batch_id = 'questions-part-2' AND row_count = 285
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'flat source manifest is not verified';
  END IF;

  v_station_count := jsonb_array_length(p_payload->'stations');
  IF v_station_count <> v_expected_station_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized import station count is invalid';
  END IF;

  FOR v_station_index IN 0..v_station_count - 1 LOOP
    v_station := p_payload->'stations'->v_station_index;
    IF jsonb_typeof(v_station) <> 'object'
      OR v_station - ARRAY['station_id', 'category', 'topic', 'difficulty', 'university_tags', 'prep_time_sec', 'scenario_text', 'sub_questions'] <> '{}'::jsonb
      OR jsonb_typeof(v_station->'station_id') <> 'string'
      OR jsonb_typeof(v_station->'category') <> 'string'
      OR jsonb_typeof(v_station->'topic') <> 'string'
      OR jsonb_typeof(v_station->'difficulty') <> 'string'
      OR jsonb_typeof(v_station->'university_tags') <> 'array'
      OR jsonb_typeof(v_station->'prep_time_sec') <> 'number'
      OR jsonb_typeof(v_station->'scenario_text') <> 'string'
      OR jsonb_typeof(v_station->'sub_questions') <> 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized station row is invalid';
    END IF;
    v_station_id := btrim(v_station->>'station_id');
    v_category := lower(btrim(v_station->>'category'));
    v_topic := btrim(v_station->>'topic');
    v_difficulty := lower(btrim(v_station->>'difficulty'));
    IF v_station_id !~ '^MMI_[0-9]{3}$'
      OR v_station_id = ANY(v_seen_station_ids)
      OR v_category NOT IN ('motivation', 'ethics', 'nhs', 'teamwork', 'resilience', 'scenarios')
      OR v_difficulty NOT IN ('foundation', 'intermediate', 'advanced')
      OR length(v_topic) NOT BETWEEN 1 AND 100
      OR length(btrim(v_station->>'scenario_text')) NOT BETWEEN 1 AND 10000
      OR (v_station->>'prep_time_sec')::integer <> 60
      OR jsonb_array_length(v_station->'sub_questions') <> 5
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_station->'university_tags') AS tag(value)
        WHERE jsonb_typeof(tag.value) <> 'string'
          OR length(btrim(tag.value #>> '{}')) NOT BETWEEN 1 AND 60
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized station values are invalid';
    END IF;
    SELECT COALESCE(array_agg(tag ORDER BY tag), ARRAY[]::text[])
    INTO v_tags
    FROM (
      SELECT DISTINCT lower(btrim(value)) AS tag
      FROM jsonb_array_elements_text(v_station->'university_tags')
    ) AS tags;
    IF cardinality(v_tags) <> jsonb_array_length(v_station->'university_tags') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized station tags are invalid';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.mmi_stations AS s
      WHERE s.station_id = v_station_id
        AND (
          s.source_namespace IS DISTINCT FROM 'med_interview_question_bank'
          OR s.source_manifest_sha256 IS DISTINCT FROM '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
          OR s.normalized_manifest_sha256 IS DISTINCT FROM p_normalized_manifest_sha256
          OR s.source_artifact_sha256 IS DISTINCT FROM p_artifact_sha256
          OR s.category IS DISTINCT FROM v_category
          OR s.topic IS DISTINCT FROM v_topic
          OR s.difficulty::text IS DISTINCT FROM v_difficulty
          OR s.uni_tags IS DISTINCT FROM v_tags
          OR s.prep_time_sec IS DISTINCT FROM 60
          OR s.scenario_text IS DISTINCT FROM v_station->>'scenario_text'
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized station conflicts with reviewed payload';
    END IF;
    v_seen_station_ids := array_append(v_seen_station_ids, v_station_id);

    FOR v_question_index IN 0..4 LOOP
      v_question := v_station->'sub_questions'->v_question_index;
      IF jsonb_typeof(v_question) <> 'object'
        OR v_question - ARRAY['sub_q_id', 'order_num', 'question_text', 'time_limit_sec', 'source_flat_id'] <> '{}'::jsonb
        OR jsonb_typeof(v_question->'sub_q_id') <> 'string'
        OR jsonb_typeof(v_question->'order_num') <> 'number'
        OR jsonb_typeof(v_question->'question_text') <> 'string'
        OR jsonb_typeof(v_question->'time_limit_sec') <> 'number'
        OR jsonb_typeof(v_question->'source_flat_id') <> 'string' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized sub-question row is invalid';
      END IF;
      v_sub_q_id := btrim(v_question->>'sub_q_id');
      v_source_flat_id := btrim(v_question->>'source_flat_id');
      IF (v_question->>'order_num')::integer <> v_question_index + 1
        OR (v_question->>'time_limit_sec')::integer <> 120
        OR v_sub_q_id IS DISTINCT FROM v_station_id || '_Q' || (v_question_index + 1)::text
        OR v_source_flat_id IS DISTINCT FROM v_station_id || '/' || v_sub_q_id
        OR v_sub_q_id = ANY(v_seen_sub_question_ids)
        OR v_source_flat_id = ANY(v_seen_flat_ids)
        OR length(btrim(v_question->>'question_text')) NOT BETWEEN 1 AND 10000
        OR NOT EXISTS (
          SELECT 1 FROM public.questions AS q
          WHERE q.source_namespace = 'med_interview_question_bank'
            AND q.source_id = v_source_flat_id
            AND q.is_active IS TRUE
        ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized sub-question provenance is invalid';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.mmi_sub_questions AS q
        WHERE q.sub_q_id = v_sub_q_id
          AND (
            q.station_id IS DISTINCT FROM v_station_id
            OR q.order_num IS DISTINCT FROM v_question_index + 1
            OR q.question_text IS DISTINCT FROM v_question->>'question_text'
            OR q.time_limit_sec IS DISTINCT FROM 120
            OR q.source_namespace IS DISTINCT FROM 'med_interview_question_bank'
            OR q.source_manifest_sha256 IS DISTINCT FROM '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
            OR q.normalized_manifest_sha256 IS DISTINCT FROM p_normalized_manifest_sha256
            OR q.source_artifact_sha256 IS DISTINCT FROM p_artifact_sha256
            OR q.source_flat_id IS DISTINCT FROM v_source_flat_id
          )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized sub-question conflicts with reviewed payload';
      END IF;
      v_seen_sub_question_ids := array_append(v_seen_sub_question_ids, v_sub_q_id);
      v_seen_flat_ids := array_append(v_seen_flat_ids, v_source_flat_id);
      v_sub_question_count := v_sub_question_count + 1;
    END LOOP;
  END LOOP;

  IF v_sub_question_count <> v_expected_sub_question_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized import sub-question count is invalid';
  END IF;
  INSERT INTO public.mmi_normalized_station_import_batches (
    source_namespace, source_manifest_sha256, normalized_manifest_sha256, batch_id,
    artifact_sha256, payload_fingerprint, station_count, sub_question_count
  ) VALUES (
    'med_interview_question_bank',
    '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71',
    p_normalized_manifest_sha256, p_batch_id, p_artifact_sha256,
    v_payload_fingerprint, v_station_count, v_sub_question_count
  ) ON CONFLICT DO NOTHING;

  SELECT payload_fingerprint, station_count, sub_question_count
  INTO v_existing_fingerprint, v_existing_station_count, v_existing_sub_question_count
  FROM public.mmi_normalized_station_import_batches
  WHERE source_namespace = 'med_interview_question_bank'
    AND source_manifest_sha256 = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
    AND normalized_manifest_sha256 = p_normalized_manifest_sha256
    AND batch_id = p_batch_id;
  IF v_existing_fingerprint IS DISTINCT FROM v_payload_fingerprint
    OR v_existing_station_count IS DISTINCT FROM v_station_count
    OR v_existing_sub_question_count IS DISTINCT FROM v_sub_question_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized batch identity was already used with another payload';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mmi_stations AS s
    WHERE s.station_id = ANY(v_seen_station_ids)
      AND s.source_namespace IS DISTINCT FROM 'med_interview_question_bank'
  ) OR EXISTS (
    SELECT 1 FROM public.mmi_sub_questions AS q
    WHERE q.sub_q_id = ANY(v_seen_sub_question_ids)
      AND q.source_namespace IS DISTINCT FROM 'med_interview_question_bank'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized source identity collides with curated content';
  END IF;

  FOR v_station_index IN 0..v_station_count - 1 LOOP
    v_station := p_payload->'stations'->v_station_index;
    v_station_id := v_station->>'station_id';
    SELECT COALESCE(array_agg(tag ORDER BY tag), ARRAY[]::text[])
    INTO v_tags
    FROM (
      SELECT DISTINCT lower(btrim(value)) AS tag
      FROM jsonb_array_elements_text(v_station->'university_tags')
    ) AS tags;
    INSERT INTO public.mmi_stations (
      station_id, category, topic, difficulty, uni_tags, prep_time_sec,
      status, scenario_text, source_namespace, source_manifest_sha256,
      normalized_manifest_sha256, source_artifact_sha256
    ) VALUES (
      v_station_id, lower(v_station->>'category'), btrim(v_station->>'topic'),
      lower(v_station->>'difficulty')::public.question_difficulty, v_tags, 60,
      'draft', v_station->>'scenario_text', 'med_interview_question_bank',
      '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71',
      p_normalized_manifest_sha256, p_artifact_sha256
    ) ON CONFLICT (station_id) DO NOTHING;
    FOR v_question_index IN 0..4 LOOP
      v_question := v_station->'sub_questions'->v_question_index;
      INSERT INTO public.mmi_sub_questions (
        sub_q_id, station_id, order_num, question_text, time_limit_sec,
        source_namespace, source_manifest_sha256, normalized_manifest_sha256,
        source_artifact_sha256, source_flat_id
      ) VALUES (
        v_question->>'sub_q_id', v_station_id, v_question_index + 1,
        v_question->>'question_text', 120, 'med_interview_question_bank',
        '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71',
        p_normalized_manifest_sha256, p_artifact_sha256, v_question->>'source_flat_id'
      ) ON CONFLICT (sub_q_id) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$function$;

CREATE FUNCTION public.finalize_normalized_mmi_station_import(
  p_source_namespace text,
  p_source_manifest_sha256 text,
  p_normalized_manifest_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_candidate_station_count integer;
  v_candidate_sub_question_count integer;
  v_valid_station_count integer;
  v_invalid_station_count integer;
  v_excluded_panel_question_count integer;
  v_panel_sub_question_count integer;
  v_preserved_active_flat_question_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_source_namespace IS DISTINCT FROM 'med_interview_question_bank'
    OR p_source_manifest_sha256 IS DISTINCT FROM '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
    OR p_normalized_manifest_sha256 IS DISTINCT FROM 'd5410fe8b21130737b80fb02be8de024889c33065303cbafd104f332e7f31edb' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized finalization provenance is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mmi_normalized_station_import_batches
    WHERE source_namespace = p_source_namespace
      AND source_manifest_sha256 = p_source_manifest_sha256
      AND normalized_manifest_sha256 = p_normalized_manifest_sha256
      AND batch_id = 'normalized-stations-part-1'
      AND artifact_sha256 = 'cf1ddfacf222b520f7237257e266009cff5f90db4e9c6fefb7bdc18e8f1f2c2e'
      AND station_count = 80 AND sub_question_count = 400
  ) OR NOT EXISTS (
    SELECT 1 FROM public.mmi_normalized_station_import_batches
    WHERE source_namespace = p_source_namespace
      AND source_manifest_sha256 = p_source_manifest_sha256
      AND normalized_manifest_sha256 = p_normalized_manifest_sha256
      AND batch_id = 'normalized-stations-part-2'
      AND artifact_sha256 = '2ff3c3ca74131b4987c0b3efb09aafc521fb7c507daf94e3abd71ccc7e6c708e'
      AND station_count = 75 AND sub_question_count = 375
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized import is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.question_import_batches
    WHERE source_namespace = p_source_namespace
      AND source_manifest_sha256 = p_source_manifest_sha256
      AND batch_id = 'questions-part-1' AND row_count = 500
  ) OR NOT EXISTS (
    SELECT 1 FROM public.question_import_batches
    WHERE source_namespace = p_source_namespace
      AND source_manifest_sha256 = p_source_manifest_sha256
      AND batch_id = 'questions-part-2' AND row_count = 285
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'flat source manifest is incomplete';
  END IF;

  SELECT count(*) INTO v_candidate_station_count
  FROM public.mmi_stations AS s
  WHERE s.source_namespace = p_source_namespace
    AND s.source_manifest_sha256 = p_source_manifest_sha256
    AND s.normalized_manifest_sha256 = p_normalized_manifest_sha256;
  SELECT count(*) INTO v_candidate_sub_question_count
  FROM public.mmi_sub_questions AS q
  WHERE q.source_namespace = p_source_namespace
    AND q.source_manifest_sha256 = p_source_manifest_sha256
    AND q.normalized_manifest_sha256 = p_normalized_manifest_sha256;
  SELECT count(*) INTO v_valid_station_count
  FROM (
    SELECT s.station_id
    FROM public.mmi_stations AS s
    JOIN public.mmi_sub_questions AS q ON q.station_id = s.station_id
    WHERE s.source_namespace = p_source_namespace
      AND s.source_manifest_sha256 = p_source_manifest_sha256
      AND s.normalized_manifest_sha256 = p_normalized_manifest_sha256
    GROUP BY s.station_id
    HAVING array_agg(q.order_num ORDER BY q.order_num) = ARRAY[1, 2, 3, 4, 5]
      AND bool_and(q.time_limit_sec = 120)
      AND bool_and(q.source_flat_id = q.station_id || '/' || q.sub_q_id)
  ) AS valid_stations;
  v_invalid_station_count := v_candidate_station_count - v_valid_station_count;
  SELECT count(*) INTO v_excluded_panel_question_count
  FROM public.questions AS q
  WHERE q.source_namespace = p_source_namespace
    AND q.source_id ~ '^PANEL_[0-9]{3}$'
    AND q.is_active IS TRUE;
  SELECT count(*) INTO v_panel_sub_question_count
  FROM public.mmi_sub_questions AS q
  WHERE q.source_namespace = p_source_namespace
    AND q.source_flat_id ~ '(^|/)PANEL_[0-9]{3}$';
  SELECT count(*) INTO v_preserved_active_flat_question_count
  FROM public.questions AS q
  WHERE q.source_namespace = p_source_namespace
    AND q.is_active IS TRUE;

  IF v_candidate_station_count <> 155
    OR v_candidate_sub_question_count <> 775
    OR v_valid_station_count <> 155
    OR v_invalid_station_count <> 0
    OR v_excluded_panel_question_count <> 10
    OR v_panel_sub_question_count <> 0
    OR v_preserved_active_flat_question_count <> 785
    OR NOT (
      SELECT count(DISTINCT source_flat_id) = 775
      FROM public.mmi_sub_questions
      WHERE source_namespace = p_source_namespace
        AND source_manifest_sha256 = p_source_manifest_sha256
        AND normalized_manifest_sha256 = p_normalized_manifest_sha256
    )
    OR EXISTS (
      SELECT 1 FROM public.mmi_sub_questions AS q
      LEFT JOIN public.questions AS flat
        ON flat.source_namespace = p_source_namespace
       AND flat.source_id = q.source_flat_id
       AND flat.is_active IS TRUE
      WHERE q.source_namespace = p_source_namespace
        AND flat.id IS NULL
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized finalization checks failed';
  END IF;

  UPDATE public.mmi_normalized_station_import_batches
  SET finalized_at = COALESCE(finalized_at, clock_timestamp())
  WHERE source_namespace = p_source_namespace
    AND source_manifest_sha256 = p_source_manifest_sha256
    AND normalized_manifest_sha256 = p_normalized_manifest_sha256
    AND batch_id IN ('normalized-stations-part-1', 'normalized-stations-part-2');
  UPDATE public.mmi_stations
  SET status = 'published'
  WHERE source_namespace = p_source_namespace
    AND source_manifest_sha256 = p_source_manifest_sha256
    AND normalized_manifest_sha256 = p_normalized_manifest_sha256;

  RETURN jsonb_build_object(
    'candidateStationCount', v_candidate_station_count,
    'candidateSubQuestionCount', v_candidate_sub_question_count,
    'validStationCount', v_valid_station_count,
    'invalidStationCount', v_invalid_station_count,
    'excludedPanelQuestionCount', v_excluded_panel_question_count,
    'panelSubQuestionCount', v_panel_sub_question_count,
    'preservedActiveFlatQuestionCount', v_preserved_active_flat_question_count
  );
END;
$function$;

CREATE FUNCTION public.start_candidate_mmi_station_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_started_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_station_id text;
  v_scenario_text text;
BEGIN
  IF auth.uid() IS NULL OR v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF (SELECT value FROM public.app_config WHERE key = 'normalized_mmi_station_enabled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'feature_disabled';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));
  SELECT session.id, session.started_at, session.station_id
  INTO v_session_id, v_started_at, v_station_id
  FROM public.candidate_mmi_station_sessions AS session
  JOIN public.mmi_stations AS s ON s.station_id = session.station_id
  WHERE user_id = v_user_id
    AND session.abandoned_at IS NULL
    AND v_now < session.started_at + interval '660 seconds'
    AND s.source_namespace = 'med_interview_question_bank'
    AND s.status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.mmi_normalized_station_import_batches AS b
      WHERE b.source_namespace = s.source_namespace
        AND b.source_manifest_sha256 = s.source_manifest_sha256
        AND b.normalized_manifest_sha256 = s.normalized_manifest_sha256
        AND b.artifact_sha256 = s.source_artifact_sha256
        AND b.finalized_at IS NOT NULL
    )
  ORDER BY session.started_at DESC
  LIMIT 1
  FOR UPDATE;
  IF v_session_id IS NOT NULL THEN
    RETURN public.get_candidate_mmi_station_session(v_session_id);
  END IF;
  SELECT s.station_id, s.scenario_text
  INTO v_station_id, v_scenario_text
  FROM public.mmi_stations AS s
  LEFT JOIN public.candidate_mmi_station_sessions AS previous
    ON previous.user_id = v_user_id
   AND previous.station_id = s.station_id
  WHERE s.source_namespace = 'med_interview_question_bank'
    AND s.status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.mmi_normalized_station_import_batches AS b
      WHERE b.source_namespace = s.source_namespace
        AND b.source_manifest_sha256 = s.source_manifest_sha256
        AND b.normalized_manifest_sha256 = s.normalized_manifest_sha256
        AND b.artifact_sha256 = s.source_artifact_sha256
        AND b.finalized_at IS NOT NULL
    )
  GROUP BY s.station_id, s.scenario_text
  ORDER BY
    CASE WHEN max(previous.started_at) IS NULL THEN 0 ELSE 1 END,
    max(previous.started_at) ASC NULLS FIRST,
    s.station_id
  LIMIT 1;
  IF v_station_id IS NULL OR v_scenario_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate station unavailable';
  END IF;
  INSERT INTO public.candidate_mmi_station_sessions (user_id, station_id, started_at)
  VALUES (v_user_id, v_station_id, v_now)
  RETURNING id, started_at INTO v_session_id, v_started_at;
  RETURN jsonb_build_object(
    'sessionId', v_session_id,
    'stationId', v_station_id,
    'serverNow', v_now,
    'phase', 'scenario',
    'phaseStartedAt', v_started_at,
    'phaseEndsAt', v_started_at + interval '60 seconds',
    'scenarioText', v_scenario_text
  );
END;
$function$;

CREATE FUNCTION public.get_candidate_mmi_station_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_started_at timestamptz;
  v_station_id text;
  v_abandoned_at timestamptz;
  v_elapsed integer;
  v_prompt_order integer;
  v_prompt_text text;
  v_phase_started_at timestamptz;
  v_phase_ends_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF (SELECT value FROM public.app_config WHERE key = 'normalized_mmi_station_enabled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'feature_disabled';
  END IF;
  SELECT started_at, station_id, abandoned_at
  INTO v_started_at, v_station_id, v_abandoned_at
  FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id
    AND user_id = v_user_id;
  IF v_started_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;
  IF v_abandoned_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id, 'stationId', v_station_id, 'serverNow', v_now,
      'phase', 'abandoned', 'phaseStartedAt', v_abandoned_at, 'phaseEndsAt', v_abandoned_at
    );
  END IF;
  v_elapsed := greatest(0, floor(extract(epoch FROM v_now - v_started_at))::integer);
  IF v_elapsed < 60 THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id, 'stationId', v_station_id, 'serverNow', v_now,
      'phase', 'scenario', 'phaseStartedAt', v_started_at,
      'phaseEndsAt', v_started_at + interval '60 seconds',
      'scenarioText', (SELECT scenario_text FROM public.mmi_stations WHERE station_id = v_station_id)
    );
  END IF;
  IF v_elapsed >= 660 THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id, 'stationId', v_station_id, 'serverNow', v_now,
      'phase', 'completed', 'phaseStartedAt', v_started_at + interval '660 seconds',
      'phaseEndsAt', null
    );
  END IF;
  v_prompt_order := ((v_elapsed - 60) / 120) + 1;
  v_phase_started_at := v_started_at + interval '60 seconds' + (v_prompt_order - 1) * interval '120 seconds';
  v_phase_ends_at := v_phase_started_at + interval '120 seconds';
  SELECT question_text INTO v_prompt_text
  FROM public.mmi_sub_questions
  WHERE station_id = v_station_id
    AND order_num = v_prompt_order
    AND source_namespace = 'med_interview_question_bank';
  IF v_prompt_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate current phase is unavailable';
  END IF;
  -- current_phase_only: one fixed response object, never a prompt collection.
  RETURN jsonb_build_object(
    'sessionId', p_session_id, 'stationId', v_station_id, 'serverNow', v_now,
    'phase', 'response', 'phaseStartedAt', v_phase_started_at,
    'phaseEndsAt', v_phase_ends_at, 'promptOrder', v_prompt_order,
    'promptText', v_prompt_text
  );
END;
$function$;

CREATE FUNCTION public.abandon_candidate_mmi_station_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF auth.uid() IS NULL OR v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF (SELECT value FROM public.app_config WHERE key = 'normalized_mmi_station_enabled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'feature_disabled';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.candidate_mmi_station_sessions
    WHERE id = p_session_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;
  UPDATE public.candidate_mmi_station_sessions
  SET abandoned_at = COALESCE(abandoned_at, clock_timestamp())
  WHERE id = p_session_id AND user_id = v_user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_normalized_mmi_station_batch(text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_normalized_mmi_station_batch(text, text, text, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.finalize_normalized_mmi_station_import(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_normalized_mmi_station_import(text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.start_candidate_mmi_station_session()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.start_candidate_mmi_station_session()
  TO authenticated;
REVOKE ALL ON FUNCTION public.get_candidate_mmi_station_session(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_candidate_mmi_station_session(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.abandon_candidate_mmi_station_session(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.abandon_candidate_mmi_station_session(uuid)
  TO authenticated;

DO $$
DECLARE
  v_signature text;
  v_role text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.import_normalized_mmi_station_batch(text,text,text,jsonb)',
    'public.finalize_normalized_mmi_station_import(text,text,text)',
    'public.start_candidate_mmi_station_session()',
    'public.get_candidate_mmi_station_session(uuid)',
    'public.abandon_candidate_mmi_station_session(uuid)'
  ] LOOP
    SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_owner, v_security_definer, v_config
    FROM pg_proc AS p WHERE p.oid = to_regprocedure(v_signature);
    IF v_owner <> 'postgres'
      OR v_security_definer IS DISTINCT FROM TRUE
      OR NOT (COALESCE(v_config, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public, pg_temp']) THEN
      RAISE EXCEPTION 'candidate MMI station function security postcondition failed';
    END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'SELECT')
      OR has_table_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'INSERT')
      OR has_table_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'UPDATE')
      OR has_table_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'DELETE')
      OR has_table_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'TRUNCATE')
      OR has_table_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'REFERENCES')
      OR has_table_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'TRIGGER')
      OR has_table_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'MAINTAIN')
      OR has_any_column_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'SELECT')
      OR has_any_column_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'INSERT')
      OR has_any_column_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'UPDATE')
      OR has_any_column_privilege(v_role, 'public.mmi_normalized_station_import_batches', 'REFERENCES')
      OR has_table_privilege(v_role, 'public.candidate_mmi_station_sessions', 'SELECT')
      OR has_table_privilege(v_role, 'public.candidate_mmi_station_sessions', 'INSERT')
      OR has_table_privilege(v_role, 'public.candidate_mmi_station_sessions', 'UPDATE')
      OR has_table_privilege(v_role, 'public.candidate_mmi_station_sessions', 'DELETE')
      OR has_table_privilege(v_role, 'public.candidate_mmi_station_sessions', 'TRUNCATE')
      OR has_table_privilege(v_role, 'public.candidate_mmi_station_sessions', 'REFERENCES')
      OR has_table_privilege(v_role, 'public.candidate_mmi_station_sessions', 'TRIGGER')
      OR has_table_privilege(v_role, 'public.candidate_mmi_station_sessions', 'MAINTAIN')
      OR has_any_column_privilege(v_role, 'public.candidate_mmi_station_sessions', 'SELECT')
      OR has_any_column_privilege(v_role, 'public.candidate_mmi_station_sessions', 'INSERT')
      OR has_any_column_privilege(v_role, 'public.candidate_mmi_station_sessions', 'UPDATE')
      OR has_any_column_privilege(v_role, 'public.candidate_mmi_station_sessions', 'REFERENCES') THEN
      RAISE EXCEPTION 'candidate MMI station private-table postcondition failed';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_class AS c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE c.oid IN (
      'public.mmi_normalized_station_import_batches'::regclass,
      'public.candidate_mmi_station_sessions'::regclass
    )
      AND acl.grantee = 0
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) OR EXISTS (
    SELECT 1
    FROM pg_attribute AS a
    CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
    WHERE a.attrelid IN (
      'public.mmi_normalized_station_import_batches'::regclass,
      'public.candidate_mmi_station_sessions'::regclass
    )
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND acl.grantee = 0
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'candidate MMI station PUBLIC ACL postcondition failed';
  END IF;
  IF has_table_privilege('anon', 'public.mmi_stations', 'SELECT')
    OR has_table_privilege('authenticated', 'public.mmi_stations', 'SELECT')
    OR has_table_privilege('service_role', 'public.mmi_stations', 'SELECT')
    OR has_table_privilege('anon', 'public.mmi_sub_questions', 'SELECT')
    OR has_table_privilege('authenticated', 'public.mmi_sub_questions', 'SELECT')
    OR has_table_privilege('service_role', 'public.mmi_sub_questions', 'SELECT') THEN
    RAISE EXCEPTION 'candidate MMI station normalized-table postcondition failed';
  END IF;
END;
$$;

COMMIT;
