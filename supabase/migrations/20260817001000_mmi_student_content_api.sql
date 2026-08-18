-- Expose MMI discovery through fixed student-safe projections only.
-- Intentionally excluded from every RPC body: model_answer_cached,
-- actor_persona, background_info, question_text, and future rubric content.

BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.mmi_stations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mmi_sub_questions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.roleplay_stations FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_mmi_station_cards(
  p_category TEXT DEFAULT NULL,
  p_university TEXT DEFAULT NULL,
  p_difficulty TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_kind TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  station_kind TEXT,
  station_id TEXT,
  title TEXT,
  category TEXT,
  topic TEXT,
  difficulty TEXT,
  university_tags TEXT[],
  prep_time_sec INTEGER,
  prompt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $function$
DECLARE
  v_search_pattern TEXT;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication is required';
  END IF;

  IF p_kind IS NOT NULL AND p_kind NOT IN ('standard', 'roleplay') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Unsupported station kind';
  END IF;

  IF NULLIF(BTRIM(p_search), '') IS NOT NULL THEN
    v_search_pattern := '%' ||
      REPLACE(
        REPLACE(
          REPLACE(BTRIM(p_search), '\', '\\'),
          '%', '\%'
        ),
        '_', '\_'
      ) || '%';
  END IF;

  RETURN QUERY
  WITH cards AS (
    SELECT
      'standard'::TEXT AS station_kind,
      s.station_id::TEXT AS station_id,
      s.topic::TEXT AS title,
      s.category::TEXT AS category,
      s.topic::TEXT AS topic,
      s.difficulty::TEXT AS difficulty,
      COALESCE(s.uni_tags, ARRAY[]::TEXT[])::TEXT[] AS university_tags,
      s.prep_time_sec::INTEGER AS prep_time_sec,
      COUNT(q.id)::INTEGER AS prompt_count
    FROM public.mmi_stations AS s
    INNER JOIN public.mmi_sub_questions AS q
      ON q.station_id = s.station_id
    WHERE s.status::TEXT = 'published'
      AND (p_category IS NULL OR s.category::TEXT = p_category)
      AND (p_university IS NULL OR p_university = ANY(s.uni_tags::TEXT[]))
      AND (p_difficulty IS NULL OR s.difficulty::TEXT = p_difficulty)
      AND (p_kind IS NULL OR p_kind = 'standard')
      AND (
        v_search_pattern IS NULL
        OR CONCAT_WS(' ', s.topic::TEXT, s.scenario_text)
          ILIKE v_search_pattern ESCAPE '\'
      )
    GROUP BY
      s.station_id,
      s.topic,
      s.category,
      s.difficulty,
      s.uni_tags,
      s.prep_time_sec

    UNION ALL

    SELECT
      'roleplay'::TEXT AS station_kind,
      r.station_id::TEXT AS station_id,
      r.title::TEXT AS title,
      r.category::TEXT AS category,
      r.topic::TEXT AS topic,
      r.difficulty::TEXT AS difficulty,
      COALESCE(r.uni_tags, ARRAY[]::TEXT[])::TEXT[] AS university_tags,
      r.prep_time_sec::INTEGER AS prep_time_sec,
      1::INTEGER AS prompt_count
    FROM public.roleplay_stations AS r
    WHERE r.status::TEXT = 'published'
      AND (p_category IS NULL OR r.category::TEXT = p_category)
      AND (p_university IS NULL OR p_university = ANY(r.uni_tags::TEXT[]))
      AND (p_difficulty IS NULL OR r.difficulty::TEXT = p_difficulty)
      AND (p_kind IS NULL OR p_kind = 'roleplay')
      AND (
        v_search_pattern IS NULL
        OR CONCAT_WS(' ', r.title::TEXT, r.topic::TEXT, r.opening_line)
          ILIKE v_search_pattern ESCAPE '\'
      )
  )
  SELECT
    c.station_kind,
    c.station_id,
    c.title,
    c.category,
    c.topic,
    c.difficulty,
    c.university_tags,
    c.prep_time_sec,
    c.prompt_count
  FROM cards AS c
  ORDER BY c.title, c.station_kind, c.station_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.list_mmi_station_cards(
  TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_mmi_station_cards(
  TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_mmi_station_preview(
  p_kind TEXT,
  p_station_id TEXT
)
RETURNS TABLE (
  station_kind TEXT,
  station_id TEXT,
  title TEXT,
  category TEXT,
  topic TEXT,
  difficulty TEXT,
  university_tags TEXT[],
  prep_time_sec INTEGER,
  prompt_count INTEGER,
  student_brief TEXT,
  opening_line TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication is required';
  END IF;

  IF p_kind NOT IN ('standard', 'roleplay') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Unsupported station kind';
  END IF;

  RETURN QUERY
  WITH previews AS (
    SELECT
      'standard'::TEXT AS station_kind,
      s.station_id::TEXT AS station_id,
      s.topic::TEXT AS title,
      s.category::TEXT AS category,
      s.topic::TEXT AS topic,
      s.difficulty::TEXT AS difficulty,
      COALESCE(s.uni_tags, ARRAY[]::TEXT[])::TEXT[] AS university_tags,
      s.prep_time_sec::INTEGER AS prep_time_sec,
      COUNT(q.id)::INTEGER AS prompt_count,
      s.scenario_text::TEXT AS student_brief,
      NULL::TEXT AS opening_line
    FROM public.mmi_stations AS s
    INNER JOIN public.mmi_sub_questions AS q
      ON q.station_id = s.station_id
    WHERE p_kind = 'standard'
      AND s.station_id = p_station_id
      AND s.status::TEXT = 'published'
    GROUP BY
      s.station_id,
      s.topic,
      s.category,
      s.difficulty,
      s.uni_tags,
      s.prep_time_sec,
      s.scenario_text

    UNION ALL

    SELECT
      'roleplay'::TEXT AS station_kind,
      r.station_id::TEXT AS station_id,
      r.title::TEXT AS title,
      r.category::TEXT AS category,
      r.topic::TEXT AS topic,
      r.difficulty::TEXT AS difficulty,
      COALESCE(r.uni_tags, ARRAY[]::TEXT[])::TEXT[] AS university_tags,
      r.prep_time_sec::INTEGER AS prep_time_sec,
      1::INTEGER AS prompt_count,
      r.title::TEXT AS student_brief,
      r.opening_line::TEXT AS opening_line
    FROM public.roleplay_stations AS r
    WHERE p_kind = 'roleplay'
      AND r.station_id = p_station_id
      AND r.status::TEXT = 'published'
  )
  SELECT
    p.station_kind,
    p.station_id,
    p.title,
    p.category,
    p.topic,
    p.difficulty,
    p.university_tags,
    p.prep_time_sec,
    p.prompt_count,
    p.student_brief,
    p.opening_line
  FROM previews AS p
  ORDER BY p.title, p.station_kind, p.station_id
  LIMIT 1;
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.get_mmi_station_preview(
  TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mmi_station_preview(
  TEXT, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_next_mmi_station_preview(
  p_kind TEXT,
  p_station_id TEXT
)
RETURNS TABLE (
  station_kind TEXT,
  station_id TEXT,
  title TEXT,
  category TEXT,
  topic TEXT,
  difficulty TEXT,
  university_tags TEXT[],
  prep_time_sec INTEGER,
  prompt_count INTEGER,
  student_brief TEXT,
  opening_line TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication is required';
  END IF;

  IF p_kind NOT IN ('standard', 'roleplay') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Unsupported station kind';
  END IF;

  RETURN QUERY
  WITH cards AS (
    SELECT
      'standard'::TEXT AS station_kind,
      s.station_id::TEXT AS station_id,
      s.topic::TEXT AS title,
      s.category::TEXT AS category,
      s.topic::TEXT AS topic,
      s.difficulty::TEXT AS difficulty,
      COALESCE(s.uni_tags, ARRAY[]::TEXT[])::TEXT[] AS university_tags,
      s.prep_time_sec::INTEGER AS prep_time_sec,
      COUNT(q.id)::INTEGER AS prompt_count,
      s.scenario_text::TEXT AS student_brief,
      NULL::TEXT AS opening_line
    FROM public.mmi_stations AS s
    INNER JOIN public.mmi_sub_questions AS q
      ON q.station_id = s.station_id
    WHERE s.status::TEXT = 'published'
    GROUP BY
      s.station_id,
      s.topic,
      s.category,
      s.difficulty,
      s.uni_tags,
      s.prep_time_sec,
      s.scenario_text

    UNION ALL

    SELECT
      'roleplay'::TEXT AS station_kind,
      r.station_id::TEXT AS station_id,
      r.title::TEXT AS title,
      r.category::TEXT AS category,
      r.topic::TEXT AS topic,
      r.difficulty::TEXT AS difficulty,
      COALESCE(r.uni_tags, ARRAY[]::TEXT[])::TEXT[] AS university_tags,
      r.prep_time_sec::INTEGER AS prep_time_sec,
      1::INTEGER AS prompt_count,
      r.title::TEXT AS student_brief,
      r.opening_line::TEXT AS opening_line
    FROM public.roleplay_stations AS r
    WHERE r.status::TEXT = 'published'
  ),
  current_card AS (
    SELECT c.title, c.station_kind, c.station_id
    FROM cards AS c
    WHERE (c.station_kind, c.station_id) = (p_kind, p_station_id)
  ),
  ranked_alternatives AS (
    SELECT
      c.station_kind,
      c.station_id,
      c.title,
      c.category,
      c.topic,
      c.difficulty,
      c.university_tags,
      c.prep_time_sec,
      c.prompt_count,
      c.student_brief,
      c.opening_line,
      CASE
        WHEN (c.title, c.station_kind, c.station_id) >
          (current.title, current.station_kind, current.station_id)
        THEN 0
        ELSE 1
      END AS wrap_order
    FROM cards AS c
    CROSS JOIN current_card AS current
    WHERE (c.station_kind, c.station_id) <> (p_kind, p_station_id)
  )
  SELECT
    c.station_kind,
    c.station_id,
    c.title,
    c.category,
    c.topic,
    c.difficulty,
    c.university_tags,
    c.prep_time_sec,
    c.prompt_count,
    c.student_brief,
    c.opening_line
  FROM ranked_alternatives AS c
  ORDER BY c.wrap_order, c.title, c.station_kind, c.station_id
  LIMIT 1;
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.get_next_mmi_station_preview(
  TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_mmi_station_preview(
  TEXT, TEXT
) TO authenticated;

COMMIT;
