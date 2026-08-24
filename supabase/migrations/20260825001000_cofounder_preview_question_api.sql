-- Closed-round legacy question API.
-- Additive migration: no rows or database objects are deleted.
-- This migration is committed for review and must not be applied without approval.

CREATE OR REPLACE FUNCTION public.list_legacy_questions(
  p_category public.question_category DEFAULT NULL,
  p_difficulty public.question_difficulty DEFAULT NULL,
  p_university text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  category public.question_category,
  subcategory text,
  text text,
  university_tags text[],
  difficulty public.question_difficulty,
  is_mmi_suitable boolean,
  times_attempted integer,
  avg_score numeric,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_limit integer := COALESCE(p_limit, 50);
  v_university text := NULLIF(lower(btrim(p_university)), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF v_limit NOT BETWEEN 1 AND 100 OR length(COALESCE(v_university, '')) > 60 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid question filters';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.category,
    q.subcategory,
    q.text,
    COALESCE(q.university_tags, ARRAY[]::text[]),
    q.difficulty,
    COALESCE(q.is_mmi_suitable, FALSE),
    COALESCE(q.times_attempted, 0),
    COALESCE(q.avg_score, 0),
    q.created_at
  FROM public.questions AS q
  WHERE q.is_active IS TRUE
    AND (p_category IS NULL OR q.category = p_category)
    AND (p_difficulty IS NULL OR q.difficulty = p_difficulty)
    AND (v_university IS NULL OR v_university = ANY(COALESCE(q.university_tags, ARRAY[]::text[])))
  ORDER BY q.created_at DESC, q.id
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_legacy_question(p_question_id uuid)
RETURNS TABLE (
  id uuid,
  category public.question_category,
  subcategory text,
  text text,
  university_tags text[],
  difficulty public.question_difficulty,
  is_mmi_suitable boolean,
  times_attempted integer,
  avg_score numeric,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.category,
    q.subcategory,
    q.text,
    COALESCE(q.university_tags, ARRAY[]::text[]),
    q.difficulty,
    COALESCE(q.is_mmi_suitable, FALSE),
    COALESCE(q.times_attempted, 0),
    COALESCE(q.avg_score, 0),
    q.created_at
  FROM public.questions AS q
  WHERE q.is_active IS TRUE
    AND q.id = p_question_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_legacy_question_counts()
RETURNS TABLE (
  category public.question_category,
  question_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  RETURN QUERY
  SELECT q.category, count(*)::bigint
  FROM public.questions AS q
  WHERE q.is_active IS TRUE
  GROUP BY q.category;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_legacy_questions(p_rows jsonb)
RETURNS TABLE (
  source_index integer,
  id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_index integer;
  v_row jsonb;
  v_category text;
  v_difficulty text;
  v_text text;
  v_subcategory text;
  v_guidance_notes text;
  v_tags text[];
  v_id uuid;
  v_allowed_keys constant text[] := ARRAY[
    'category',
    'text',
    'difficulty',
    'subcategory',
    'university_tags',
    'is_mmi_suitable',
    'guidance_notes',
    'is_active'
  ];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = v_user_id
      AND p.is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin access required';
  END IF;
  IF p_rows IS NULL
    OR jsonb_typeof(p_rows) <> 'array'
    OR NOT (jsonb_array_length(p_rows) BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'question batch must contain 1 to 500 rows';
  END IF;

  FOR v_index IN 0..jsonb_array_length(p_rows) - 1 LOOP
    v_row := p_rows->v_index;
    IF jsonb_typeof(v_row) <> 'object'
      OR NOT (v_row ?& v_allowed_keys)
      OR v_row - v_allowed_keys <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'question row has invalid fields';
    END IF;
    IF jsonb_typeof(v_row->'category') <> 'string'
      OR jsonb_typeof(v_row->'text') <> 'string'
      OR jsonb_typeof(v_row->'difficulty') <> 'string'
      OR jsonb_typeof(v_row->'university_tags') <> 'array'
      OR jsonb_typeof(v_row->'is_active') <> 'boolean'
      OR jsonb_typeof(v_row->'is_mmi_suitable') <> 'boolean'
      OR (jsonb_typeof(v_row->'subcategory') NOT IN ('string', 'null'))
      OR (jsonb_typeof(v_row->'guidance_notes') NOT IN ('string', 'null')) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'question row has invalid value types';
    END IF;

    v_category := lower(btrim(v_row->>'category'));
    v_difficulty := lower(btrim(v_row->>'difficulty'));
    v_text := btrim(v_row->>'text');
    v_subcategory := NULLIF(btrim(v_row->>'subcategory'), '');
    v_guidance_notes := NULLIF(btrim(v_row->>'guidance_notes'), '');
    IF v_category NOT IN ('motivation', 'ethics', 'nhs', 'teamwork', 'resilience', 'scenarios')
      OR v_difficulty NOT IN ('foundation', 'intermediate', 'advanced')
      OR length(v_text) NOT BETWEEN 20 AND 2000
      OR length(COALESCE(v_subcategory, '')) > 100
      OR length(COALESCE(v_guidance_notes, '')) > 4000
      OR jsonb_array_length(v_row->'university_tags') > 20 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'question row failed validation';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_row->'university_tags') AS tag(value)
      WHERE jsonb_typeof(tag.value) <> 'string'
        OR length(btrim(tag.value #>> '{}')) NOT BETWEEN 1 AND 60
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'question tags failed validation';
    END IF;

    SELECT COALESCE(array_agg(tag ORDER BY tag), ARRAY[]::text[])
    INTO v_tags
    FROM (
      SELECT DISTINCT lower(btrim(value)) AS tag
      FROM jsonb_array_elements_text(v_row->'university_tags')
    ) AS normalized_tags;

    INSERT INTO public.questions AS inserted_question (
      category,
      text,
      difficulty,
      subcategory,
      university_tags,
      is_mmi_suitable,
      guidance_notes,
      is_active
    ) VALUES (
      v_category::public.question_category,
      v_text,
      v_difficulty::public.question_difficulty,
      v_subcategory,
      v_tags,
      (v_row->>'is_mmi_suitable')::boolean,
      v_guidance_notes,
      (v_row->>'is_active')::boolean
    )
    RETURNING inserted_question.id INTO v_id;

    source_index := v_index;
    id := v_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.questions FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.list_legacy_questions(
  public.question_category,
  public.question_difficulty,
  text,
  integer
) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_legacy_question(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_legacy_question_counts() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_legacy_questions(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_legacy_questions(
  public.question_category,
  public.question_difficulty,
  text,
  integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_legacy_question(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_legacy_question_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_legacy_questions(jsonb) TO authenticated;
