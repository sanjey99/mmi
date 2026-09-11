-- Privacy-safe, audited administration for rubric-based MMI content and usage.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prerequisites$
BEGIN
  IF to_regclass('public.profiles') IS NULL
    OR to_regclass('public.app_config') IS NULL
    OR to_regclass('public.mmi_stations') IS NULL
    OR to_regclass('public.mmi_sub_questions') IS NULL
    OR to_regclass('public.mmi_marking_criteria') IS NULL
    OR to_regclass('public.mmi_panel_questions') IS NULL
    OR to_regclass('public.mmi_station_versions') IS NULL
    OR to_regclass('public.candidate_mmi_station_sessions') IS NULL
    OR to_regclass('public.candidate_mmi_station_prompt_snapshots') IS NULL
    OR to_regclass('public.candidate_mmi_station_responses') IS NULL
    OR to_regclass('public.mmi_ai_usage_events') IS NULL THEN
    RAISE EXCEPTION 'MMI admin operation prerequisites are missing';
  END IF;
END;
$prerequisites$;

CREATE TABLE public.mmi_admin_access_audit (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  admin_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  response_id uuid REFERENCES public.candidate_mmi_station_responses(id) ON DELETE SET NULL,
  purpose text NOT NULL CHECK (purpose IN ('scoring_review', 'support', 'cost_review', 'quality_audit')),
  viewed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.mmi_admin_change_audit (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  admin_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 100),
  target_id text NOT NULL CHECK (char_length(target_id) BETWEEN 1 AND 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object'
    AND pg_column_size(metadata) <= 65536
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX mmi_admin_access_audit_subject_viewed
  ON public.mmi_admin_access_audit (subject_user_id, viewed_at DESC);
CREATE INDEX mmi_admin_access_audit_admin_viewed
  ON public.mmi_admin_access_audit (admin_user_id, viewed_at DESC);
CREATE INDEX mmi_admin_change_audit_target_created
  ON public.mmi_admin_change_audit (target_type, target_id, created_at DESC);

ALTER TABLE public.mmi_admin_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_admin_change_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mmi_admin_access_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.mmi_admin_change_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.app_config FROM authenticated;

CREATE OR REPLACE FUNCTION public.require_mmi_admin()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = v_user_id AND profile.is_admin IS TRUE
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin access required';
  END IF;
  RETURN v_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.build_admin_mmi_station_snapshot(
  p_station_id text,
  p_version integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'stationId', station.station_id,
    'contentVersion', p_version,
    'category', station.category,
    'topic', station.topic,
    'difficulty', station.difficulty::text,
    'universityTags', to_jsonb(COALESCE(station.uni_tags, '{}'::text[])),
    'prepTimeSec', station.prep_time_sec,
    'imageUrl', station.image_url,
    'scenarioText', station.scenario_text,
    'status', station.status,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'subQuestionId', question.sub_q_id,
        'orderNum', question.order_num,
        'questionText', question.question_text,
        'timeLimitSec', question.time_limit_sec,
        'sourceTimeLimitSec', question.source_time_limit_sec,
        'modelAnswerCached', question.model_answer_cached,
        'criteria', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'criterionId', criterion.criterion_id,
            'orderNum', criterion.order_num,
            'bulletText', criterion.bullet_text,
            'sourceWeight', criterion.source_weight,
            'domain', criterion.domain
          ) ORDER BY criterion.order_num)
          FROM public.mmi_marking_criteria AS criterion
          WHERE criterion.sub_q_id = question.sub_q_id
        ), '[]'::jsonb)
      ) ORDER BY question.order_num)
      FROM public.mmi_sub_questions AS question
      WHERE question.station_id = station.station_id
    ), '[]'::jsonb)
  )
  FROM public.mmi_stations AS station
  WHERE station.station_id = p_station_id;
$function$;

CREATE OR REPLACE FUNCTION public.assert_publishable_admin_mmi_station(p_station_id text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.mmi_stations AS station
    WHERE station.station_id = p_station_id
      AND char_length(btrim(station.category)) BETWEEN 1 AND 100
      AND char_length(btrim(station.topic)) BETWEEN 1 AND 100
      AND char_length(btrim(station.scenario_text)) BETWEEN 1 AND 10000
      AND station.prep_time_sec = 60
      AND EXISTS (
        SELECT 1
        FROM public.mmi_sub_questions AS question
        WHERE question.station_id = station.station_id
        GROUP BY question.station_id
        HAVING count(*) = 5
          AND count(DISTINCT question.order_num) = 5
          AND min(question.order_num) = 1
          AND max(question.order_num) = 5
          AND bool_and(question.time_limit_sec = 120)
          AND bool_and(char_length(btrim(question.question_text)) BETWEEN 1 AND 10000)
          AND bool_and(EXISTS (
            SELECT 1 FROM public.mmi_marking_criteria AS criterion
            WHERE criterion.sub_q_id = question.sub_q_id
          ))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'mmi_station_not_publishable';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.require_mmi_admin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.build_admin_mmi_station_snapshot(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assert_publishable_admin_mmi_station(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_admin_mmi_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_provider text;
  v_model text;
  v_configured boolean;
BEGIN
  v_admin_id := public.require_mmi_admin();
  SELECT max(value) FILTER (WHERE key = 'ai_provider'),
         max(value) FILTER (WHERE key = 'ai_model'),
         COALESCE(bool_or(key = 'ai_api_key' AND NULLIF(btrim(value), '') IS NOT NULL), false)
  INTO v_provider, v_model, v_configured
  FROM public.app_config
  WHERE key IN ('ai_provider', 'ai_model', 'ai_api_key');

  RETURN jsonb_build_object(
    'stationCounts', jsonb_build_object(
      'draft', (SELECT count(*) FROM public.mmi_stations WHERE status = 'draft'),
      'published', (SELECT count(*) FROM public.mmi_stations WHERE status = 'published'),
      'archived', (SELECT count(*) FROM public.mmi_stations WHERE status = 'archived')
    ),
    'universityCounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tag', grouped.tag, 'count', grouped.station_count) ORDER BY grouped.tag)
      FROM (
        SELECT tag, count(DISTINCT station.station_id)::integer AS station_count
        FROM public.mmi_stations AS station
        CROSS JOIN LATERAL unnest(COALESCE(station.uni_tags, '{}'::text[])) AS tag
        WHERE public.is_complete_published_mmi_station(station.station_id)
        GROUP BY tag
      ) AS grouped
    ), '[]'::jsonb),
    'contentHealth', jsonb_build_object(
      'stationCount', (SELECT count(*) FROM public.mmi_stations),
      'questionCount', (SELECT count(*) FROM public.mmi_sub_questions),
      'criterionCount', (SELECT count(*) FROM public.mmi_marking_criteria),
      'invalidStationCount', (SELECT count(*) FROM public.mmi_stations AS station WHERE station.status = 'published' AND NOT public.is_complete_published_mmi_station(station.station_id))
    ),
    'ai', jsonb_build_object(
      'provider', COALESCE(v_provider, 'anthropic'),
      'model', COALESCE(v_model, 'unconfigured'),
      'isConfigured', v_configured
    ),
    'usage', jsonb_build_object(
      'callCount', (SELECT count(*) FROM public.mmi_ai_usage_events),
      'knownCost', to_char(COALESCE((SELECT sum(estimated_cost) FROM public.mmi_ai_usage_events WHERE estimated_cost IS NOT NULL), 0), 'FM99999999.00000000'),
      'unknownCostCount', (SELECT count(*) FROM public.mmi_ai_usage_events WHERE estimated_cost IS NULL),
      'failureCount', (SELECT count(*) FROM public.mmi_ai_usage_events WHERE outcome <> 'scored')
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_admin_mmi_stations(
  p_query text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_university text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_query text := NULLIF(btrim(p_query), '');
  v_university text := public.canonical_mmi_university_tag(p_university);
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000
    OR (v_query IS NOT NULL AND char_length(v_query) > 200)
    OR (p_status IS NOT NULL AND p_status NOT IN ('draft', 'published', 'archived'))
    OR (p_university IS NOT NULL AND v_university IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_admin_station_filters';
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(item ORDER BY item->>'updatedAt' DESC, item->>'stationId')
      FROM (
        SELECT jsonb_build_object(
          'stationId', station.station_id,
          'category', station.category,
          'topic', station.topic,
          'difficulty', station.difficulty::text,
          'universityTags', to_jsonb(COALESCE(station.uni_tags, '{}'::text[])),
          'prepTimeSec', station.prep_time_sec,
          'status', station.status,
          'contentVersion', station.content_version,
          'questionCount', count(DISTINCT question.sub_q_id),
          'criterionCount', count(criterion.criterion_id),
          'isComplete', public.is_complete_published_mmi_station(station.station_id),
          'updatedAt', station.updated_at
        ) AS item
        FROM public.mmi_stations AS station
        LEFT JOIN public.mmi_sub_questions AS question ON question.station_id = station.station_id
        LEFT JOIN public.mmi_marking_criteria AS criterion ON criterion.sub_q_id = question.sub_q_id
        WHERE (p_status IS NULL OR station.status = p_status)
          AND (v_university IS NULL OR v_university = ANY(COALESCE(station.uni_tags, '{}'::text[])))
          AND (v_query IS NULL OR station.station_id ILIKE '%' || v_query || '%' OR station.category ILIKE '%' || v_query || '%' OR station.topic ILIKE '%' || v_query || '%')
        GROUP BY station.id
        ORDER BY station.updated_at DESC, station.station_id
        LIMIT p_limit OFFSET p_offset
      ) AS page
    ), '[]'::jsonb),
    'total', (
      SELECT count(*)
      FROM public.mmi_stations AS station
      WHERE (p_status IS NULL OR station.status = p_status)
        AND (v_university IS NULL OR v_university = ANY(COALESCE(station.uni_tags, '{}'::text[])))
        AND (v_query IS NULL OR station.station_id ILIKE '%' || v_query || '%' OR station.category ILIKE '%' || v_query || '%' OR station.topic ILIKE '%' || v_query || '%')
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_mmi_station(p_station_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_station public.mmi_stations;
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF p_station_id IS NULL OR p_station_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_admin_station_id';
  END IF;
  SELECT * INTO v_station FROM public.mmi_stations AS station WHERE station.station_id = p_station_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_station_not_found'; END IF;
  RETURN jsonb_build_object(
    'station', jsonb_build_object(
      'stationId', v_station.station_id,
      'expectedVersion', v_station.content_version,
      'category', v_station.category,
      'topic', v_station.topic,
      'difficulty', v_station.difficulty::text,
      'universityTags', to_jsonb(COALESCE(v_station.uni_tags, '{}'::text[])),
      'prepTimeSec', v_station.prep_time_sec,
      'imageUrl', v_station.image_url,
      'scenarioText', v_station.scenario_text,
      'questions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'subQuestionId', question.sub_q_id,
          'order', question.order_num,
          'questionText', question.question_text,
          'timeLimitSec', question.time_limit_sec,
          'modelAnswerCached', question.model_answer_cached,
          'criteria', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'criterionId', criterion.criterion_id,
              'order', criterion.order_num,
              'bulletText', criterion.bullet_text,
              'domain', criterion.domain,
              'sourceWeight', criterion.source_weight
            ) ORDER BY criterion.order_num)
            FROM public.mmi_marking_criteria AS criterion
            WHERE criterion.sub_q_id = question.sub_q_id
          ), '[]'::jsonb)
        ) ORDER BY question.order_num)
        FROM public.mmi_sub_questions AS question
        WHERE question.station_id = v_station.station_id
      ), '[]'::jsonb)
    ),
    'status', v_station.status,
    'contentVersion', v_station.content_version
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_admin_mmi_station(
  p_station jsonb,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_station_id text;
  v_current public.mmi_stations;
  v_current_exists boolean := false;
  v_new_version integer;
  v_status text := 'draft';
  v_tags text[] := '{}'::text[];
  v_question jsonb;
  v_criterion jsonb;
  v_audit_id uuid;
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF jsonb_typeof(p_station) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_station)) <> 10
    OR NOT p_station ?& ARRAY['stationId','expectedVersion','category','topic','difficulty','universityTags','prepTimeSec','imageUrl','scenarioText','questions']
    OR jsonb_typeof(p_station->'stationId') <> 'string'
    OR p_station->>'stationId' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
    OR (p_expected_version IS NULL AND jsonb_typeof(p_station->'expectedVersion') <> 'null')
    OR (p_expected_version IS NOT NULL AND (
      p_expected_version < 1
      OR jsonb_typeof(p_station->'expectedVersion') <> 'number'
      OR p_station->>'expectedVersion' <> p_expected_version::text
    ))
    OR jsonb_typeof(p_station->'category') <> 'string'
    OR char_length(btrim(p_station->>'category')) > 100
    OR jsonb_typeof(p_station->'topic') <> 'string'
    OR char_length(btrim(p_station->>'topic')) > 100
    OR p_station->>'difficulty' NOT IN ('foundation','intermediate','advanced')
    OR jsonb_typeof(p_station->'universityTags') <> 'array'
    OR jsonb_array_length(p_station->'universityTags') > 50
    OR p_station->>'prepTimeSec' <> '60'
    OR jsonb_typeof(p_station->'prepTimeSec') <> 'number'
    OR jsonb_typeof(p_station->'scenarioText') <> 'string'
    OR char_length(p_station->>'scenarioText') > 10000
    OR jsonb_typeof(p_station->'questions') <> 'array'
    OR jsonb_array_length(p_station->'questions') > 5
    OR (jsonb_typeof(p_station->'imageUrl') NOT IN ('null','string'))
    OR (jsonb_typeof(p_station->'imageUrl') = 'string' AND (
      char_length(p_station->>'imageUrl') > 2000
      OR p_station->>'imageUrl' !~ '^https://[^[:space:]@]+$'
    )) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_admin_station_payload';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_station->'universityTags') AS tag(value)
    WHERE jsonb_typeof(tag.value) <> 'string'
      OR char_length(btrim(tag.value #>> '{}')) NOT BETWEEN 1 AND 100
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_admin_station_tags';
  END IF;
  SELECT COALESCE(array_agg(lower(btrim(tag.value)) ORDER BY tag.ordinality), '{}'::text[])
  INTO v_tags
  FROM jsonb_array_elements_text(p_station->'universityTags') WITH ORDINALITY AS tag(value, ordinality);
  IF cardinality(v_tags) <> (SELECT count(DISTINCT tag) FROM unnest(v_tags) AS tag) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'duplicate_admin_station_tags';
  END IF;

  v_station_id := p_station->>'stationId';
  SELECT * INTO v_current
  FROM public.mmi_stations AS station
  WHERE station.station_id = v_station_id
  FOR UPDATE;
  v_current_exists := FOUND;
  IF v_current_exists AND p_expected_version IS DISTINCT FROM v_current.content_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mmi_station_version_conflict';
  ELSIF NOT v_current_exists AND p_expected_version IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mmi_station_version_conflict';
  END IF;
  v_new_version := CASE WHEN v_current_exists THEN v_current.content_version + 1 ELSE 1 END;
  v_status := CASE WHEN v_current_exists THEN v_current.status ELSE 'draft' END;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_station->'questions') AS question(value)
    WHERE jsonb_typeof(question.value) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(question.value)) <> 6
      OR NOT question.value ?& ARRAY['subQuestionId','order','questionText','timeLimitSec','modelAnswerCached','criteria']
      OR jsonb_typeof(question.value->'subQuestionId') <> 'string'
      OR question.value->>'subQuestionId' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
      OR jsonb_typeof(question.value->'order') <> 'number'
      OR question.value->>'order' !~ '^[1-5]$'
      OR jsonb_typeof(question.value->'questionText') <> 'string'
      OR char_length(question.value->>'questionText') > 10000
      OR jsonb_typeof(question.value->'timeLimitSec') <> 'number'
      OR question.value->>'timeLimitSec' <> '120'
      OR jsonb_typeof(question.value->'modelAnswerCached') NOT IN ('null','string')
      OR (jsonb_typeof(question.value->'modelAnswerCached') = 'string' AND char_length(question.value->>'modelAnswerCached') > 20000)
      OR jsonb_typeof(question.value->'criteria') <> 'array'
      OR jsonb_array_length(question.value->'criteria') > 20
  ) OR (
    SELECT count(*) <> count(DISTINCT question.value->>'subQuestionId')
      OR count(*) <> count(DISTINCT question.value->>'order')
    FROM jsonb_array_elements(p_station->'questions') AS question(value)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_admin_station_questions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_station->'questions') AS question(value)
    CROSS JOIN LATERAL jsonb_array_elements(question.value->'criteria') AS criterion(value)
    WHERE jsonb_typeof(criterion.value) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(criterion.value)) <> 5
      OR NOT criterion.value ?& ARRAY['criterionId','order','bulletText','domain','sourceWeight']
      OR jsonb_typeof(criterion.value->'criterionId') <> 'string'
      OR criterion.value->>'criterionId' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
      OR jsonb_typeof(criterion.value->'order') <> 'number'
      OR criterion.value->>'order' !~ '^(?:[1-9]|1[0-9]|20)$'
      OR jsonb_typeof(criterion.value->'bulletText') <> 'string'
      OR char_length(criterion.value->>'bulletText') > 2000
      OR jsonb_typeof(criterion.value->'domain') NOT IN ('null','string')
      OR (jsonb_typeof(criterion.value->'domain') = 'string' AND char_length(criterion.value->>'domain') > 100)
      OR jsonb_typeof(criterion.value->'sourceWeight') <> 'number'
      OR (criterion.value->>'sourceWeight')::numeric <= 0
      OR (criterion.value->>'sourceWeight')::numeric > 1000000
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_station->'questions') AS question(value)
    WHERE (SELECT count(*) FROM jsonb_array_elements(question.value->'criteria'))
      <> (SELECT count(DISTINCT criterion.value->>'criterionId') FROM jsonb_array_elements(question.value->'criteria') AS criterion(value))
      OR (SELECT count(*) FROM jsonb_array_elements(question.value->'criteria'))
      <> (SELECT count(DISTINCT criterion.value->>'order') FROM jsonb_array_elements(question.value->'criteria') AS criterion(value))
  ) OR (
    SELECT count(*) <> count(DISTINCT criterion.value->>'criterionId')
    FROM jsonb_array_elements(p_station->'questions') AS question(value)
    CROSS JOIN LATERAL jsonb_array_elements(question.value->'criteria') AS criterion(value)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_admin_station_criteria';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_station->'questions') AS question(value)
    JOIN public.mmi_sub_questions AS existing ON existing.sub_q_id = question.value->>'subQuestionId'
    WHERE existing.station_id <> v_station_id
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_station->'questions') AS question(value)
    CROSS JOIN LATERAL jsonb_array_elements(question.value->'criteria') AS criterion(value)
    JOIN public.mmi_marking_criteria AS existing ON existing.criterion_id = criterion.value->>'criterionId'
    WHERE existing.sub_q_id <> question.value->>'subQuestionId'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_station_source_id_conflict';
  END IF;

  IF v_current_exists THEN
    UPDATE public.mmi_stations
    SET category = btrim(p_station->>'category'),
        topic = btrim(p_station->>'topic'),
        difficulty = (p_station->>'difficulty')::public.question_difficulty,
        uni_tags = v_tags,
        prep_time_sec = 60,
        image_url = NULLIF(btrim(p_station->>'imageUrl'), ''),
        scenario_text = btrim(p_station->>'scenarioText'),
        content_version = v_new_version,
        updated_at = clock_timestamp()
    WHERE station_id = v_station_id;
  ELSE
    INSERT INTO public.mmi_stations(
      station_id, category, topic, difficulty, uni_tags, prep_time_sec,
      image_url, status, scenario_text, source_namespace,
      source_manifest_sha256, content_version, updated_at
    ) VALUES (
      v_station_id, btrim(p_station->>'category'), btrim(p_station->>'topic'),
      (p_station->>'difficulty')::public.question_difficulty, v_tags, 60,
      NULLIF(btrim(p_station->>'imageUrl'), ''), 'draft', btrim(p_station->>'scenarioText'),
      'admin_mmi', repeat('0', 64), 1, clock_timestamp()
    );
  END IF;

  FOR v_question IN SELECT value FROM jsonb_array_elements(p_station->'questions') LOOP
    INSERT INTO public.mmi_sub_questions(
      sub_q_id, station_id, order_num, question_text, time_limit_sec,
      model_answer_cached, source_namespace, source_manifest_sha256,
      source_time_limit_sec
    ) VALUES (
      v_question->>'subQuestionId', v_station_id, (v_question->>'order')::integer,
      btrim(v_question->>'questionText'), 120,
      NULLIF(btrim(v_question->>'modelAnswerCached'), ''),
      'admin_mmi', repeat('0', 64), 120
    )
    ON CONFLICT (sub_q_id) DO UPDATE SET
      order_num = EXCLUDED.order_num,
      question_text = EXCLUDED.question_text,
      time_limit_sec = EXCLUDED.time_limit_sec,
      model_answer_cached = EXCLUDED.model_answer_cached,
      source_time_limit_sec = EXCLUDED.source_time_limit_sec;

    FOR v_criterion IN SELECT value FROM jsonb_array_elements(v_question->'criteria') LOOP
      INSERT INTO public.mmi_marking_criteria(
        criterion_id, sub_q_id, order_num, bullet_text, source_weight,
        domain, source_namespace, source_manifest_sha256
      ) VALUES (
        v_criterion->>'criterionId', v_question->>'subQuestionId',
        (v_criterion->>'order')::integer, btrim(v_criterion->>'bulletText'),
        (v_criterion->>'sourceWeight')::numeric,
        NULLIF(btrim(v_criterion->>'domain'), ''), 'admin_mmi', repeat('0', 64)
      )
      ON CONFLICT (criterion_id) DO UPDATE SET
        order_num = EXCLUDED.order_num,
        bullet_text = EXCLUDED.bullet_text,
        source_weight = EXCLUDED.source_weight,
        domain = EXCLUDED.domain;
    END LOOP;

    DELETE FROM public.mmi_marking_criteria AS criterion
    WHERE criterion.sub_q_id = v_question->>'subQuestionId'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_question->'criteria') AS incoming(value)
        WHERE incoming.value->>'criterionId' = criterion.criterion_id
      );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.mmi_sub_questions AS existing
    WHERE existing.station_id = v_station_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_station->'questions') AS incoming(value)
        WHERE incoming.value->>'subQuestionId' = existing.sub_q_id
      )
      AND EXISTS (
        SELECT 1 FROM public.candidate_mmi_station_prompt_snapshots AS snapshot
        WHERE snapshot.sub_question_id = existing.sub_q_id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'versioned_mmi_question_cannot_be_removed';
  END IF;
  DELETE FROM public.mmi_sub_questions AS existing
  WHERE existing.station_id = v_station_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_station->'questions') AS incoming(value)
      WHERE incoming.value->>'subQuestionId' = existing.sub_q_id
    );

  IF v_status = 'published' THEN
    PERFORM public.assert_publishable_admin_mmi_station(v_station_id);
  END IF;
  INSERT INTO public.mmi_station_versions(station_id, version, content_snapshot, created_by)
  VALUES (v_station_id, v_new_version, public.build_admin_mmi_station_snapshot(v_station_id, v_new_version), v_admin_id);
  INSERT INTO public.mmi_admin_change_audit(admin_user_id, action, target_type, target_id, metadata)
  VALUES (
    v_admin_id, CASE WHEN v_current_exists THEN 'station_saved' ELSE 'station_created' END,
    'mmi_station', v_station_id,
    jsonb_build_object('previousVersion', CASE WHEN v_current_exists THEN v_current.content_version ELSE NULL END, 'newVersion', v_new_version, 'status', v_status)
  ) RETURNING id INTO v_audit_id;
  RETURN jsonb_build_object('ok', true, 'auditId', v_audit_id, 'targetId', v_station_id, 'version', v_new_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_admin_mmi_station_status(
  p_station_id text,
  p_expected_version integer,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_station public.mmi_stations;
  v_new_version integer;
  v_audit_id uuid;
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF p_station_id IS NULL OR p_station_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
    OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_status NOT IN ('draft','published','archived') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_admin_station_status_request';
  END IF;
  SELECT * INTO v_station FROM public.mmi_stations AS station
  WHERE station.station_id = p_station_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_station_not_found'; END IF;
  IF v_station.content_version <> p_expected_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'mmi_station_version_conflict';
  END IF;
  IF p_status = 'published' THEN PERFORM public.assert_publishable_admin_mmi_station(p_station_id); END IF;
  v_new_version := v_station.content_version + 1;
  UPDATE public.mmi_stations
  SET status = p_status,
      archived_at = CASE WHEN p_status = 'archived' THEN clock_timestamp() ELSE NULL END,
      content_version = v_new_version,
      updated_at = clock_timestamp()
  WHERE station_id = p_station_id;
  INSERT INTO public.mmi_station_versions(station_id, version, content_snapshot, created_by)
  VALUES (p_station_id, v_new_version, public.build_admin_mmi_station_snapshot(p_station_id, v_new_version), v_admin_id);
  INSERT INTO public.mmi_admin_change_audit(admin_user_id, action, target_type, target_id, metadata)
  VALUES (v_admin_id, 'station_status_changed', 'mmi_station', p_station_id,
    jsonb_build_object('previousStatus', v_station.status, 'newStatus', p_status, 'previousVersion', v_station.content_version, 'newVersion', v_new_version))
  RETURNING id INTO v_audit_id;
  RETURN jsonb_build_object('ok', true, 'auditId', v_audit_id, 'targetId', p_station_id, 'version', v_new_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_admin_mmi_panels(
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE v_admin_id uuid;
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_admin_panel_page';
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'questionId', panel.question_id,
      'questionText', panel.question_text,
      'stationType', panel.station_type,
      'topic', panel.topic,
      'difficulty', panel.difficulty::text,
      'universityTags', to_jsonb(panel.uni_tags),
      'notes', panel.notes,
      'modelAnswerCached', panel.model_answer_cached,
      'status', panel.status,
      'updatedAt', panel.updated_at
    ) ORDER BY panel.updated_at DESC, panel.question_id)
    FROM (SELECT * FROM public.mmi_panel_questions ORDER BY updated_at DESC, question_id LIMIT p_limit OFFSET p_offset) AS panel), '[]'::jsonb),
    'total', (SELECT count(*) FROM public.mmi_panel_questions)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_admin_mmi_panel(p_panel jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_question_id text;
  v_tags text[];
  v_audit_id uuid;
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF jsonb_typeof(p_panel) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_panel)) <> 9
    OR NOT p_panel ?& ARRAY['questionId','questionText','stationType','topic','difficulty','universityTags','notes','modelAnswerCached','status']
    OR p_panel->>'questionId' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
    OR jsonb_typeof(p_panel->'questionText') <> 'string' OR char_length(btrim(p_panel->>'questionText')) NOT BETWEEN 1 AND 10000
    OR jsonb_typeof(p_panel->'stationType') <> 'string' OR char_length(btrim(p_panel->>'stationType')) NOT BETWEEN 1 AND 100
    OR jsonb_typeof(p_panel->'topic') <> 'string' OR char_length(btrim(p_panel->>'topic')) NOT BETWEEN 1 AND 100
    OR p_panel->>'difficulty' NOT IN ('foundation','intermediate','advanced')
    OR jsonb_typeof(p_panel->'universityTags') <> 'array' OR jsonb_array_length(p_panel->'universityTags') > 50
    OR jsonb_typeof(p_panel->'notes') NOT IN ('null','string') OR (jsonb_typeof(p_panel->'notes')='string' AND char_length(p_panel->>'notes') > 20000)
    OR jsonb_typeof(p_panel->'modelAnswerCached') NOT IN ('null','string') OR (jsonb_typeof(p_panel->'modelAnswerCached')='string' AND char_length(p_panel->>'modelAnswerCached') > 20000)
    OR p_panel->>'status' NOT IN ('draft','published','archived')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_panel->'universityTags') tag(value) WHERE jsonb_typeof(tag.value) <> 'string' OR char_length(btrim(tag.value #>> '{}')) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_admin_panel_payload';
  END IF;
  SELECT COALESCE(array_agg(lower(btrim(tag.value)) ORDER BY tag.ordinality), '{}'::text[])
  INTO v_tags FROM jsonb_array_elements_text(p_panel->'universityTags') WITH ORDINALITY AS tag(value, ordinality);
  IF cardinality(v_tags) <> (SELECT count(DISTINCT tag) FROM unnest(v_tags) AS tag) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'duplicate_admin_panel_tags';
  END IF;
  v_question_id := p_panel->>'questionId';
  INSERT INTO public.mmi_panel_questions(question_id,question_text,station_type,topic,difficulty,uni_tags,notes,model_answer_cached,status,source_namespace,source_manifest_sha256,updated_at)
  VALUES (v_question_id,btrim(p_panel->>'questionText'),btrim(p_panel->>'stationType'),btrim(p_panel->>'topic'),(p_panel->>'difficulty')::public.question_difficulty,v_tags,NULLIF(btrim(p_panel->>'notes'),''),NULLIF(btrim(p_panel->>'modelAnswerCached'),''),p_panel->>'status','admin_mmi',repeat('0',64),clock_timestamp())
  ON CONFLICT (question_id) DO UPDATE SET
    question_text=EXCLUDED.question_text,station_type=EXCLUDED.station_type,topic=EXCLUDED.topic,
    difficulty=EXCLUDED.difficulty,uni_tags=EXCLUDED.uni_tags,notes=EXCLUDED.notes,
    model_answer_cached=EXCLUDED.model_answer_cached,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at;
  INSERT INTO public.mmi_admin_change_audit(admin_user_id,action,target_type,target_id,metadata)
  VALUES (v_admin_id,'panel_saved','mmi_panel_question',v_question_id,jsonb_build_object('status',p_panel->>'status'))
  RETURNING id INTO v_audit_id;
  RETURN jsonb_build_object('ok',true,'auditId',v_audit_id,'targetId',v_question_id,'version',NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_ai_config()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_provider text;
  v_model text;
  v_base_url text;
  v_input_rate numeric;
  v_cached_input_rate numeric;
  v_output_rate numeric;
  v_configured boolean;
  v_updated_at timestamptz;
BEGIN
  v_admin_id := public.require_mmi_admin();
  SELECT
    max(value) FILTER (WHERE key='ai_provider'),
    max(value) FILTER (WHERE key='ai_model'),
    max(value) FILTER (WHERE key='ai_base_url'),
    COALESCE(max(value) FILTER (WHERE key='ai_input_rate_per_million'),'0')::numeric,
    COALESCE(max(value) FILTER (WHERE key='ai_cached_input_rate_per_million'),'0')::numeric,
    COALESCE(max(value) FILTER (WHERE key='ai_output_rate_per_million'),'0')::numeric,
    COALESCE(bool_or(key='ai_api_key' AND NULLIF(btrim(value),'') IS NOT NULL),false),
    COALESCE(max(updated_at),clock_timestamp())
  INTO v_provider,v_model,v_base_url,v_input_rate,v_cached_input_rate,v_output_rate,v_configured,v_updated_at
  FROM public.app_config
  WHERE key IN ('ai_provider','ai_model','ai_base_url','ai_input_rate_per_million','ai_cached_input_rate_per_million','ai_output_rate_per_million','ai_api_key');
  RETURN jsonb_build_object(
    'provider',COALESCE(v_provider,'anthropic'),
    'model',COALESCE(v_model,'unconfigured'),
    'baseUrl',NULLIF(v_base_url,''),
    'inputRatePerMillion',v_input_rate,
    'cachedInputRatePerMillion',v_cached_input_rate,
    'outputRatePerMillion',v_output_rate,
    'isConfigured',v_configured,
    'updatedAt',v_updated_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_admin_ai_config(
  p_provider text,
  p_model text,
  p_base_url text,
  p_input_rate numeric,
  p_cached_input_rate numeric,
  p_output_rate numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_old jsonb;
  v_audit_id uuid;
  v_base_url text := NULLIF(btrim(p_base_url),'');
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF p_provider NOT IN ('anthropic','openai','openai_compatible')
    OR p_model IS NULL OR char_length(btrim(p_model)) NOT BETWEEN 1 AND 200
    OR p_input_rate IS NULL OR p_input_rate < 0 OR p_input_rate > 99999999.999999 OR scale(p_input_rate) > 6
    OR p_cached_input_rate IS NULL OR p_cached_input_rate < 0 OR p_cached_input_rate > 99999999.999999 OR scale(p_cached_input_rate) > 6
    OR p_output_rate IS NULL OR p_output_rate < 0 OR p_output_rate > 99999999.999999 OR scale(p_output_rate) > 6
    OR (p_provider <> 'openai_compatible' AND v_base_url IS NOT NULL)
    OR (p_provider = 'openai_compatible' AND (
      v_base_url IS NULL OR char_length(v_base_url) > 2000
      OR v_base_url !~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:/[^[:space:]]*)?$'
      OR v_base_url ~ '@'
      OR v_base_url ~* '^https://(?:localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)'
    )) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_admin_ai_config';
  END IF;
  SELECT jsonb_build_object(
    'provider',max(value) FILTER (WHERE key='ai_provider'),
    'model',max(value) FILTER (WHERE key='ai_model'),
    'baseUrl',max(value) FILTER (WHERE key='ai_base_url'),
    'inputRatePerMillion',COALESCE(max(value) FILTER (WHERE key='ai_input_rate_per_million'),'0')::numeric,
    'cachedInputRatePerMillion',COALESCE(max(value) FILTER (WHERE key='ai_cached_input_rate_per_million'),'0')::numeric,
    'outputRatePerMillion',COALESCE(max(value) FILTER (WHERE key='ai_output_rate_per_million'),'0')::numeric
  ) INTO v_old
  FROM public.app_config
  WHERE key IN ('ai_provider','ai_model','ai_base_url','ai_input_rate_per_million','ai_cached_input_rate_per_million','ai_output_rate_per_million');
  INSERT INTO public.app_config(key,value,updated_at) VALUES
    ('ai_provider',p_provider,clock_timestamp()),
    ('ai_model',btrim(p_model),clock_timestamp()),
    ('ai_base_url',v_base_url,clock_timestamp()),
    ('ai_input_rate_per_million',p_input_rate::text,clock_timestamp()),
    ('ai_cached_input_rate_per_million',p_cached_input_rate::text,clock_timestamp()),
    ('ai_output_rate_per_million',p_output_rate::text,clock_timestamp())
  ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at;
  INSERT INTO public.mmi_admin_change_audit(admin_user_id,action,target_type,target_id,metadata)
  VALUES (v_admin_id,'ai_config_saved','ai_config','ai_config',jsonb_build_object(
    'old',v_old,
    'new',jsonb_build_object('provider',p_provider,'model',btrim(p_model),'baseUrl',v_base_url,'inputRatePerMillion',p_input_rate,'cachedInputRatePerMillion',p_cached_input_rate,'outputRatePerMillion',p_output_rate)
  )) RETURNING id INTO v_audit_id;
  RETURN jsonb_build_object('ok',true,'auditId',v_audit_id,'targetId','ai_config','version',NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_mmi_usage(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_limit integer;
  v_offset integer;
  v_from timestamptz;
  v_to timestamptz;
  v_user_id uuid;
  v_provider text;
  v_model text;
  v_station_id text;
  v_scope text;
  v_outcome text;
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF jsonb_typeof(p_filters) <> 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_filters) AS key WHERE key <> ALL(ARRAY['from','to','userId','provider','model','stationId','scope','outcome','limit','offset']))
    OR jsonb_typeof(COALESCE(p_filters->'limit','20'::jsonb)) <> 'number'
    OR jsonb_typeof(COALESCE(p_filters->'offset','0'::jsonb)) <> 'number'
    OR COALESCE(p_filters->>'limit','20') !~ '^[0-9]+$'
    OR COALESCE(p_filters->>'offset','0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_admin_usage_filters';
  END IF;
  v_limit := COALESCE((p_filters->>'limit')::integer,20);
  v_offset := COALESCE((p_filters->>'offset')::integer,0);
  IF v_limit NOT BETWEEN 1 AND 100 OR v_offset NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_admin_usage_page';
  END IF;
  BEGIN
    v_from := NULLIF(p_filters->>'from','')::timestamptz;
    v_to := NULLIF(p_filters->>'to','')::timestamptz;
    v_user_id := NULLIF(p_filters->>'userId','')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_admin_usage_filters';
  END;
  v_provider := NULLIF(btrim(p_filters->>'provider'),'');
  v_model := NULLIF(btrim(p_filters->>'model'),'');
  v_station_id := NULLIF(btrim(p_filters->>'stationId'),'');
  v_scope := NULLIF(btrim(p_filters->>'scope'),'');
  v_outcome := NULLIF(btrim(p_filters->>'outcome'),'');
  IF (v_provider IS NOT NULL AND char_length(v_provider)>100)
    OR (v_model IS NOT NULL AND char_length(v_model)>200)
    OR (v_station_id IS NOT NULL AND v_station_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$')
    OR (v_scope IS NOT NULL AND v_scope NOT IN ('target','all'))
    OR (v_outcome IS NOT NULL AND v_outcome NOT IN ('scored','provider_failed','invalid_response','persistence_failed'))
    OR (v_from IS NOT NULL AND v_to IS NOT NULL AND v_from > v_to) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_admin_usage_filters';
  END IF;
  RETURN (
    WITH filtered AS (
      SELECT usage.*, session.station_id, session.practice_scope, session.target_university_snapshot,
        COALESCE(NULLIF(btrim(profile.full_name),''),'User ' || left(usage.user_id::text,8)) AS user_display_name,
        response.prompt_order
      FROM public.mmi_ai_usage_events AS usage
      JOIN public.candidate_mmi_station_sessions AS session ON session.id=usage.session_id
      JOIN public.candidate_mmi_station_responses AS response ON response.id=usage.response_id
      JOIN public.profiles AS profile ON profile.id=usage.user_id
      WHERE (v_from IS NULL OR usage.created_at>=v_from)
        AND (v_to IS NULL OR usage.created_at<=v_to)
        AND (v_user_id IS NULL OR usage.user_id=v_user_id)
        AND (v_provider IS NULL OR usage.provider=v_provider)
        AND (v_model IS NULL OR usage.model=v_model)
        AND (v_station_id IS NULL OR session.station_id=v_station_id)
        AND (v_scope IS NULL OR session.practice_scope=v_scope)
        AND (v_outcome IS NULL OR usage.outcome=v_outcome)
    )
    SELECT jsonb_build_object(
      'summary',jsonb_build_object(
        'callCount',count(*),
        'inputTokens',COALESCE(sum(input_tokens),0),
        'cachedInputTokens',COALESCE(sum(cached_input_tokens),0),
        'outputTokens',COALESCE(sum(output_tokens),0),
        'knownCost',to_char(COALESCE(sum(estimated_cost) FILTER (WHERE estimated_cost IS NOT NULL),0),'FM99999999.00000000'),
        'unknownCostCount',count(*) FILTER (WHERE estimated_cost IS NULL),
        'averageLatencyMs',COALESCE(round(avg(latency_ms),2),0),
        'failureRatePct',CASE WHEN count(*)=0 THEN 0 ELSE round(count(*) FILTER (WHERE outcome<>'scored')::numeric*100/count(*),2) END
      ),
      'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'usageId',page.id,'userId',page.user_id,'userDisplayName',page.user_display_name,
        'sessionId',page.session_id,'responseId',page.response_id,'stationId',page.station_id,
        'promptOrder',page.prompt_order,'scope',page.practice_scope,'targetUniversity',page.target_university_snapshot,
        'provider',page.provider,'model',page.model,'inputTokens',page.input_tokens,
        'cachedInputTokens',page.cached_input_tokens,'outputTokens',page.output_tokens,
        'estimatedCost',CASE WHEN page.estimated_cost IS NULL THEN NULL ELSE to_char(page.estimated_cost,'FM99999999.00000000') END,
        'latencyMs',page.latency_ms,'outcome',page.outcome,'createdAt',page.created_at
      ) ORDER BY page.created_at DESC,page.id)
      FROM (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT v_limit OFFSET v_offset) AS page),'[]'::jsonb)
    ) FROM filtered
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_admin_mmi_assessments(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_limit integer;
  v_offset integer;
  v_from timestamptz;
  v_to timestamptz;
  v_user_id uuid;
  v_provider text;
  v_model text;
  v_station_id text;
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF jsonb_typeof(p_filters) <> 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_filters) AS key WHERE key <> ALL(ARRAY['from','to','userId','provider','model','stationId','limit','offset']))
    OR COALESCE(p_filters->>'limit','20') !~ '^[0-9]+$'
    OR COALESCE(p_filters->>'offset','0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_admin_assessment_filters';
  END IF;
  v_limit:=COALESCE((p_filters->>'limit')::integer,20);
  v_offset:=COALESCE((p_filters->>'offset')::integer,0);
  IF v_limit NOT BETWEEN 1 AND 100 OR v_offset NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_admin_assessment_page'; END IF;
  BEGIN
    v_from:=NULLIF(p_filters->>'from','')::timestamptz;
    v_to:=NULLIF(p_filters->>'to','')::timestamptz;
    v_user_id:=NULLIF(p_filters->>'userId','')::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_admin_assessment_filters'; END;
  v_provider:=NULLIF(btrim(p_filters->>'provider'),'');
  v_model:=NULLIF(btrim(p_filters->>'model'),'');
  v_station_id:=NULLIF(btrim(p_filters->>'stationId'),'');
  IF (v_provider IS NOT NULL AND char_length(v_provider)>100)
    OR (v_model IS NOT NULL AND char_length(v_model)>200)
    OR (v_station_id IS NOT NULL AND v_station_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$')
    OR (v_from IS NOT NULL AND v_to IS NOT NULL AND v_from>v_to) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_admin_assessment_filters';
  END IF;
  RETURN (
    WITH filtered AS (
      SELECT response.id AS response_id,response.prompt_order,response.public_assessment,response.finalized_at,response.transcript_purged_at,
        snapshot.sub_question_id,
        session.station_id,session.user_id,COALESCE(NULLIF(btrim(profile.full_name),''),'User '||left(session.user_id::text,8)) AS user_display_name,
        usage.provider,usage.model,usage.estimated_cost,usage.outcome
      FROM public.candidate_mmi_station_responses AS response
      JOIN public.candidate_mmi_station_sessions AS session ON session.id=response.session_id
      JOIN public.candidate_mmi_station_prompt_snapshots AS snapshot
        ON snapshot.session_id=response.session_id AND snapshot.prompt_order=response.prompt_order
      JOIN public.profiles AS profile ON profile.id=session.user_id
      LEFT JOIN LATERAL (
        SELECT event.provider,event.model,event.estimated_cost,event.outcome
        FROM public.mmi_ai_usage_events AS event WHERE event.response_id=response.id
        ORDER BY (event.outcome='scored') DESC,event.created_at DESC LIMIT 1
      ) AS usage ON true
      WHERE response.scoring_status='scored'
        AND jsonb_typeof(response.public_assessment->'schemaVersion')='number'
        AND response.public_assessment->>'schemaVersion'='3'
        AND (v_from IS NULL OR response.finalized_at>=v_from)
        AND (v_to IS NULL OR response.finalized_at<=v_to)
        AND (v_user_id IS NULL OR session.user_id=v_user_id)
        AND (v_provider IS NULL OR usage.provider=v_provider)
        AND (v_model IS NULL OR usage.model=v_model)
        AND (v_station_id IS NULL OR session.station_id=v_station_id)
    )
    SELECT jsonb_build_object(
      'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'responseId',page.response_id,'userId',page.user_id,'userDisplayName',page.user_display_name,
        'stationId',page.station_id,'subQuestionId',page.sub_question_id,'promptOrder',page.prompt_order,
        'questionScorePct',(page.public_assessment->>'questionScorePct')::numeric,
        'provider',page.provider,'model',page.model,
        'estimatedCost',CASE WHEN page.estimated_cost IS NULL THEN NULL ELSE to_char(page.estimated_cost,'FM99999999.00000000') END,
        'costKnown',page.estimated_cost IS NOT NULL,'outcome',page.outcome,
        'scoredAt',COALESCE(page.transcript_purged_at,page.finalized_at)
      ) ORDER BY page.finalized_at DESC,page.response_id)
      FROM (SELECT * FROM filtered ORDER BY finalized_at DESC,response_id LIMIT v_limit OFFSET v_offset) AS page),'[]'::jsonb),
      'total',count(*)
    ) FROM filtered
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_mmi_assessment(
  p_response_id uuid,
  p_purpose text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_response_id public.candidate_mmi_station_responses.id%TYPE;
  v_session_id public.candidate_mmi_station_responses.session_id%TYPE;
  v_prompt_order public.candidate_mmi_station_responses.prompt_order%TYPE;
  v_public_assessment public.candidate_mmi_station_responses.public_assessment%TYPE;
  v_finalized_at public.candidate_mmi_station_responses.finalized_at%TYPE;
  v_transcript_purged_at public.candidate_mmi_station_responses.transcript_purged_at%TYPE;
  v_station_id public.candidate_mmi_station_sessions.station_id%TYPE;
  v_user_id public.candidate_mmi_station_sessions.user_id%TYPE;
  v_display_name text;
  v_sub_question_id public.candidate_mmi_station_prompt_snapshots.sub_question_id%TYPE;
  v_rubric_snapshot public.candidate_mmi_station_prompt_snapshots.rubric_snapshot%TYPE;
  v_provider public.mmi_ai_usage_events.provider%TYPE;
  v_model public.mmi_ai_usage_events.model%TYPE;
  v_input_tokens public.mmi_ai_usage_events.input_tokens%TYPE;
  v_cached_input_tokens public.mmi_ai_usage_events.cached_input_tokens%TYPE;
  v_output_tokens public.mmi_ai_usage_events.output_tokens%TYPE;
  v_estimated_cost public.mmi_ai_usage_events.estimated_cost%TYPE;
  v_latency_ms public.mmi_ai_usage_events.latency_ms%TYPE;
  v_outcome public.mmi_ai_usage_events.outcome%TYPE;
  v_audit_id uuid;
  v_criteria jsonb;
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF p_response_id IS NULL OR p_purpose NOT IN ('scoring_review','support','cost_review','quality_audit') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_admin_assessment_request';
  END IF;
  SELECT response.id,response.session_id,response.prompt_order,response.public_assessment,
         response.finalized_at,response.transcript_purged_at
  INTO v_response_id,v_session_id,v_prompt_order,v_public_assessment,
       v_finalized_at,v_transcript_purged_at
  FROM public.candidate_mmi_station_responses AS response
  WHERE response.id=p_response_id AND response.scoring_status='scored'
    AND jsonb_typeof(response.public_assessment->'schemaVersion')='number'
    AND response.public_assessment->>'schemaVersion'='3';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='admin_assessment_not_found'; END IF;
  SELECT session.station_id,session.user_id INTO v_station_id,v_user_id
  FROM public.candidate_mmi_station_sessions AS session WHERE session.id=v_session_id;
  SELECT COALESCE(NULLIF(btrim(profile.full_name),''),'User '||left(profile.id::text,8)) INTO v_display_name
  FROM public.profiles AS profile WHERE profile.id=v_user_id;
  SELECT snapshot.sub_question_id,snapshot.rubric_snapshot INTO v_sub_question_id,v_rubric_snapshot
  FROM public.candidate_mmi_station_prompt_snapshots AS snapshot
  WHERE snapshot.session_id=v_session_id AND snapshot.prompt_order=v_prompt_order;
  SELECT usage.provider,usage.model,usage.input_tokens,usage.cached_input_tokens,
         usage.output_tokens,usage.estimated_cost,usage.latency_ms,usage.outcome
  INTO v_provider,v_model,v_input_tokens,v_cached_input_tokens,
       v_output_tokens,v_estimated_cost,v_latency_ms,v_outcome
  FROM public.mmi_ai_usage_events AS usage WHERE usage.response_id=v_response_id
  ORDER BY (usage.outcome='scored') DESC,usage.created_at DESC LIMIT 1;

  INSERT INTO public.mmi_admin_access_audit(admin_user_id,subject_user_id,response_id,purpose)
  VALUES (v_admin_id,v_user_id,v_response_id,p_purpose) RETURNING id INTO v_audit_id;

  SELECT jsonb_agg(jsonb_build_object(
    'criterionId',decision.value->>'criterionId',
    'bulletText',rubric.value->>'bulletText',
    'domain',rubric.value->'domain',
    'achieved',(decision.value->>'achieved')::boolean,
    'weightPct',(decision.value->>'weightPct')::numeric
  ) ORDER BY decision.ordinality)
  INTO v_criteria
  FROM jsonb_array_elements(v_public_assessment->'criteria') WITH ORDINALITY AS decision(value,ordinality)
  JOIN LATERAL jsonb_array_elements(v_rubric_snapshot->'criteria') AS rubric(value)
    ON rubric.value->>'criterionId'=decision.value->>'criterionId';
  IF v_criteria IS NULL OR jsonb_array_length(v_criteria)<>jsonb_array_length(v_public_assessment->'criteria') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='admin_assessment_rubric_unavailable';
  END IF;
  RETURN jsonb_build_object(
    'accessAuditId',v_audit_id,'responseId',v_response_id,'userId',v_user_id,
    'userDisplayName',v_display_name,'stationId',v_station_id,'subQuestionId',v_sub_question_id,'promptOrder',v_prompt_order,
    'questionScorePct',(v_public_assessment->>'questionScorePct')::numeric,'criteria',v_criteria,
    'provider',v_provider,'model',v_model,'inputTokens',v_input_tokens,
    'cachedInputTokens',v_cached_input_tokens,'outputTokens',v_output_tokens,
    'estimatedCost',CASE WHEN v_estimated_cost IS NULL THEN NULL ELSE to_char(v_estimated_cost,'FM99999999.00000000') END,
    'latencyMs',v_latency_ms,'outcome',v_outcome,'finalizedAt',v_finalized_at,
    'scoredAt',COALESCE(v_transcript_purged_at,v_finalized_at)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_admin_mmi_dashboard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.list_admin_mmi_stations(text,text,text,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_admin_mmi_station(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.save_admin_mmi_station(jsonb,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.set_admin_mmi_station_status(text,integer,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.list_admin_mmi_panels(integer,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.save_admin_mmi_panel(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_admin_ai_config() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.save_admin_ai_config(text,text,text,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_admin_mmi_usage(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.list_admin_mmi_assessments(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_admin_mmi_assessment(uuid,text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_admin_mmi_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_mmi_stations(text,text,text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_mmi_station(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_mmi_station(jsonb,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_mmi_station_status(text,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_mmi_panels(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_mmi_panel(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_ai_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_ai_config(text,text,text,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_mmi_usage(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_mmi_assessments(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_mmi_assessment(uuid,text) TO authenticated;

COMMIT;
