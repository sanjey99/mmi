-- Persist complete rubric content from the verified workbook without exposing
-- assessor material to browser roles. Existing v1 migrations remain immutable.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.mmi_stations') IS NULL
    OR to_regclass('public.mmi_sub_questions') IS NULL
    OR to_regclass('public.mmi_normalized_station_import_batches') IS NULL
    OR to_regclass('public.questions') IS NULL
    OR to_regclass('public.question_import_batches') IS NULL
    OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'MMI rubric content prerequisites are missing';
  END IF;
END;
$$;

ALTER TABLE public.mmi_stations
  ADD COLUMN content_version integer NOT NULL DEFAULT 1,
  ADD COLUMN archived_at timestamptz;

ALTER TABLE public.mmi_sub_questions
  ADD COLUMN source_time_limit_sec integer NOT NULL DEFAULT 120
  CHECK (source_time_limit_sec IN (90, 120));

ALTER TABLE public.mmi_stations
  DROP CONSTRAINT IF EXISTS mmi_stations_status_check;
ALTER TABLE public.mmi_stations
  ADD CONSTRAINT mmi_stations_status_check
  CHECK (status IN ('draft', 'published', 'archived'));

-- Retain valid v1 ledger rows while allowing the reviewed v2 manifest.
ALTER TABLE public.mmi_normalized_station_import_batches
  DROP CONSTRAINT mmi_normalized_batch_identity_valid;
ALTER TABLE public.mmi_normalized_station_import_batches
  ADD CONSTRAINT mmi_normalized_batch_identity_valid CHECK (
    source_namespace = 'med_interview_question_bank'
    AND source_manifest_sha256 = '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
    AND normalized_manifest_sha256 IN (
      'd5410fe8b21130737b80fb02be8de024889c33065303cbafd104f332e7f31edb',
      'add7cf932a60e4573e3aca54c0cdecafd3c46c4421d245e2b3e71d8cbe8fa101'
    )
    AND batch_id IN ('normalized-stations-part-1', 'normalized-stations-part-2')
    AND artifact_sha256 ~ '^[a-f0-9]{64}$'
    AND payload_fingerprint ~ '^[a-f0-9]{64}$'
    AND station_count BETWEEN 1 AND 155
    AND sub_question_count BETWEEN 1 AND 775
  );

-- The clean migration chain does not create this assessor table, while the
-- reviewed hosted catalog already contains an older relation with this name.
-- Preserve that relation and all of its dependencies by OID, then reserve the
-- original name for the normalized v2 contract below.
DO $criteria_compatibility$
DECLARE
  v_relation_kind "char";
  v_columns text;
  v_privilege text;
  v_role text;
BEGIN
  IF to_regclass('public.mmi_marking_criteria_legacy_20260910') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy MMI marking-criteria archive already exists';
  END IF;

  IF to_regclass('public.mmi_marking_criteria') IS NOT NULL THEN
    SELECT relation.relkind
    INTO v_relation_kind
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'mmi_marking_criteria';

    IF v_relation_kind NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'hosted MMI marking-criteria relation has an unsupported kind';
    END IF;

    ALTER TABLE public.mmi_marking_criteria
      RENAME TO mmi_marking_criteria_legacy_20260910;
    ALTER TABLE public.mmi_marking_criteria_legacy_20260910
      ENABLE ROW LEVEL SECURITY;

    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mmi_marking_criteria_legacy_20260910';
    IF v_columns IS NULL THEN
      RAISE EXCEPTION 'legacy MMI marking-criteria archive has no columns';
    END IF;

    EXECUTE format(
      'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE public.mmi_marking_criteria_legacy_20260910 FROM PUBLIC, anon, authenticated, service_role',
      v_columns
    );
    REVOKE ALL ON TABLE public.mmi_marking_criteria_legacy_20260910
      FROM PUBLIC, anon, authenticated, service_role;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      FOREACH v_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] LOOP
        IF has_table_privilege(
          v_role,
          'public.mmi_marking_criteria_legacy_20260910',
          v_privilege
        ) THEN
          RAISE EXCEPTION 'legacy MMI marking-criteria archive privilege postcondition failed';
        END IF;
      END LOOP;
      IF current_setting('server_version_num')::integer >= 150000
        AND has_table_privilege(
          v_role,
          'public.mmi_marking_criteria_legacy_20260910',
          'MAINTAIN'
        ) THEN
        RAISE EXCEPTION 'legacy MMI marking-criteria archive privilege postcondition failed';
      END IF;
      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
        IF has_any_column_privilege(
          v_role,
          'public.mmi_marking_criteria_legacy_20260910',
          v_privilege
        ) THEN
          RAISE EXCEPTION 'legacy MMI marking-criteria archive privilege postcondition failed';
        END IF;
      END LOOP;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_class AS relation
      CROSS JOIN LATERAL aclexplode(
        COALESCE(relation.relacl, acldefault('r', relation.relowner))
      ) AS acl
      WHERE relation.oid = 'public.mmi_marking_criteria_legacy_20260910'::regclass
        AND acl.grantee = 0
        AND acl.privilege_type IN (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
        )
    ) OR EXISTS (
      SELECT 1
      FROM pg_attribute AS attribute
      CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
      WHERE attribute.attrelid = 'public.mmi_marking_criteria_legacy_20260910'::regclass
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND acl.grantee = 0
        AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
    ) THEN
      RAISE EXCEPTION 'legacy MMI marking-criteria archive privilege postcondition failed';
    END IF;
  END IF;
END;
$criteria_compatibility$;

CREATE TABLE public.mmi_marking_criteria (
  criterion_id text NOT NULL,
  sub_q_id text NOT NULL REFERENCES public.mmi_sub_questions(sub_q_id) ON DELETE CASCADE,
  order_num integer NOT NULL CHECK (order_num > 0),
  bullet_text text NOT NULL CHECK (char_length(btrim(bullet_text)) BETWEEN 1 AND 2000),
  source_weight numeric(8,3) NOT NULL CHECK (source_weight > 0),
  domain text CHECK (domain IS NULL OR char_length(btrim(domain)) BETWEEN 1 AND 100),
  source_namespace text NOT NULL,
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mmi_rubric_criteria_v2_pkey PRIMARY KEY (criterion_id),
  CONSTRAINT mmi_rubric_criteria_v2_sub_q_order_key UNIQUE (sub_q_id, order_num)
);

CREATE TABLE public.mmi_panel_questions (
  question_id text PRIMARY KEY,
  question_text text NOT NULL CHECK (char_length(btrim(question_text)) BETWEEN 1 AND 10000),
  station_type text NOT NULL CHECK (char_length(btrim(station_type)) BETWEEN 1 AND 100),
  topic text NOT NULL CHECK (char_length(btrim(topic)) BETWEEN 1 AND 100),
  difficulty public.question_difficulty NOT NULL,
  uni_tags text[] NOT NULL DEFAULT '{}',
  notes text CHECK (notes IS NULL OR char_length(notes) <= 20000),
  model_answer_cached text CHECK (model_answer_cached IS NULL OR char_length(model_answer_cached) <= 20000),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  source_namespace text NOT NULL,
  source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.mmi_station_versions (
  station_id text NOT NULL REFERENCES public.mmi_stations(station_id),
  version integer NOT NULL CHECK (version > 0),
  content_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(content_snapshot) = 'object'
    AND pg_column_size(content_snapshot) <= 1048576
  ),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (station_id, version)
);

CREATE FUNCTION public.reject_mmi_station_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'MMI station versions are immutable';
END;
$function$;

CREATE TRIGGER mmi_station_versions_immutable
BEFORE UPDATE OR DELETE ON public.mmi_station_versions
FOR EACH ROW EXECUTE FUNCTION public.reject_mmi_station_version_mutation();

REVOKE ALL ON FUNCTION public.reject_mmi_station_version_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX mmi_rubric_criteria_v2_sub_question_order
  ON public.mmi_marking_criteria (sub_q_id, order_num);
CREATE INDEX mmi_panel_questions_status
  ON public.mmi_panel_questions (status);
CREATE INDEX mmi_station_versions_created_at
  ON public.mmi_station_versions (station_id, created_at DESC);

ALTER TABLE public.mmi_marking_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_panel_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_station_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mmi_marking_criteria FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.mmi_panel_questions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.mmi_station_versions FROM PUBLIC, anon, authenticated, service_role;

-- Trusted server processes may read content, but all writes remain confined to
-- SECURITY DEFINER RPCs owned by postgres.
GRANT SELECT ON TABLE public.mmi_stations, public.mmi_sub_questions,
  public.mmi_marking_criteria, public.mmi_panel_questions, public.mmi_station_versions
  TO service_role;

CREATE OR REPLACE FUNCTION public.import_normalized_mmi_station_batch(
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
  v_source_namespace constant text := 'med_interview_question_bank';
  v_source_manifest_sha256 constant text := '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71';
  v_normalized_manifest_sha256 constant text := 'add7cf932a60e4573e3aca54c0cdecafd3c46c4421d245e2b3e71d8cbe8fa101';
  v_expected_artifact_sha256 text;
  v_expected_payload_fingerprint text;
  v_expected_station_count integer;
  v_expected_sub_question_count integer;
  v_expected_criterion_count integer;
  v_expected_panel_count integer;
  v_payload_fingerprint text;
  v_existing_fingerprint text;
  v_existing_station_count integer;
  v_existing_sub_question_count integer;
  v_station_index integer;
  v_question_index integer;
  v_criterion_index integer;
  v_panel_index integer;
  v_station jsonb;
  v_question jsonb;
  v_criterion jsonb;
  v_panel jsonb;
  v_station_id text;
  v_sub_q_id text;
  v_criterion_id text;
  v_panel_id text;
  v_source_flat_id text;
  v_category text;
  v_topic text;
  v_difficulty text;
  v_status text;
  v_tags text[];
  v_seen_station_ids text[] := ARRAY[]::text[];
  v_seen_sub_question_ids text[] := ARRAY[]::text[];
  v_seen_flat_ids text[] := ARRAY[]::text[];
  v_seen_criterion_ids text[] := ARRAY[]::text[];
  v_seen_panel_ids text[] := ARRAY[]::text[];
  v_station_count integer;
  v_sub_question_count integer := 0;
  v_criterion_count integer := 0;
  v_panel_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;

  IF p_batch_id = 'normalized-stations-part-1' THEN
    v_expected_artifact_sha256 := '9b1b7831331f0d0c8802a4d288f8bb529f8cf4b974c8c76803b044228e8865f3';
    v_expected_payload_fingerprint := '950e52261c043a819dab92183b423a15e43be1ac20e02c4e47927a7b10a0424e';
    v_expected_station_count := 80;
    v_expected_sub_question_count := 400;
    v_expected_criterion_count := 1600;
    v_expected_panel_count := 10;
  ELSIF p_batch_id = 'normalized-stations-part-2' THEN
    v_expected_artifact_sha256 := '4f056c38c91dcfe2460d7b8c7ebd1152551bee995b505c7458715a83a57744b1';
    v_expected_payload_fingerprint := '31ba173facd961ef14a9258a41f101c3cebe087b581c481133db88ff9602832c';
    v_expected_station_count := 75;
    v_expected_sub_question_count := 375;
    v_expected_criterion_count := 1500;
    v_expected_panel_count := 0;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unverified normalized import batch';
  END IF;

  IF p_normalized_manifest_sha256 IS DISTINCT FROM v_normalized_manifest_sha256
    OR p_artifact_sha256 IS DISTINCT FROM v_expected_artifact_sha256
    OR p_payload IS NULL
    OR jsonb_typeof(p_payload) <> 'object'
    OR NOT (p_payload ?& ARRAY['artifact_version', 'source_namespace', 'source_manifest_sha256', 'stations', 'panel_questions'])
    OR p_payload - ARRAY['artifact_version', 'source_namespace', 'source_manifest_sha256', 'stations', 'panel_questions'] <> '{}'::jsonb
    OR jsonb_typeof(p_payload->'artifact_version') <> 'number'
    OR (p_payload->>'artifact_version')::integer <> 2
    OR jsonb_typeof(p_payload->'source_namespace') <> 'string'
    OR (p_payload->>'source_namespace') IS DISTINCT FROM v_source_namespace
    OR jsonb_typeof(p_payload->'source_manifest_sha256') <> 'string'
    OR (p_payload->>'source_manifest_sha256') IS DISTINCT FROM v_source_manifest_sha256
    OR jsonb_typeof(p_payload->'stations') <> 'array'
    OR jsonb_typeof(p_payload->'panel_questions') <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized import provenance is invalid';
  END IF;

  v_station_count := jsonb_array_length(p_payload->'stations');
  v_panel_count := jsonb_array_length(p_payload->'panel_questions');
  IF v_station_count <> v_expected_station_count
    OR v_panel_count <> v_expected_panel_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized import top-level counts are invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.question_import_batches
    WHERE source_namespace = v_source_namespace
      AND source_manifest_sha256 = v_source_manifest_sha256
      AND batch_id = 'questions-part-1' AND row_count = 500
  ) OR NOT EXISTS (
    SELECT 1 FROM public.question_import_batches
    WHERE source_namespace = v_source_namespace
      AND source_manifest_sha256 = v_source_manifest_sha256
      AND batch_id = 'questions-part-2' AND row_count = 285
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'flat source manifest is not verified';
  END IF;

  -- Validate every nested object and all ownership relationships before any
  -- content write. Any later failure still rolls back this RPC transaction.
  FOR v_station_index IN 0..v_station_count - 1 LOOP
    v_station := p_payload->'stations'->v_station_index;
    IF jsonb_typeof(v_station) <> 'object'
      OR NOT (v_station ?& ARRAY['station_id', 'category', 'topic', 'difficulty', 'university_tags', 'prep_time_sec', 'status', 'image_url', 'scenario_text', 'sub_questions'])
      OR v_station - ARRAY['station_id', 'category', 'topic', 'difficulty', 'university_tags', 'prep_time_sec', 'status', 'image_url', 'scenario_text', 'sub_questions'] <> '{}'::jsonb
      OR jsonb_typeof(v_station->'station_id') <> 'string'
      OR jsonb_typeof(v_station->'category') <> 'string'
      OR jsonb_typeof(v_station->'topic') <> 'string'
      OR jsonb_typeof(v_station->'difficulty') <> 'string'
      OR jsonb_typeof(v_station->'university_tags') <> 'array'
      OR jsonb_typeof(v_station->'prep_time_sec') <> 'number'
      OR jsonb_typeof(v_station->'status') <> 'string'
      OR NOT (jsonb_typeof(v_station->'image_url') = 'null' OR jsonb_typeof(v_station->'image_url') = 'string')
      OR jsonb_typeof(v_station->'scenario_text') <> 'string'
      OR jsonb_typeof(v_station->'sub_questions') <> 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized station object is invalid';
    END IF;

    v_station_id := btrim(v_station->>'station_id');
    v_category := lower(btrim(v_station->>'category'));
    v_topic := btrim(v_station->>'topic');
    v_difficulty := lower(btrim(v_station->>'difficulty'));
    v_status := lower(btrim(v_station->>'status'));
    IF v_station_id !~ '^MMI_[0-9]{3}$'
      OR v_station_id = ANY(v_seen_station_ids)
      OR v_category NOT IN ('motivation', 'ethics', 'nhs', 'teamwork', 'resilience', 'scenarios')
      OR v_difficulty NOT IN ('foundation', 'intermediate', 'advanced')
      OR v_status NOT IN ('draft', 'published', 'archived')
      OR length(v_topic) NOT BETWEEN 1 AND 100
      OR length(btrim(v_station->>'scenario_text')) NOT BETWEEN 1 AND 10000
      OR (v_station->>'prep_time_sec')::integer <> 60
      OR (jsonb_typeof(v_station->'image_url') = 'string' AND length(v_station->>'image_url') NOT BETWEEN 1 AND 2000)
      OR jsonb_array_length(v_station->'university_tags') > 20
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
      SELECT 1 FROM public.mmi_stations AS station
      WHERE station.station_id = v_station_id
        AND station.source_namespace IS DISTINCT FROM v_source_namespace
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'station identity collides with curated content';
    END IF;
    v_seen_station_ids := array_append(v_seen_station_ids, v_station_id);

    FOR v_question_index IN 0..4 LOOP
      v_question := v_station->'sub_questions'->v_question_index;
      IF jsonb_typeof(v_question) <> 'object'
        OR NOT (v_question ?& ARRAY['sub_q_id', 'order_num', 'question_text', 'time_limit_sec', 'model_answer_cached', 'marking_criteria'])
        OR v_question - ARRAY['sub_q_id', 'order_num', 'question_text', 'time_limit_sec', 'model_answer_cached', 'marking_criteria'] <> '{}'::jsonb
        OR jsonb_typeof(v_question->'sub_q_id') <> 'string'
        OR jsonb_typeof(v_question->'order_num') <> 'number'
        OR jsonb_typeof(v_question->'question_text') <> 'string'
        OR jsonb_typeof(v_question->'time_limit_sec') <> 'number'
        OR NOT (jsonb_typeof(v_question->'model_answer_cached') = 'null' OR jsonb_typeof(v_question->'model_answer_cached') = 'string')
        OR jsonb_typeof(v_question->'marking_criteria') <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized sub-question object is invalid';
      END IF;

      v_sub_q_id := btrim(v_question->>'sub_q_id');
      v_source_flat_id := v_station_id || '/' || v_sub_q_id;
      -- Source duration is provenance-only and bounded here; the runtime row
      -- is canonicalized to the product's fixed 120-second response phase.
      IF (v_question->>'order_num')::integer <> v_question_index + 1
        OR (v_question->>'time_limit_sec')::integer NOT IN (90, 120)
        OR v_sub_q_id IS DISTINCT FROM v_station_id || '_Q' || (v_question_index + 1)::text
        OR v_sub_q_id = ANY(v_seen_sub_question_ids)
        OR v_source_flat_id = ANY(v_seen_flat_ids)
        OR length(btrim(v_question->>'question_text')) NOT BETWEEN 1 AND 10000
        OR (jsonb_typeof(v_question->'model_answer_cached') = 'string' AND length(v_question->>'model_answer_cached') > 20000)
        OR jsonb_array_length(v_question->'marking_criteria') <> 4
        OR NOT EXISTS (
          SELECT 1 FROM public.questions AS flat
          WHERE flat.source_namespace = v_source_namespace
            AND flat.source_id = v_source_flat_id
            AND flat.is_active IS TRUE
        ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized sub-question provenance is invalid';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.mmi_sub_questions AS question
        WHERE question.sub_q_id = v_sub_q_id
          AND question.source_namespace IS DISTINCT FROM v_source_namespace
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'sub-question identity collides with curated content';
      END IF;
      v_seen_sub_question_ids := array_append(v_seen_sub_question_ids, v_sub_q_id);
      v_seen_flat_ids := array_append(v_seen_flat_ids, v_source_flat_id);
      v_sub_question_count := v_sub_question_count + 1;

      FOR v_criterion_index IN 0..3 LOOP
        v_criterion := v_question->'marking_criteria'->v_criterion_index;
        IF jsonb_typeof(v_criterion) <> 'object'
          OR NOT (v_criterion ?& ARRAY['criterion_id', 'order_num', 'bullet_text', 'source_weight', 'domain'])
          OR v_criterion - ARRAY['criterion_id', 'order_num', 'bullet_text', 'source_weight', 'domain'] <> '{}'::jsonb
          OR jsonb_typeof(v_criterion->'criterion_id') <> 'string'
          OR jsonb_typeof(v_criterion->'order_num') <> 'number'
          OR jsonb_typeof(v_criterion->'bullet_text') <> 'string'
          OR jsonb_typeof(v_criterion->'source_weight') <> 'number'
          OR NOT (jsonb_typeof(v_criterion->'domain') = 'null' OR jsonb_typeof(v_criterion->'domain') = 'string') THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized criterion object is invalid';
        END IF;

        v_criterion_id := btrim(v_criterion->>'criterion_id');
        IF (v_criterion->>'order_num')::integer <> v_criterion_index + 1
          OR v_criterion_id IS DISTINCT FROM v_sub_q_id || '_C' || (v_criterion_index + 1)::text
          OR v_criterion_id = ANY(v_seen_criterion_ids)
          OR length(btrim(v_criterion->>'bullet_text')) NOT BETWEEN 1 AND 2000
          OR (v_criterion->>'source_weight')::numeric <= 0
          OR (v_criterion->>'source_weight')::numeric > 99999.999
          OR (jsonb_typeof(v_criterion->'domain') = 'string'
            AND length(btrim(v_criterion->>'domain')) NOT BETWEEN 1 AND 100) THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized criterion ownership or values are invalid';
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.mmi_marking_criteria AS criterion
          WHERE criterion.criterion_id = v_criterion_id
            AND criterion.source_namespace IS DISTINCT FROM v_source_namespace
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'criterion identity collides with curated content';
        END IF;
        v_seen_criterion_ids := array_append(v_seen_criterion_ids, v_criterion_id);
        v_criterion_count := v_criterion_count + 1;
      END LOOP;
    END LOOP;
  END LOOP;

  IF v_sub_question_count <> v_expected_sub_question_count
    OR v_criterion_count <> v_expected_criterion_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized nested counts are invalid';
  END IF;

  IF v_panel_count > 0 THEN
    FOR v_panel_index IN 0..v_panel_count - 1 LOOP
      v_panel := p_payload->'panel_questions'->v_panel_index;
      IF jsonb_typeof(v_panel) <> 'object'
        OR NOT (v_panel ?& ARRAY['question_id', 'question_text', 'category', 'topic', 'difficulty', 'university_tags', 'status', 'model_answer_cached', 'panel_notes'])
        OR v_panel - ARRAY['question_id', 'question_text', 'category', 'topic', 'difficulty', 'university_tags', 'status', 'model_answer_cached', 'panel_notes'] <> '{}'::jsonb
        OR jsonb_typeof(v_panel->'question_id') <> 'string'
        OR jsonb_typeof(v_panel->'question_text') <> 'string'
        OR jsonb_typeof(v_panel->'category') <> 'string'
        OR jsonb_typeof(v_panel->'topic') <> 'string'
        OR jsonb_typeof(v_panel->'difficulty') <> 'string'
        OR jsonb_typeof(v_panel->'university_tags') <> 'array'
        OR jsonb_typeof(v_panel->'status') <> 'string'
        OR NOT (jsonb_typeof(v_panel->'model_answer_cached') = 'null' OR jsonb_typeof(v_panel->'model_answer_cached') = 'string')
        OR NOT (jsonb_typeof(v_panel->'panel_notes') = 'null' OR jsonb_typeof(v_panel->'panel_notes') = 'string') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized panel object is invalid';
      END IF;

      v_panel_id := btrim(v_panel->>'question_id');
      v_category := lower(btrim(v_panel->>'category'));
      v_difficulty := lower(btrim(v_panel->>'difficulty'));
      v_status := lower(btrim(v_panel->>'status'));
      IF v_panel_id !~ '^PANEL_[0-9]{3}$'
        OR v_panel_id = ANY(v_seen_panel_ids)
        OR v_category NOT IN ('motivation', 'ethics', 'nhs', 'teamwork', 'resilience', 'scenarios')
        OR v_difficulty NOT IN ('foundation', 'intermediate', 'advanced')
        OR v_status NOT IN ('draft', 'published', 'archived')
        OR length(btrim(v_panel->>'question_text')) NOT BETWEEN 1 AND 10000
        OR length(btrim(v_panel->>'topic')) NOT BETWEEN 1 AND 100
        OR jsonb_array_length(v_panel->'university_tags') > 20
        OR (jsonb_typeof(v_panel->'model_answer_cached') = 'string' AND length(v_panel->>'model_answer_cached') > 20000)
        OR (jsonb_typeof(v_panel->'panel_notes') = 'string' AND length(v_panel->>'panel_notes') > 20000)
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_panel->'university_tags') AS tag(value)
          WHERE jsonb_typeof(tag.value) <> 'string'
            OR length(btrim(tag.value #>> '{}')) NOT BETWEEN 1 AND 60
        ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized panel values are invalid';
      END IF;
      SELECT COALESCE(array_agg(tag ORDER BY tag), ARRAY[]::text[])
      INTO v_tags
      FROM (
        SELECT DISTINCT lower(btrim(value)) AS tag
        FROM jsonb_array_elements_text(v_panel->'university_tags')
      ) AS tags;
      IF cardinality(v_tags) <> jsonb_array_length(v_panel->'university_tags') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized panel tags are invalid';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.mmi_panel_questions AS panel
        WHERE panel.question_id = v_panel_id
          AND panel.source_namespace IS DISTINCT FROM v_source_namespace
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'panel identity collides with curated content';
      END IF;
      v_seen_panel_ids := array_append(v_seen_panel_ids, v_panel_id);
    END LOOP;
  END IF;

  v_payload_fingerprint := encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex');
  IF v_payload_fingerprint IS DISTINCT FROM v_expected_payload_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized import payload fingerprint is invalid';
  END IF;

  INSERT INTO public.mmi_normalized_station_import_batches (
    source_namespace, source_manifest_sha256, normalized_manifest_sha256, batch_id,
    artifact_sha256, payload_fingerprint, station_count, sub_question_count
  ) VALUES (
    v_source_namespace, v_source_manifest_sha256, p_normalized_manifest_sha256, p_batch_id,
    p_artifact_sha256, v_payload_fingerprint, v_station_count, v_sub_question_count
  ) ON CONFLICT DO NOTHING;

  SELECT payload_fingerprint, station_count, sub_question_count
  INTO v_existing_fingerprint, v_existing_station_count, v_existing_sub_question_count
  FROM public.mmi_normalized_station_import_batches
  WHERE source_namespace = v_source_namespace
    AND source_manifest_sha256 = v_source_manifest_sha256
    AND normalized_manifest_sha256 = p_normalized_manifest_sha256
    AND batch_id = p_batch_id;
  IF v_existing_fingerprint IS DISTINCT FROM v_payload_fingerprint
    OR v_existing_station_count IS DISTINCT FROM v_station_count
    OR v_existing_sub_question_count IS DISTINCT FROM v_sub_question_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized batch identity was already used with another payload';
  END IF;

  -- Publication state, content_version, and archived_at are intentionally not
  -- changed by conflict updates during an ordinary re-import.
  FOR v_station_index IN 0..v_station_count - 1 LOOP
    v_station := p_payload->'stations'->v_station_index;
    v_station_id := btrim(v_station->>'station_id');
    SELECT COALESCE(array_agg(tag ORDER BY tag), ARRAY[]::text[])
    INTO v_tags
    FROM (
      SELECT DISTINCT lower(btrim(value)) AS tag
      FROM jsonb_array_elements_text(v_station->'university_tags')
    ) AS tags;

    INSERT INTO public.mmi_stations (
      station_id, category, topic, difficulty, uni_tags, prep_time_sec, image_url,
      status, scenario_text, source_namespace, source_manifest_sha256,
      normalized_manifest_sha256, source_artifact_sha256
    ) VALUES (
      v_station_id, lower(btrim(v_station->>'category')), btrim(v_station->>'topic'),
      lower(btrim(v_station->>'difficulty'))::public.question_difficulty, v_tags, 60,
      CASE WHEN jsonb_typeof(v_station->'image_url') = 'null' THEN NULL ELSE v_station->>'image_url' END,
      lower(btrim(v_station->>'status')), v_station->>'scenario_text',
      v_source_namespace, v_source_manifest_sha256, p_normalized_manifest_sha256,
      p_artifact_sha256
    ) ON CONFLICT (station_id) DO UPDATE SET
      category = EXCLUDED.category,
      topic = EXCLUDED.topic,
      difficulty = EXCLUDED.difficulty,
      uni_tags = EXCLUDED.uni_tags,
      prep_time_sec = EXCLUDED.prep_time_sec,
      image_url = EXCLUDED.image_url,
      scenario_text = EXCLUDED.scenario_text,
      source_namespace = EXCLUDED.source_namespace,
      source_manifest_sha256 = EXCLUDED.source_manifest_sha256,
      normalized_manifest_sha256 = EXCLUDED.normalized_manifest_sha256,
      source_artifact_sha256 = EXCLUDED.source_artifact_sha256,
      updated_at = clock_timestamp();

    FOR v_question_index IN 0..4 LOOP
      v_question := v_station->'sub_questions'->v_question_index;
      v_sub_q_id := btrim(v_question->>'sub_q_id');
      v_source_flat_id := v_station_id || '/' || v_sub_q_id;
      INSERT INTO public.mmi_sub_questions (
        sub_q_id, station_id, order_num, question_text, time_limit_sec, source_time_limit_sec,
        model_answer_cached, source_namespace, source_manifest_sha256,
        normalized_manifest_sha256, source_artifact_sha256, source_flat_id
      ) VALUES (
        v_sub_q_id, v_station_id, v_question_index + 1, v_question->>'question_text', 120,
        (v_question->>'time_limit_sec')::integer,
        CASE WHEN jsonb_typeof(v_question->'model_answer_cached') = 'null' THEN NULL ELSE v_question->>'model_answer_cached' END,
        v_source_namespace, v_source_manifest_sha256, p_normalized_manifest_sha256,
        p_artifact_sha256, v_source_flat_id
      ) ON CONFLICT (sub_q_id) DO UPDATE SET
        station_id = EXCLUDED.station_id,
        order_num = EXCLUDED.order_num,
        question_text = EXCLUDED.question_text,
        time_limit_sec = EXCLUDED.time_limit_sec,
        source_time_limit_sec = EXCLUDED.source_time_limit_sec,
        model_answer_cached = EXCLUDED.model_answer_cached,
        source_namespace = EXCLUDED.source_namespace,
        source_manifest_sha256 = EXCLUDED.source_manifest_sha256,
        normalized_manifest_sha256 = EXCLUDED.normalized_manifest_sha256,
        source_artifact_sha256 = EXCLUDED.source_artifact_sha256,
        source_flat_id = EXCLUDED.source_flat_id;

      FOR v_criterion_index IN 0..3 LOOP
        v_criterion := v_question->'marking_criteria'->v_criterion_index;
        INSERT INTO public.mmi_marking_criteria (
          criterion_id, sub_q_id, order_num, bullet_text, source_weight,
          domain, source_namespace, source_manifest_sha256
        ) VALUES (
          v_criterion->>'criterion_id', v_sub_q_id, v_criterion_index + 1,
          btrim(v_criterion->>'bullet_text'), (v_criterion->>'source_weight')::numeric,
          CASE WHEN jsonb_typeof(v_criterion->'domain') = 'null' THEN NULL ELSE lower(btrim(v_criterion->>'domain')) END,
          v_source_namespace, v_source_manifest_sha256
        ) ON CONFLICT (criterion_id) DO UPDATE SET
          sub_q_id = EXCLUDED.sub_q_id,
          order_num = EXCLUDED.order_num,
          bullet_text = EXCLUDED.bullet_text,
          source_weight = EXCLUDED.source_weight,
          domain = EXCLUDED.domain,
          source_namespace = EXCLUDED.source_namespace,
          source_manifest_sha256 = EXCLUDED.source_manifest_sha256;
      END LOOP;
    END LOOP;
  END LOOP;

  IF v_panel_count > 0 THEN
    FOR v_panel_index IN 0..v_panel_count - 1 LOOP
      v_panel := p_payload->'panel_questions'->v_panel_index;
      SELECT COALESCE(array_agg(tag ORDER BY tag), ARRAY[]::text[])
      INTO v_tags
      FROM (
        SELECT DISTINCT lower(btrim(value)) AS tag
        FROM jsonb_array_elements_text(v_panel->'university_tags')
      ) AS tags;
      INSERT INTO public.mmi_panel_questions (
        question_id, question_text, station_type, topic, difficulty, uni_tags,
        notes, model_answer_cached, status, source_namespace, source_manifest_sha256
      ) VALUES (
        v_panel->>'question_id', v_panel->>'question_text', lower(btrim(v_panel->>'category')),
        btrim(v_panel->>'topic'), lower(btrim(v_panel->>'difficulty'))::public.question_difficulty,
        v_tags,
        CASE WHEN jsonb_typeof(v_panel->'panel_notes') = 'null' THEN NULL ELSE v_panel->>'panel_notes' END,
        CASE WHEN jsonb_typeof(v_panel->'model_answer_cached') = 'null' THEN NULL ELSE v_panel->>'model_answer_cached' END,
        lower(btrim(v_panel->>'status')), v_source_namespace, v_source_manifest_sha256
      ) ON CONFLICT (question_id) DO UPDATE SET
        question_text = EXCLUDED.question_text,
        station_type = EXCLUDED.station_type,
        topic = EXCLUDED.topic,
        difficulty = EXCLUDED.difficulty,
        uni_tags = EXCLUDED.uni_tags,
        notes = EXCLUDED.notes,
        model_answer_cached = EXCLUDED.model_answer_cached,
        source_namespace = EXCLUDED.source_namespace,
        source_manifest_sha256 = EXCLUDED.source_manifest_sha256,
        updated_at = clock_timestamp();
    END LOOP;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_normalized_mmi_station_import(
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
  v_station_count integer;
  v_sub_question_count integer;
  v_criterion_count integer;
  v_panel_count integer;
  v_station_version_count integer;
  v_valid_station_count integer;
  v_invalid_station_count integer;
  v_panel_sub_question_count integer;
  v_preserved_active_flat_question_count integer;
  v_source_120_count integer;
  v_source_90_count integer;
  v_other_source_duration_count integer;
  v_first_finalization boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_source_namespace IS DISTINCT FROM 'med_interview_question_bank'
    OR p_source_manifest_sha256 IS DISTINCT FROM '903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71'
    OR p_normalized_manifest_sha256 IS DISTINCT FROM 'add7cf932a60e4573e3aca54c0cdecafd3c46c4421d245e2b3e71d8cbe8fa101' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized finalization provenance is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mmi_normalized_station_import_batches
    WHERE source_namespace = p_source_namespace
      AND source_manifest_sha256 = p_source_manifest_sha256
      AND normalized_manifest_sha256 = p_normalized_manifest_sha256
      AND batch_id = 'normalized-stations-part-1'
      AND artifact_sha256 = '9b1b7831331f0d0c8802a4d288f8bb529f8cf4b974c8c76803b044228e8865f3'
      AND payload_fingerprint = '950e52261c043a819dab92183b423a15e43be1ac20e02c4e47927a7b10a0424e'
      AND station_count = 80 AND sub_question_count = 400
  ) OR NOT EXISTS (
    SELECT 1 FROM public.mmi_normalized_station_import_batches
    WHERE source_namespace = p_source_namespace
      AND source_manifest_sha256 = p_source_manifest_sha256
      AND normalized_manifest_sha256 = p_normalized_manifest_sha256
      AND batch_id = 'normalized-stations-part-2'
      AND artifact_sha256 = '4f056c38c91dcfe2460d7b8c7ebd1152551bee995b505c7458715a83a57744b1'
      AND payload_fingerprint = '31ba173facd961ef14a9258a41f101c3cebe087b581c481133db88ff9602832c'
      AND station_count = 75 AND sub_question_count = 375
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized import is incomplete';
  END IF;

  SELECT count(*) INTO v_station_count
  FROM public.mmi_stations AS station
  WHERE station.source_namespace = p_source_namespace
    AND station.source_manifest_sha256 = p_source_manifest_sha256
    AND station.normalized_manifest_sha256 = p_normalized_manifest_sha256;
  SELECT count(*) INTO v_sub_question_count
  FROM public.mmi_sub_questions AS question
  WHERE question.source_namespace = p_source_namespace
    AND question.source_manifest_sha256 = p_source_manifest_sha256
    AND question.normalized_manifest_sha256 = p_normalized_manifest_sha256;
  SELECT count(*) INTO v_criterion_count
  FROM public.mmi_marking_criteria AS criterion
  JOIN public.mmi_sub_questions AS question ON question.sub_q_id = criterion.sub_q_id
  WHERE question.source_namespace = p_source_namespace
    AND question.source_manifest_sha256 = p_source_manifest_sha256
    AND question.normalized_manifest_sha256 = p_normalized_manifest_sha256;
  SELECT count(*) INTO v_panel_count
  FROM public.mmi_panel_questions AS panel
  WHERE panel.source_namespace = p_source_namespace
    AND panel.source_manifest_sha256 = p_source_manifest_sha256;
  SELECT
    count(*) FILTER (WHERE question.source_time_limit_sec = 120),
    count(*) FILTER (WHERE question.source_time_limit_sec = 90),
    count(*) FILTER (WHERE question.source_time_limit_sec NOT IN (90, 120))
  INTO v_source_120_count, v_source_90_count, v_other_source_duration_count
  FROM public.mmi_sub_questions AS question
  WHERE question.source_namespace = p_source_namespace
    AND question.source_manifest_sha256 = p_source_manifest_sha256
    AND question.normalized_manifest_sha256 = p_normalized_manifest_sha256;

  SELECT count(*) INTO v_valid_station_count
  FROM (
    SELECT station.station_id
    FROM public.mmi_stations AS station
    JOIN public.mmi_sub_questions AS question ON question.station_id = station.station_id
    WHERE station.source_namespace = p_source_namespace
      AND station.source_manifest_sha256 = p_source_manifest_sha256
      AND station.normalized_manifest_sha256 = p_normalized_manifest_sha256
    GROUP BY station.station_id
    HAVING array_agg(question.order_num ORDER BY question.order_num) = ARRAY[1, 2, 3, 4, 5]
      AND bool_and(question.time_limit_sec = 120)
      AND bool_and(question.source_flat_id = question.station_id || '/' || question.sub_q_id)
  ) AS valid_stations;
  v_invalid_station_count := v_station_count - v_valid_station_count;

  SELECT count(*) INTO v_panel_sub_question_count
  FROM public.mmi_sub_questions AS question
  WHERE question.source_namespace = p_source_namespace
    AND question.source_flat_id ~ '(^|/)PANEL_[0-9]{3}$';
  SELECT count(*) INTO v_preserved_active_flat_question_count
  FROM public.questions AS flat
  WHERE flat.source_namespace = p_source_namespace
    AND flat.is_active IS TRUE;

  IF v_station_count <> 155
    OR v_sub_question_count <> 775
    OR v_criterion_count <> 3100
    OR v_panel_count <> 10
    OR v_source_120_count <> 772
    OR v_source_90_count <> 3
    OR v_other_source_duration_count <> 0
    OR v_valid_station_count <> 155
    OR v_invalid_station_count <> 0
    OR v_panel_sub_question_count <> 0
    OR v_preserved_active_flat_question_count <> 785
    OR NOT EXISTS (
      SELECT 1
      FROM public.mmi_sub_questions AS question
      WHERE question.source_namespace = p_source_namespace
        AND question.normalized_manifest_sha256 = p_normalized_manifest_sha256
      HAVING count(DISTINCT question.source_flat_id) = 775
    )
    OR EXISTS (
      SELECT 1
      FROM public.mmi_sub_questions AS q
      LEFT JOIN public.mmi_marking_criteria AS c ON c.sub_q_id = q.sub_q_id
      WHERE q.source_namespace = p_source_namespace
        AND q.normalized_manifest_sha256 = p_normalized_manifest_sha256
      GROUP BY q.sub_q_id
      HAVING count(c.criterion_id) <> 4
    )
    OR EXISTS (
      SELECT 1 FROM public.mmi_sub_questions AS question
      LEFT JOIN public.questions AS flat
        ON flat.source_namespace = p_source_namespace
       AND flat.source_id = question.source_flat_id
       AND flat.is_active IS TRUE
      WHERE question.source_namespace = p_source_namespace
        AND question.normalized_manifest_sha256 = p_normalized_manifest_sha256
        AND flat.id IS NULL
    )
    OR EXISTS (
      SELECT flat.source_id
      FROM public.questions AS flat
      WHERE flat.source_namespace = p_source_namespace
        AND flat.is_active IS TRUE
      EXCEPT
      SELECT expected.source_id
      FROM (
        SELECT question.source_flat_id AS source_id
        FROM public.mmi_sub_questions AS question
        WHERE question.source_namespace = p_source_namespace
          AND question.source_manifest_sha256 = p_source_manifest_sha256
          AND question.normalized_manifest_sha256 = p_normalized_manifest_sha256
        UNION
        SELECT panel.question_id
        FROM public.mmi_panel_questions AS panel
        WHERE panel.source_namespace = p_source_namespace
          AND panel.source_manifest_sha256 = p_source_manifest_sha256
      ) AS expected
    )
    OR EXISTS (
      SELECT expected.source_id
      FROM (
        SELECT question.source_flat_id AS source_id
        FROM public.mmi_sub_questions AS question
        WHERE question.source_namespace = p_source_namespace
          AND question.source_manifest_sha256 = p_source_manifest_sha256
          AND question.normalized_manifest_sha256 = p_normalized_manifest_sha256
        UNION
        SELECT panel.question_id
        FROM public.mmi_panel_questions AS panel
        WHERE panel.source_namespace = p_source_namespace
          AND panel.source_manifest_sha256 = p_source_manifest_sha256
      ) AS expected
      EXCEPT
      SELECT flat.source_id
      FROM public.questions AS flat
      WHERE flat.source_namespace = p_source_namespace
        AND flat.is_active IS TRUE
    )
    OR EXISTS (
      SELECT 1
      FROM public.mmi_sub_questions AS question
      JOIN public.mmi_panel_questions AS panel
        ON panel.question_id = question.source_flat_id
      WHERE question.source_namespace = p_source_namespace
        AND question.source_manifest_sha256 = p_source_manifest_sha256
        AND question.normalized_manifest_sha256 = p_normalized_manifest_sha256
        AND panel.source_namespace = p_source_namespace
        AND panel.source_manifest_sha256 = p_source_manifest_sha256
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'normalized finalization checks failed';
  END IF;

  -- Immutable version 1 is created only after every import postcondition passes.
  INSERT INTO public.mmi_station_versions (station_id, version, content_snapshot, created_by)
  SELECT
    station.station_id,
    1,
    jsonb_build_object(
      'stationId', station.station_id,
      'contentVersion', station.content_version,
      'category', station.category,
      'topic', station.topic,
      'difficulty', station.difficulty::text,
      'universityTags', station.uni_tags,
      'prepTimeSec', station.prep_time_sec,
      'imageUrl', station.image_url,
      'scenarioText', station.scenario_text,
      'questions', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'subQuestionId', q.sub_q_id,
            'orderNum', q.order_num,
            'questionText', q.question_text,
            'timeLimitSec', q.time_limit_sec,
            'sourceTimeLimitSec', q.source_time_limit_sec,
            'modelAnswerCached', q.model_answer_cached,
            'criteria', (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'criterionId', c.criterion_id,
                  'orderNum', c.order_num,
                  'bulletText', c.bullet_text,
                  'sourceWeight', c.source_weight,
                  'domain', c.domain
                ) ORDER BY c.order_num
              )
              FROM public.mmi_marking_criteria AS c
              WHERE c.sub_q_id = q.sub_q_id
            )
          ) ORDER BY q.order_num
        )
        FROM public.mmi_sub_questions AS q
        WHERE q.station_id = station.station_id
      )
    ),
    auth.uid()
  FROM public.mmi_stations AS station
  WHERE station.source_namespace = p_source_namespace
    AND station.source_manifest_sha256 = p_source_manifest_sha256
    AND station.normalized_manifest_sha256 = p_normalized_manifest_sha256
  ON CONFLICT (station_id, version) DO NOTHING;

  SELECT count(*) INTO v_station_version_count
  FROM public.mmi_station_versions AS station_version
  JOIN public.mmi_stations AS station ON station.station_id = station_version.station_id
  WHERE station_version.version = 1
    AND station.source_namespace = p_source_namespace
    AND station.normalized_manifest_sha256 = p_normalized_manifest_sha256;
  IF v_station_version_count <> 155 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'station version snapshot checks failed';
  END IF;

  SELECT bool_and(batch.finalized_at IS NULL)
  INTO v_first_finalization
  FROM public.mmi_normalized_station_import_batches AS batch
  WHERE batch.source_namespace = p_source_namespace
    AND batch.source_manifest_sha256 = p_source_manifest_sha256
    AND batch.normalized_manifest_sha256 = p_normalized_manifest_sha256
    AND batch.batch_id IN ('normalized-stations-part-1', 'normalized-stations-part-2');

  IF v_first_finalization THEN
    UPDATE public.mmi_stations
    SET status = 'published', archived_at = NULL
    WHERE source_namespace = p_source_namespace
      AND source_manifest_sha256 = p_source_manifest_sha256
      AND normalized_manifest_sha256 = p_normalized_manifest_sha256;
  END IF;

  UPDATE public.mmi_normalized_station_import_batches
  SET finalized_at = COALESCE(finalized_at, clock_timestamp())
  WHERE source_namespace = p_source_namespace
    AND source_manifest_sha256 = p_source_manifest_sha256
    AND normalized_manifest_sha256 = p_normalized_manifest_sha256
    AND batch_id IN ('normalized-stations-part-1', 'normalized-stations-part-2');

  RETURN jsonb_build_object(
    'candidateStationCount', v_station_count,
    'candidateSubQuestionCount', v_sub_question_count,
    'candidateCriterionCount', v_criterion_count,
    'panelQuestionCount', v_panel_count,
    'stationVersionCount', v_station_version_count,
    'source120SecondQuestionCount', v_source_120_count,
    'source90SecondQuestionCount', v_source_90_count,
    'otherSourceDurationCount', v_other_source_duration_count,
    'validStationCount', v_valid_station_count,
    'invalidStationCount', v_invalid_station_count,
    'excludedPanelQuestionCount', v_panel_count,
    'panelSubQuestionCount', v_panel_sub_question_count,
    'preservedActiveFlatQuestionCount', v_preserved_active_flat_question_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.import_normalized_mmi_station_batch(text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_normalized_mmi_station_batch(text, text, text, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.finalize_normalized_mmi_station_import(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_normalized_mmi_station_import(text, text, text)
  TO service_role;

DO $$
DECLARE
  v_signature text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_role text;
  v_table text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.import_normalized_mmi_station_batch(text,text,text,jsonb)',
    'public.finalize_normalized_mmi_station_import(text,text,text)'
  ] LOOP
    SELECT pg_get_userbyid(proc.proowner), proc.prosecdef, proc.proconfig
    INTO v_owner, v_security_definer, v_config
    FROM pg_proc AS proc
    WHERE proc.oid = to_regprocedure(v_signature);
    IF v_owner <> 'postgres'
      OR v_security_definer IS DISTINCT FROM TRUE
      OR NOT (COALESCE(v_config, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public, pg_temp']) THEN
      RAISE EXCEPTION 'MMI rubric function security postcondition failed';
    END IF;
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'public.mmi_marking_criteria',
      'public.mmi_panel_questions',
      'public.mmi_station_versions'
    ] LOOP
      IF has_table_privilege(v_role, v_table, 'SELECT')
        OR has_table_privilege(v_role, v_table, 'INSERT')
        OR has_table_privilege(v_role, v_table, 'UPDATE')
        OR has_table_privilege(v_role, v_table, 'DELETE')
        OR has_table_privilege(v_role, v_table, 'TRUNCATE')
        OR has_table_privilege(v_role, v_table, 'REFERENCES')
        OR has_table_privilege(v_role, v_table, 'TRIGGER')
        OR has_any_column_privilege(v_role, v_table, 'SELECT')
        OR has_any_column_privilege(v_role, v_table, 'INSERT')
        OR has_any_column_privilege(v_role, v_table, 'UPDATE')
        OR has_any_column_privilege(v_role, v_table, 'REFERENCES') THEN
        RAISE EXCEPTION 'MMI rubric browser-table privilege postcondition failed';
      END IF;
      IF current_setting('server_version_num')::integer >= 150000
        AND has_table_privilege(v_role, v_table, 'MAINTAIN') THEN
        RAISE EXCEPTION 'MMI rubric browser-table maintenance privilege postcondition failed';
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS relation
    CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) AS acl
    WHERE relation.oid IN (
      'public.mmi_marking_criteria'::regclass,
      'public.mmi_panel_questions'::regclass,
      'public.mmi_station_versions'::regclass
    )
      AND acl.grantee = 0
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) OR EXISTS (
    SELECT 1
    FROM pg_attribute AS attribute
    CROSS JOIN LATERAL aclexplode(attribute.attacl) AS acl
    WHERE attribute.attrelid IN (
      'public.mmi_marking_criteria'::regclass,
      'public.mmi_panel_questions'::regclass,
      'public.mmi_station_versions'::regclass
    )
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND acl.grantee = 0
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
  ) THEN
    RAISE EXCEPTION 'MMI rubric PUBLIC ACL postcondition failed';
  END IF;
END;
$$;

COMMIT;
