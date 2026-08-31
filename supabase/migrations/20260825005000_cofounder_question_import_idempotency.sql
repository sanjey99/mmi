-- Retry-safe legacy workbook question imports.
--
-- Apply only after the final preview privilege cutover (040). This additive
-- migration gives imported source content a durable identity and records each
-- approved source batch. It does not modify or publish any existing question.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_role text;
  v_privilege text;
BEGIN
  IF to_regclass('public.questions') IS NULL
    OR to_regclass('public.profiles') IS NULL
    OR to_regprocedure('public.create_legacy_questions(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'question import idempotency prerequisites are missing';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    LOOP
      IF has_table_privilege(v_role, 'public.questions', v_privilege) THEN
        RAISE EXCEPTION 'question import requires the 040 direct-table cutover for role % privilege %', v_role, v_privilege;
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    LOOP
      IF has_any_column_privilege(v_role, 'public.questions', v_privilege) THEN
        RAISE EXCEPTION 'question import requires no direct question column grants for role % privilege %', v_role, v_privilege;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE public.questions
  ADD COLUMN source_namespace text,
  ADD COLUMN source_id text;

ALTER TABLE public.questions
  ADD CONSTRAINT questions_source_identity_valid
  CHECK (
    (source_namespace IS NULL AND source_id IS NULL)
    OR (
      source_namespace IS NOT NULL
      AND source_id IS NOT NULL
      AND source_namespace = lower(btrim(source_namespace))
      AND source_namespace ~ '^[a-z][a-z0-9_]{2,63}$'
      AND source_id = btrim(source_id)
      AND source_id ~ '^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$'
    )
  );

CREATE UNIQUE INDEX questions_source_identity_unique
  ON public.questions (source_namespace, source_id)
  WHERE source_namespace IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE public.question_import_batches (
  source_namespace text NOT NULL,
  source_manifest_sha256 text NOT NULL,
  batch_id text NOT NULL,
  payload_fingerprint text NOT NULL,
  row_count integer NOT NULL,
  applied_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_namespace, source_manifest_sha256, batch_id),
  CONSTRAINT question_import_batches_identity_valid CHECK (
    source_namespace = lower(btrim(source_namespace))
    AND source_namespace ~ '^[a-z][a-z0-9_]{2,63}$'
    AND source_manifest_sha256 ~ '^[a-f0-9]{64}$'
    AND batch_id = lower(btrim(batch_id))
    AND batch_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    AND payload_fingerprint ~ '^[a-f0-9]{64}$'
    AND row_count BETWEEN 1 AND 500
  )
);

ALTER TABLE public.question_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.question_import_batches FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.import_legacy_question_batch(
  p_source_namespace text,
  p_source_manifest_sha256 text,
  p_batch_id text,
  p_rows jsonb
)
RETURNS TABLE (
  source_index integer,
  id uuid,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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
  v_source_id text;
  v_id uuid;
  v_existing_id uuid;
  v_payload_fingerprint text;
  v_existing_fingerprint text;
  v_existing_row_count integer;
  v_batch_created boolean;
  v_seen_source_ids text[] := ARRAY[]::text[];
  v_allowed_keys constant text[] := ARRAY[
    'source_id',
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
  IF p_source_namespace IS NULL
    OR p_source_namespace <> lower(btrim(p_source_namespace))
    OR p_source_namespace !~ '^[a-z][a-z0-9_]{2,63}$'
    OR p_source_manifest_sha256 IS NULL
    OR p_source_manifest_sha256 !~ '^[a-f0-9]{64}$'
    OR p_batch_id IS NULL
    OR p_batch_id <> lower(btrim(p_batch_id))
    OR p_batch_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid source batch identity';
  END IF;
  IF p_rows IS NULL
    OR jsonb_typeof(p_rows) <> 'array'
    OR NOT (jsonb_array_length(p_rows) BETWEEN 1 AND 500) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'question batch must contain 1 to 500 rows';
  END IF;

  -- Validate all values before recording a batch claim. The claim and the
  -- upserts then commit atomically, so an ambiguous network retry is safe.
  FOR v_index IN 0..jsonb_array_length(p_rows) - 1 LOOP
    v_row := p_rows->v_index;
    IF jsonb_typeof(v_row) <> 'object'
      OR NOT (v_row ?& v_allowed_keys)
      OR v_row - v_allowed_keys <> '{}'::jsonb
      OR jsonb_typeof(v_row->'source_id') <> 'string'
      OR jsonb_typeof(v_row->'category') <> 'string'
      OR jsonb_typeof(v_row->'text') <> 'string'
      OR jsonb_typeof(v_row->'difficulty') <> 'string'
      OR jsonb_typeof(v_row->'university_tags') <> 'array'
      OR jsonb_typeof(v_row->'is_active') <> 'boolean'
      OR jsonb_typeof(v_row->'is_mmi_suitable') <> 'boolean'
      OR (jsonb_typeof(v_row->'subcategory') NOT IN ('string', 'null'))
      OR (jsonb_typeof(v_row->'guidance_notes') NOT IN ('string', 'null')) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'question row has invalid fields';
    END IF;

    v_source_id := btrim(v_row->>'source_id');
    v_category := lower(btrim(v_row->>'category'));
    v_difficulty := lower(btrim(v_row->>'difficulty'));
    v_text := btrim(v_row->>'text');
    v_subcategory := NULLIF(btrim(v_row->>'subcategory'), '');
    v_guidance_notes := NULLIF(btrim(v_row->>'guidance_notes'), '');
    IF v_source_id <> v_row->>'source_id'
      OR v_source_id !~ '^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$'
      OR v_source_id = ANY(v_seen_source_ids)
      OR v_category NOT IN ('motivation', 'ethics', 'nhs', 'teamwork', 'resilience', 'scenarios')
      OR v_difficulty NOT IN ('foundation', 'intermediate', 'advanced')
      OR length(v_text) NOT BETWEEN 20 AND 2000
      OR length(COALESCE(v_subcategory, '')) > 100
      OR length(COALESCE(v_guidance_notes, '')) > 4000
      OR jsonb_array_length(v_row->'university_tags') > 20
      OR (v_row->>'is_active')::boolean IS DISTINCT FROM FALSE THEN
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
    v_seen_source_ids := array_append(v_seen_source_ids, v_source_id);
  END LOOP;

  v_payload_fingerprint := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_rows::text, 'UTF8')),
    'hex'
  );
  INSERT INTO public.question_import_batches (
    source_namespace,
    source_manifest_sha256,
    batch_id,
    payload_fingerprint,
    row_count,
    applied_by
  ) VALUES (
    p_source_namespace,
    p_source_manifest_sha256,
    p_batch_id,
    v_payload_fingerprint,
    jsonb_array_length(p_rows),
    v_user_id
  )
  ON CONFLICT (source_namespace, source_manifest_sha256, batch_id) DO NOTHING
  RETURNING TRUE INTO v_batch_created;

  IF NOT COALESCE(v_batch_created, FALSE) THEN
    SELECT payload_fingerprint, row_count
    INTO v_existing_fingerprint, v_existing_row_count
    FROM public.question_import_batches
    WHERE source_namespace = p_source_namespace
      AND source_manifest_sha256 = p_source_manifest_sha256
      AND batch_id = p_batch_id;
    IF v_existing_fingerprint IS DISTINCT FROM v_payload_fingerprint
      OR v_existing_row_count IS DISTINCT FROM jsonb_array_length(p_rows) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'import batch identity was already used with a different payload';
    END IF;

    FOR v_index IN 0..jsonb_array_length(p_rows) - 1 LOOP
      SELECT q.id INTO v_id
      FROM public.questions AS q
      WHERE q.source_namespace = p_source_namespace
        AND q.source_id = btrim(p_rows->v_index->>'source_id');
      IF v_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'import batch record is missing a source question';
      END IF;
      source_index := v_index;
      id := v_id;
      outcome := 'retried';
      RETURN NEXT;
    END LOOP;
    RETURN;
  END IF;

  FOR v_index IN 0..jsonb_array_length(p_rows) - 1 LOOP
    v_row := p_rows->v_index;
    v_source_id := btrim(v_row->>'source_id');
    v_category := lower(btrim(v_row->>'category'));
    v_difficulty := lower(btrim(v_row->>'difficulty'));
    v_text := btrim(v_row->>'text');
    v_subcategory := NULLIF(btrim(v_row->>'subcategory'), '');
    v_guidance_notes := NULLIF(btrim(v_row->>'guidance_notes'), '');
    SELECT COALESCE(array_agg(tag ORDER BY tag), ARRAY[]::text[])
    INTO v_tags
    FROM (
      SELECT DISTINCT lower(btrim(value)) AS tag
      FROM jsonb_array_elements_text(v_row->'university_tags')
    ) AS normalized_tags;

    SELECT q.id
    INTO v_existing_id
    FROM public.questions AS q
    WHERE q.source_namespace = p_source_namespace
      AND q.source_id = v_source_id;

    INSERT INTO public.questions AS imported_question (
      source_namespace,
      source_id,
      category,
      text,
      difficulty,
      subcategory,
      university_tags,
      is_mmi_suitable,
      guidance_notes,
      is_active
    ) VALUES (
      p_source_namespace,
      v_source_id,
      v_category::public.question_category,
      v_text,
      v_difficulty::public.question_difficulty,
      v_subcategory,
      v_tags,
      (v_row->>'is_mmi_suitable')::boolean,
      v_guidance_notes,
      FALSE
    )
    ON CONFLICT (source_namespace, source_id)
      WHERE source_namespace IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET
      category = EXCLUDED.category,
      text = EXCLUDED.text,
      difficulty = EXCLUDED.difficulty,
      subcategory = EXCLUDED.subcategory,
      university_tags = EXCLUDED.university_tags,
      is_mmi_suitable = EXCLUDED.is_mmi_suitable,
      guidance_notes = EXCLUDED.guidance_notes,
      updated_at = now()
    WHERE imported_question.category IS DISTINCT FROM EXCLUDED.category
      OR imported_question.text IS DISTINCT FROM EXCLUDED.text
      OR imported_question.difficulty IS DISTINCT FROM EXCLUDED.difficulty
      OR imported_question.subcategory IS DISTINCT FROM EXCLUDED.subcategory
      OR imported_question.university_tags IS DISTINCT FROM EXCLUDED.university_tags
      OR imported_question.is_mmi_suitable IS DISTINCT FROM EXCLUDED.is_mmi_suitable
      OR imported_question.guidance_notes IS DISTINCT FROM EXCLUDED.guidance_notes
    RETURNING imported_question.id INTO v_id;

    IF v_id IS NULL THEN
      SELECT q.id INTO v_id
      FROM public.questions AS q
      WHERE q.source_namespace = p_source_namespace
        AND q.source_id = v_source_id;
      outcome := 'unchanged';
    ELSIF v_existing_id IS NULL THEN
      outcome := 'inserted';
    ELSE
      outcome := 'updated';
    END IF;

    source_index := v_index;
    id := v_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_legacy_question_batch(text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_legacy_question_batch(text, text, text, jsonb)
  TO authenticated;

DO $$
DECLARE
  v_role text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
  INTO v_owner, v_security_definer, v_config
  FROM pg_proc AS p
  WHERE p.oid = to_regprocedure('public.import_legacy_question_batch(text,text,text,jsonb)');
  IF v_owner <> 'postgres'
    OR v_security_definer IS DISTINCT FROM TRUE
    OR NOT (COALESCE(v_config, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public, pg_temp']) THEN
    RAISE EXCEPTION 'import RPC security-definer postcondition failed';
  END IF;
  IF has_function_privilege('public', 'public.import_legacy_question_batch(text,text,text,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.import_legacy_question_batch(text,text,text,jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.import_legacy_question_batch(text,text,text,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.import_legacy_question_batch(text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'import RPC ACL postcondition failed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class AS c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE c.oid = 'public.question_import_batches'::regclass
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'question import ledger must remain private for PUBLIC';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF has_table_privilege(v_role, 'public.question_import_batches', 'SELECT')
      OR has_table_privilege(v_role, 'public.question_import_batches', 'INSERT')
      OR has_table_privilege(v_role, 'public.question_import_batches', 'UPDATE')
      OR has_table_privilege(v_role, 'public.question_import_batches', 'DELETE')
      OR has_table_privilege(v_role, 'public.question_import_batches', 'TRUNCATE')
      OR has_table_privilege(v_role, 'public.question_import_batches', 'REFERENCES')
      OR has_table_privilege(v_role, 'public.question_import_batches', 'TRIGGER')
      OR has_table_privilege(v_role, 'public.question_import_batches', 'MAINTAIN')
      OR has_any_column_privilege(v_role, 'public.question_import_batches', 'SELECT')
      OR has_any_column_privilege(v_role, 'public.question_import_batches', 'INSERT')
      OR has_any_column_privilege(v_role, 'public.question_import_batches', 'UPDATE')
      OR has_any_column_privilege(v_role, 'public.question_import_batches', 'REFERENCES') THEN
      RAISE EXCEPTION 'question import ledger must remain private for role %', v_role;
    END IF;
  END LOOP;
  IF NOT has_function_privilege(
    'authenticated',
    'public.import_legacy_question_batch(text,text,text,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated import RPC grant postcondition failed';
  END IF;
END;
$$;

COMMIT;
