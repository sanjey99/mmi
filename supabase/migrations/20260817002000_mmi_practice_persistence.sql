-- Versioned MMI practice persistence and service-owned lifecycle boundaries.
-- Client roles may read only their own safe attempt/result projections.
BEGIN;
DO $enum$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mmi_station_kind') THEN CREATE TYPE public.mmi_station_kind AS ENUM ('standard', 'roleplay'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mmi_attempt_status') THEN CREATE TYPE public.mmi_attempt_status AS ENUM ('in_progress', 'completed', 'abandoned'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mmi_attempt_phase') THEN CREATE TYPE public.mmi_attempt_phase AS ENUM ('preparing', 'prompt_active', 'awaiting_continue', 'final_feedback'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mmi_claim_status') THEN CREATE TYPE public.mmi_claim_status AS ENUM ('claimed', 'completed', 'retryable_failure'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mmi_rubric_status') THEN CREATE TYPE public.mmi_rubric_status AS ENUM ('draft', 'active', 'retired'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mmi_transcript_retention_mode') THEN CREATE TYPE public.mmi_transcript_retention_mode AS ENUM ('account_lifetime', 'fixed_days'); END IF;
END;
$enum$;
CREATE OR REPLACE FUNCTION public.is_valid_mmi_content_snapshot(p_snapshot JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_typeof(p_snapshot) = 'object'
    AND p_snapshot ?& ARRAY[
      'content_version', 'station_kind', 'station_id', 'title', 'category',
      'topic', 'difficulty', 'university_tags', 'prep_time_sec',
      'prompt_count', 'student_brief', 'opening_line'
    ]
    AND (SELECT COUNT(*) FROM jsonb_object_keys(p_snapshot)) = 12
    AND jsonb_typeof(p_snapshot->'station_kind') = 'string'
    AND p_snapshot->>'station_kind' IN ('standard', 'roleplay')
    AND jsonb_typeof(p_snapshot->'university_tags') = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_snapshot->'university_tags') AS tag
      WHERE jsonb_typeof(tag) <> 'string' OR BTRIM(tag #>> '{}') = ''
    )
    AND jsonb_typeof(p_snapshot->'prep_time_sec') = 'number'
    AND (p_snapshot->>'prep_time_sec')::NUMERIC BETWEEN 0 AND 3600
    AND jsonb_typeof(p_snapshot->'prompt_count') = 'number'
    AND (p_snapshot->>'prompt_count')::NUMERIC BETWEEN 1 AND 20
    AND (p_snapshot->>'prompt_count')::NUMERIC % 1 = 0
    AND jsonb_typeof(p_snapshot->'opening_line') IN ('string', 'null')
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_snapshot) AS entry
      WHERE entry.key = ANY (ARRAY[
        'content_version', 'station_id', 'title', 'category', 'topic',
        'difficulty', 'student_brief'
      ]) AND (jsonb_typeof(entry.value) <> 'string' OR BTRIM(entry.value #>> '{}') = '')
    );
$function$;
CREATE OR REPLACE FUNCTION public.is_valid_mmi_text_array(p_value JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_typeof(p_value) = 'array'
    AND jsonb_array_length(p_value) <= 20
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_value) AS item
      WHERE jsonb_typeof(item) <> 'string'
        OR CHAR_LENGTH(BTRIM(item #>> '{}')) NOT BETWEEN 1 AND 1000
    );
$function$;
CREATE OR REPLACE FUNCTION public.is_valid_mmi_dimension_weights(p_weights JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $function$
DECLARE
  v_entry RECORD;
  v_total NUMERIC := 0;
BEGIN
  IF jsonb_typeof(p_weights) <> 'object'
    OR NOT p_weights ?& ARRAY['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness']
    OR (SELECT COUNT(*) FROM jsonb_object_keys(p_weights)) <> 5 THEN
    RETURN FALSE;
  END IF;
  FOR v_entry IN SELECT key, value FROM jsonb_each(p_weights)
  LOOP
    IF jsonb_typeof(v_entry.value) <> 'number'
      OR (v_entry.value #>> '{}')::NUMERIC < 0
      OR (v_entry.value #>> '{}')::NUMERIC > 1 THEN
      RETURN FALSE;
    END IF;
    v_total := v_total + (v_entry.value #>> '{}')::NUMERIC;
  END LOOP;
  RETURN v_total = 1;
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_valid_mmi_safety_items(p_items JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item JSONB;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN RETURN FALSE; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
      OR NOT v_item ?& ARRAY['id', 'assessor_criterion', 'student_feedback']
      OR (SELECT COUNT(*) FROM jsonb_object_keys(v_item)) <> 3
      OR jsonb_typeof(v_item->'id') <> 'string'
      OR jsonb_typeof(v_item->'assessor_criterion') <> 'string'
      OR jsonb_typeof(v_item->'student_feedback') <> 'string'
      OR BTRIM(v_item->>'id') = ''
      OR BTRIM(v_item->>'assessor_criterion') = ''
      OR BTRIM(v_item->>'student_feedback') = '' THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN (SELECT COUNT(*) FROM jsonb_array_elements(p_items)) =
    (SELECT COUNT(DISTINCT value->>'id') FROM jsonb_array_elements(p_items));
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_valid_mmi_public_dimension_results(p_results JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF jsonb_typeof(p_results) <> 'object'
    OR NOT p_results ?& ARRAY['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness']
    OR (SELECT COUNT(*) FROM jsonb_object_keys(p_results)) <> 5 THEN
    RETURN FALSE;
  END IF;
  FOR v_result IN SELECT value FROM jsonb_each(p_results)
  LOOP
    IF jsonb_typeof(v_result) <> 'object'
      OR NOT v_result ?& ARRAY['score', 'applicable', 'evidence', 'improvement']
      OR (SELECT COUNT(*) FROM jsonb_object_keys(v_result)) <> 4
      OR jsonb_typeof(v_result->'applicable') <> 'boolean'
      OR jsonb_typeof(v_result->'evidence') NOT IN ('string', 'null')
      OR jsonb_typeof(v_result->'improvement') NOT IN ('string', 'null') THEN
      RETURN FALSE;
    END IF;
    IF (v_result->>'applicable')::BOOLEAN THEN
      IF jsonb_typeof(v_result->'score') <> 'number'
        OR (v_result->>'score')::NUMERIC NOT IN (1, 2, 3, 4, 5) THEN
        RETURN FALSE;
      END IF;
    ELSIF jsonb_typeof(v_result->'score') <> 'null'
      OR jsonb_typeof(v_result->'evidence') <> 'null'
      OR jsonb_typeof(v_result->'improvement') <> 'null' THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.mmi_dimension_results_has_no_free_text(p_results JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_each(p_results) AS dimension
    WHERE jsonb_typeof(dimension.value->'evidence') <> 'null'
      OR jsonb_typeof(dimension.value->'improvement') <> 'null'
  );
$function$;
CREATE TABLE IF NOT EXISTS public.mmi_privacy_notices (
  version TEXT PRIMARY KEY CHECK (BTRIM(version) <> ''),
  processor_name TEXT NOT NULL CHECK (BTRIM(processor_name) <> ''),
  notice_text TEXT NOT NULL CHECK (BTRIM(notice_text) <> ''),
  retention_mode public.mmi_transcript_retention_mode NOT NULL,
  retention_days INTEGER,
  published_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mmi_privacy_notices_retention_check CHECK (
    (retention_mode = 'fixed_days' AND retention_days IS NOT NULL AND retention_days > 0)
    OR (retention_mode = 'account_lifetime' AND retention_days IS NULL)
  ),
  CONSTRAINT mmi_privacy_notices_active_published CHECK (
    NOT is_active OR published_at IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS mmi_privacy_notices_one_active ON public.mmi_privacy_notices (is_active) WHERE is_active;
CREATE TABLE IF NOT EXISTS public.mmi_scoring_rubrics (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  standard_sub_q_id TEXT REFERENCES public.mmi_sub_questions(sub_q_id),
  roleplay_station_id TEXT REFERENCES public.roleplay_stations(station_id),
  version INTEGER NOT NULL CHECK (version > 0),
  status public.mmi_rubric_status NOT NULL DEFAULT 'draft',
  criteria JSONB NOT NULL CHECK (jsonb_typeof(criteria) = 'object'),
  dimension_weights JSONB NOT NULL
    CHECK (public.is_valid_mmi_dimension_weights(dimension_weights)),
  safety_critical_items JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (public.is_valid_mmi_safety_items(safety_critical_items)),
  clinician_reviewed_at TIMESTAMPTZ,
  clinician_reviewed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mmi_scoring_rubrics_one_target CHECK (
    num_nonnulls(standard_sub_q_id, roleplay_station_id) = 1
  ),
  CONSTRAINT mmi_scoring_rubrics_active_reviewed CHECK (
    status <> 'active' OR (
      clinician_reviewed_at IS NOT NULL AND clinician_reviewed_by IS NOT NULL
    )
  ),
  CONSTRAINT mmi_scoring_rubrics_standard_version UNIQUE (standard_sub_q_id, version),
  CONSTRAINT mmi_scoring_rubrics_roleplay_version UNIQUE (roleplay_station_id, version),
  CONSTRAINT mmi_scoring_rubrics_id_version UNIQUE (id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS mmi_scoring_rubrics_one_active_standard ON public.mmi_scoring_rubrics (standard_sub_q_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS mmi_scoring_rubrics_one_active_roleplay ON public.mmi_scoring_rubrics (roleplay_station_id) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS public.mmi_attempts (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  station_kind public.mmi_station_kind NOT NULL,
  standard_station_id TEXT REFERENCES public.mmi_stations(station_id),
  roleplay_station_id TEXT REFERENCES public.roleplay_stations(station_id),
  status public.mmi_attempt_status NOT NULL DEFAULT 'in_progress',
  phase public.mmi_attempt_phase NOT NULL DEFAULT 'preparing',
  preparation_ends_at TIMESTAMPTZ,
  current_prompt_order INTEGER NOT NULL DEFAULT 1,
  expected_prompt_count INTEGER NOT NULL CHECK (expected_prompt_count >= 1),
  content_snapshot JSONB NOT NULL
    CHECK (public.is_valid_mmi_content_snapshot(content_snapshot)),
  privacy_notice_version TEXT NOT NULL REFERENCES public.mmi_privacy_notices(version),
  privacy_notice_acknowledged_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ,
  overall_pct NUMERIC(5, 1) CHECK (overall_pct BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mmi_attempts_one_target CHECK (
    num_nonnulls(standard_station_id, roleplay_station_id) = 1
  ),
  CONSTRAINT mmi_attempts_prompt_order_check CHECK (
    current_prompt_order >= 1 AND current_prompt_order <= expected_prompt_count
  ),
  CONSTRAINT mmi_attempts_target_kind CHECK (
    (station_kind = 'standard' AND standard_station_id IS NOT NULL AND roleplay_station_id IS NULL)
    OR (station_kind = 'roleplay' AND roleplay_station_id IS NOT NULL AND standard_station_id IS NULL)
  ),
  CONSTRAINT mmi_attempts_terminal_timestamps CHECK (
    (status = 'in_progress' AND phase <> 'final_feedback'
      AND completed_at IS NULL AND abandoned_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND abandoned_at IS NULL AND phase = 'final_feedback')
    OR (status = 'abandoned' AND abandoned_at IS NOT NULL AND completed_at IS NULL)
  ),
  CONSTRAINT mmi_attempts_id_kind UNIQUE (id, station_kind),
  CONSTRAINT mmi_attempts_id_user_kind UNIQUE (id, user_id, station_kind),
  CONSTRAINT mmi_attempts_id_user UNIQUE (id, user_id)
);
CREATE INDEX IF NOT EXISTS mmi_attempts_user_started ON public.mmi_attempts (user_id, started_at DESC);
CREATE TABLE IF NOT EXISTS public.mmi_prompt_attempts (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  attempt_id UUID NOT NULL,
  station_kind public.mmi_station_kind NOT NULL,
  standard_sub_q_id TEXT REFERENCES public.mmi_sub_questions(sub_q_id),
  prompt_order INTEGER NOT NULL CHECK (prompt_order >= 1),
  reviewed_transcript TEXT,
  dimension_results JSONB NOT NULL
    CHECK (public.is_valid_mmi_public_dimension_results(dimension_results)),
  strengths JSONB CHECK (strengths IS NULL OR public.is_valid_mmi_text_array(strengths)),
  improvements JSONB CHECK (improvements IS NULL OR public.is_valid_mmi_text_array(improvements)),
  improvement_tip TEXT,
  overall_pct NUMERIC(5, 1) NOT NULL CHECK (overall_pct BETWEEN 0 AND 100),
  rubric_id UUID NOT NULL,
  rubric_version INTEGER NOT NULL CHECK (rubric_version > 0),
  scoring_contract_version TEXT NOT NULL CHECK (BTRIM(scoring_contract_version) <> ''),
  free_text_purged_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mmi_prompt_attempts_attempt_kind_fkey
    FOREIGN KEY (attempt_id, station_kind)
    REFERENCES public.mmi_attempts(id, station_kind) ON DELETE CASCADE,
  CONSTRAINT mmi_prompt_attempts_rubric_version_fkey
    FOREIGN KEY (rubric_id, rubric_version)
    REFERENCES public.mmi_scoring_rubrics(id, version),
  CONSTRAINT mmi_prompt_attempts_identity_check CHECK (
    (station_kind = 'standard' AND standard_sub_q_id IS NOT NULL)
    OR (station_kind = 'roleplay' AND standard_sub_q_id IS NULL)
  ),
  CONSTRAINT mmi_prompt_attempts_purge_consistency CHECK (
    free_text_purged_at IS NULL OR (
      reviewed_transcript IS NULL AND strengths IS NULL AND improvements IS NULL
      AND improvement_tip IS NULL
      AND public.mmi_dimension_results_has_no_free_text(dimension_results)
    )
  ),
  CONSTRAINT mmi_prompt_attempts_attempt_order_key UNIQUE (attempt_id, prompt_order),
  CONSTRAINT mmi_prompt_attempts_id_attempt_key UNIQUE (id, attempt_id)
);
CREATE TABLE IF NOT EXISTS public.mmi_attempt_prompt_snapshots (
  attempt_id UUID NOT NULL,
  station_kind public.mmi_station_kind NOT NULL,
  prompt_order INTEGER NOT NULL CHECK (prompt_order >= 1),
  standard_sub_q_id TEXT,
  prompt_text TEXT NOT NULL CHECK (BTRIM(prompt_text) <> ''),
  time_limit_sec INTEGER NOT NULL CHECK (time_limit_sec > 0),
  hidden_reference_answer TEXT,
  hidden_actor_context JSONB,
  rubric_id UUID NOT NULL,
  rubric_version INTEGER NOT NULL,
  rubric_criteria JSONB NOT NULL,
  rubric_dimension_weights JSONB NOT NULL
    CHECK (public.is_valid_mmi_dimension_weights(rubric_dimension_weights)),
  rubric_safety_critical_items JSONB NOT NULL
    CHECK (public.is_valid_mmi_safety_items(rubric_safety_critical_items)),
  content_version TEXT NOT NULL CHECK (BTRIM(content_version) <> ''),
  scoring_contract_version TEXT NOT NULL CHECK (BTRIM(scoring_contract_version) <> ''),
  global_contract_snapshot JSONB NOT NULL
    CHECK (jsonb_typeof(global_contract_snapshot) = 'object'),
  response_schema_snapshot JSONB NOT NULL
    CHECK (jsonb_typeof(response_schema_snapshot) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (attempt_id, prompt_order),
  FOREIGN KEY (attempt_id, station_kind)
    REFERENCES public.mmi_attempts(id, station_kind) ON DELETE CASCADE,
  FOREIGN KEY (rubric_id, rubric_version)
    REFERENCES public.mmi_scoring_rubrics(id, version),
  FOREIGN KEY (standard_sub_q_id)
    REFERENCES public.mmi_sub_questions(sub_q_id),
  CHECK (
    (station_kind = 'standard' AND standard_sub_q_id IS NOT NULL)
    OR (station_kind = 'roleplay' AND standard_sub_q_id IS NULL)
  )
);
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mmi_prompt_attempts_snapshot_fkey'
  ) THEN
    ALTER TABLE public.mmi_prompt_attempts
      ADD CONSTRAINT mmi_prompt_attempts_snapshot_fkey
      FOREIGN KEY (attempt_id, prompt_order)
      REFERENCES public.mmi_attempt_prompt_snapshots(attempt_id, prompt_order);
  END IF;
END;
$constraint$;
CREATE TABLE IF NOT EXISTS public.mmi_scoring_claims (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  idempotency_key UUID NOT NULL,
  station_kind public.mmi_station_kind NOT NULL,
  standard_sub_q_id TEXT,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  status public.mmi_claim_status NOT NULL DEFAULT 'claimed',
  lease_token UUID NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  provider_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (provider_attempt_count >= 0),
  safe_error_code TEXT CHECK (
    safe_error_code IS NULL OR safe_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  prompt_attempt_id UUID,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (attempt_id, user_id, station_kind)
    REFERENCES public.mmi_attempts(id, user_id, station_kind) ON DELETE CASCADE,
  FOREIGN KEY (prompt_attempt_id, attempt_id)
    REFERENCES public.mmi_prompt_attempts(id, attempt_id),
  CONSTRAINT mmi_scoring_claims_completion_check CHECK (
    (status = 'completed' AND prompt_attempt_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  CHECK (
    (station_kind = 'standard' AND standard_sub_q_id IS NOT NULL)
    OR (station_kind = 'roleplay' AND standard_sub_q_id IS NULL)
  ),
  CONSTRAINT mmi_scoring_claims_user_idempotency_key UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS mmi_scoring_claims_one_completed_standard ON public.mmi_scoring_claims (attempt_id, standard_sub_q_id)
  WHERE status = 'completed' AND station_kind = 'standard';
CREATE UNIQUE INDEX IF NOT EXISTS mmi_scoring_claims_one_completed_roleplay ON public.mmi_scoring_claims (attempt_id)
  WHERE status = 'completed' AND station_kind = 'roleplay';
CREATE TABLE IF NOT EXISTS public.mmi_transcription_events (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  byte_count INTEGER NOT NULL CHECK (byte_count > 0 AND byte_count <= 12 * 1024 * 1024),
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'audio/m4a', 'audio/mp4', 'audio/webm', 'audio/wav', 'audio/mpeg', 'audio/ogg'
  )),
  safe_outcome_code TEXT NOT NULL DEFAULT 'claimed'
    CHECK (safe_outcome_code ~ '^[a-z0-9_]{1,64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (attempt_id, user_id)
    REFERENCES public.mmi_attempts(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS mmi_transcription_events_user_created ON public.mmi_transcription_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mmi_prompt_attempts_retention_cutoff ON public.mmi_prompt_attempts (submitted_at) WHERE free_text_purged_at IS NULL;
CREATE INDEX IF NOT EXISTS mmi_scoring_claims_retention_cutoff ON public.mmi_scoring_claims (updated_at)
  WHERE status IN ('completed', 'retryable_failure');
CREATE INDEX IF NOT EXISTS mmi_transcription_events_retention_cutoff ON public.mmi_transcription_events (created_at);
CREATE OR REPLACE FUNCTION public.prevent_mmi_rubric_content_mutation() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.status IN ('active', 'retired') AND (
    NEW.standard_sub_q_id IS DISTINCT FROM OLD.standard_sub_q_id
    OR NEW.roleplay_station_id IS DISTINCT FROM OLD.roleplay_station_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.criteria IS DISTINCT FROM OLD.criteria
    OR NEW.dimension_weights IS DISTINCT FROM OLD.dimension_weights
    OR NEW.safety_critical_items IS DISTINCT FROM OLD.safety_critical_items
    OR NEW.clinician_reviewed_at IS DISTINCT FROM OLD.clinician_reviewed_at
    OR NEW.clinician_reviewed_by IS DISTINCT FROM OLD.clinician_reviewed_by
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'immutable_mmi_rubric_content';
  END IF;
  IF (OLD.status = 'active' AND NEW.status NOT IN ('active', 'retired'))
    OR (OLD.status = 'retired' AND NEW.status <> 'retired') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_mmi_rubric_status_transition';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.prevent_mmi_privacy_notice_content_mutation() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.published_at IS NOT NULL AND (
    NEW.version IS DISTINCT FROM OLD.version
    OR NEW.processor_name IS DISTINCT FROM OLD.processor_name
    OR NEW.notice_text IS DISTINCT FROM OLD.notice_text
    OR NEW.retention_mode IS DISTINCT FROM OLD.retention_mode
    OR NEW.retention_days IS DISTINCT FROM OLD.retention_days
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'immutable_mmi_privacy_notice';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.prevent_mmi_snapshot_mutation() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.mmi_attempts WHERE id = OLD.attempt_id
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'immutable_mmi_prompt_snapshot';
END;
$function$;
CREATE OR REPLACE FUNCTION public.enforce_mmi_attempt_progression() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result_count INTEGER; v_snapshot_count INTEGER; v_snapshot_mismatch BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT COALESCE(public.is_valid_mmi_content_snapshot(NEW.content_snapshot), FALSE)
      OR NEW.status <> 'in_progress' OR NEW.phase <> 'preparing'
      OR NEW.current_prompt_order <> 1 OR NEW.completed_at IS NOT NULL
      OR NEW.abandoned_at IS NOT NULL OR NEW.overall_pct IS NOT NULL
      OR NEW.content_snapshot->>'station_kind' IS DISTINCT FROM NEW.station_kind::TEXT
      OR NEW.content_snapshot->>'station_id' IS DISTINCT FROM
        COALESCE(NEW.standard_station_id, NEW.roleplay_station_id)
      OR (NEW.content_snapshot->>'prompt_count')::INTEGER IS DISTINCT FROM NEW.expected_prompt_count THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_mmi_attempt_initial_state';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.user_id, NEW.station_kind, NEW.standard_station_id, NEW.roleplay_station_id,
    NEW.expected_prompt_count, NEW.content_snapshot, NEW.privacy_notice_version,
    NEW.privacy_notice_acknowledged_at, NEW.started_at)
    IS DISTINCT FROM ROW(OLD.user_id, OLD.station_kind, OLD.standard_station_id,
      OLD.roleplay_station_id, OLD.expected_prompt_count, OLD.content_snapshot,
      OLD.privacy_notice_version, OLD.privacy_notice_acknowledged_at, OLD.started_at) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'immutable_mmi_attempt_identity';
  END IF;
  IF OLD.status IN ('completed', 'abandoned') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'terminal_mmi_attempt';
  END IF;
  IF NEW.status = 'in_progress' AND NEW.phase IS DISTINCT FROM OLD.phase AND NOT (
    (OLD.phase = 'preparing' AND NEW.phase = 'prompt_active')
    OR (OLD.phase = 'prompt_active' AND NEW.phase = 'awaiting_continue')
    OR (OLD.phase = 'awaiting_continue' AND NEW.phase = 'prompt_active')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_mmi_phase_transition';
  END IF;
  IF NEW.current_prompt_order < OLD.current_prompt_order
    OR NEW.current_prompt_order > OLD.current_prompt_order + 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_mmi_prompt_progression';
  END IF;
  IF NEW.current_prompt_order = OLD.current_prompt_order + 1 AND NOT (
    OLD.phase = 'awaiting_continue' AND NEW.phase = 'prompt_active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'mmi_feedback_acknowledgement_required';
  END IF;
  IF OLD.phase = 'awaiting_continue' AND NEW.phase = 'prompt_active'
    AND NEW.current_prompt_order <> OLD.current_prompt_order + 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_mmi_continue_transition';
  END IF;
  IF NEW.phase = 'awaiting_continue' AND NOT EXISTS (
    SELECT 1 FROM public.mmi_prompt_attempts
    WHERE attempt_id = NEW.id AND prompt_order = NEW.current_prompt_order
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'mmi_prompt_result_required';
  END IF;
  IF NEW.status = 'completed' THEN
    SELECT COUNT(*) INTO v_result_count FROM public.mmi_prompt_attempts WHERE attempt_id = NEW.id;
    SELECT COUNT(*) INTO v_snapshot_count FROM public.mmi_attempt_prompt_snapshots WHERE attempt_id = NEW.id;
    SELECT EXISTS (
      SELECT 1
      FROM generate_series(1, NEW.expected_prompt_count) AS expected(prompt_order)
      LEFT JOIN public.mmi_attempt_prompt_snapshots AS snapshot ON snapshot.attempt_id = NEW.id AND snapshot.prompt_order = expected.prompt_order
      LEFT JOIN public.mmi_prompt_attempts AS result ON result.attempt_id = NEW.id AND result.prompt_order = expected.prompt_order
      WHERE snapshot.prompt_order IS NULL OR result.id IS NULL OR ROW(
          result.station_kind, result.standard_sub_q_id, result.rubric_id,
          result.rubric_version, result.scoring_contract_version
        ) IS DISTINCT FROM ROW(snapshot.station_kind, snapshot.standard_sub_q_id,
          snapshot.rubric_id, snapshot.rubric_version, snapshot.scoring_contract_version)
    ) INTO v_snapshot_mismatch;
    IF v_result_count <> NEW.expected_prompt_count
      OR v_snapshot_count <> NEW.expected_prompt_count OR v_snapshot_mismatch
      OR NEW.current_prompt_order <> NEW.expected_prompt_count
      OR NEW.phase <> 'final_feedback' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'incomplete_mmi_attempt';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.enforce_mmi_prompt_attempt_mutation() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt public.mmi_attempts%ROWTYPE; v_snapshot public.mmi_attempt_prompt_snapshots%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_attempt FROM public.mmi_attempts WHERE id = NEW.attempt_id FOR UPDATE;
    IF NOT FOUND OR v_attempt.status <> 'in_progress'
      OR v_attempt.phase <> 'prompt_active'
      OR NEW.prompt_order <> v_attempt.current_prompt_order
      OR NEW.prompt_order > v_attempt.expected_prompt_count
      OR NEW.free_text_purged_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_mmi_prompt_result_state';
    END IF;
    NEW.submitted_at := LEAST(COALESCE(NEW.submitted_at, NOW()), NOW());
    SELECT * INTO v_snapshot FROM public.mmi_attempt_prompt_snapshots
      WHERE attempt_id = NEW.attempt_id AND prompt_order = NEW.prompt_order;
    IF NOT FOUND OR ROW(NEW.station_kind, NEW.standard_sub_q_id, NEW.rubric_id,
      NEW.rubric_version, NEW.scoring_contract_version) IS DISTINCT FROM ROW(
      v_snapshot.station_kind, v_snapshot.standard_sub_q_id, v_snapshot.rubric_id,
      v_snapshot.rubric_version, v_snapshot.scoring_contract_version
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'mmi_prompt_result_provenance_mismatch';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v_attempt FROM public.mmi_attempts WHERE id = OLD.attempt_id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN
    IF NOT FOUND THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'immutable_mmi_prompt_result';
  END IF;
  IF FOUND AND (
    OLD.free_text_purged_at IS NULL AND NEW.free_text_purged_at IS NOT NULL
    AND ROW(NEW.id, NEW.attempt_id, NEW.station_kind, NEW.standard_sub_q_id,
      NEW.prompt_order, NEW.overall_pct, NEW.rubric_id, NEW.rubric_version,
      NEW.scoring_contract_version, NEW.submitted_at, NEW.created_at, NEW.updated_at)
    IS NOT DISTINCT FROM ROW(OLD.id, OLD.attempt_id, OLD.station_kind,
      OLD.standard_sub_q_id, OLD.prompt_order, OLD.overall_pct, OLD.rubric_id,
      OLD.rubric_version, OLD.scoring_contract_version, OLD.submitted_at, OLD.created_at, OLD.updated_at)
    AND NEW.dimension_results = (
      SELECT jsonb_object_agg(key,
        jsonb_set(jsonb_set(value, '{evidence}', 'null'::JSONB),
          '{improvement}', 'null'::JSONB) ORDER BY key)
      FROM jsonb_each(OLD.dimension_results)
    )
    AND EXISTS (
      SELECT 1 FROM public.mmi_privacy_notices AS notice
      WHERE notice.version = v_attempt.privacy_notice_version
        AND notice.retention_mode = 'fixed_days'
        AND OLD.submitted_at < NOW() - make_interval(days => notice.retention_days)
    )
  ) THEN
    NEW.free_text_purged_at := NOW();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'immutable_mmi_prompt_result';
END;
$function$;
DROP TRIGGER IF EXISTS mmi_scoring_rubrics_immutable ON public.mmi_scoring_rubrics;
CREATE TRIGGER mmi_scoring_rubrics_immutable BEFORE UPDATE ON public.mmi_scoring_rubrics
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mmi_rubric_content_mutation();
DROP TRIGGER IF EXISTS mmi_privacy_notices_immutable ON public.mmi_privacy_notices;
CREATE TRIGGER mmi_privacy_notices_immutable BEFORE UPDATE ON public.mmi_privacy_notices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mmi_privacy_notice_content_mutation();
DROP TRIGGER IF EXISTS mmi_attempt_prompt_snapshots_immutable ON public.mmi_attempt_prompt_snapshots;
CREATE TRIGGER mmi_attempt_prompt_snapshots_immutable BEFORE UPDATE OR DELETE ON public.mmi_attempt_prompt_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mmi_snapshot_mutation();
DROP TRIGGER IF EXISTS mmi_attempts_progression ON public.mmi_attempts;
CREATE TRIGGER mmi_attempts_progression BEFORE INSERT OR UPDATE ON public.mmi_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mmi_attempt_progression();
DROP TRIGGER IF EXISTS mmi_prompt_attempts_immutable ON public.mmi_prompt_attempts;
CREATE TRIGGER mmi_prompt_attempts_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.mmi_prompt_attempts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mmi_prompt_attempt_mutation();
CREATE OR REPLACE FUNCTION public.get_active_mmi_privacy_notice() RETURNS TABLE (version TEXT, processor_name TEXT, notice_text TEXT,
  retention_mode public.mmi_transcript_retention_mode, retention_days INTEGER)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required';
  END IF;
  RETURN QUERY
  SELECT n.version, n.processor_name, n.notice_text, n.retention_mode, n.retention_days
  FROM public.mmi_privacy_notices AS n
  WHERE n.is_active AND n.published_at IS NOT NULL
  LIMIT 1;
END;
$function$;
CREATE OR REPLACE FUNCTION public.claim_mmi_transcription_attempt(
  p_user_id UUID,
  p_attempt_id UUID,
  p_byte_count INTEGER,
  p_mime_type TEXT
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event_id UUID;
  v_hour_count INTEGER;
  v_day_count INTEGER;
  v_day_bytes BIGINT;
BEGIN
  IF p_byte_count <= 0 OR p_byte_count > 12 * 1024 * 1024
    OR p_mime_type NOT IN ('audio/m4a', 'audio/mp4', 'audio/webm', 'audio/wav', 'audio/mpeg', 'audio/ogg') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_transcription_request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));
  IF NOT EXISTS (
    SELECT 1 FROM public.mmi_attempts
    WHERE id = p_attempt_id AND user_id = p_user_id AND status = 'in_progress'
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'invalid_transcription_attempt';
  END IF;
  SELECT
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '60 minutes'),
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'),
    COALESCE(SUM(byte_count) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'), 0)
  INTO v_hour_count, v_day_count, v_day_bytes
  FROM public.mmi_transcription_events WHERE user_id = p_user_id;
  IF v_hour_count >= 30 OR v_day_count >= 90
    OR v_day_bytes + p_byte_count > 300 * 1024 * 1024 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'transcription_rate_limit_exceeded';
  END IF;
  INSERT INTO public.mmi_transcription_events (user_id, attempt_id, byte_count, mime_type)
  VALUES (p_user_id, p_attempt_id, p_byte_count, p_mime_type)
  RETURNING id INTO v_event_id;
  RETURN v_event_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.complete_mmi_transcription_attempt(
  p_event_id UUID,
  p_safe_outcome_code TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_safe_outcome_code IS NULL
    OR p_safe_outcome_code !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_safe_outcome_code';
  END IF;
  UPDATE public.mmi_transcription_events
  SET safe_outcome_code = p_safe_outcome_code WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'transcription_event_not_found';
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.calculate_mmi_attempt_aggregate(p_attempt_id UUID) RETURNS TABLE (overall_pct NUMERIC, dimension_averages JSONB, prompt_count INTEGER) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $function$
  WITH dimensions(name) AS (
    VALUES ('structure'), ('ethics'), ('communication'), ('reflection'), ('nhs_awareness')
  ), aggregate_score AS (
    SELECT
      round(sum(overall_pct)::numeric / nullif(count(*), 0), 1) AS overall_pct,
      COUNT(*)::INTEGER AS prompt_count
    FROM public.mmi_prompt_attempts WHERE attempt_id = p_attempt_id
  ), dimension_score AS (
    SELECT d.name,
      ROUND(AVG((p.dimension_results->d.name->>'score')::NUMERIC), 1) AS score
    FROM dimensions AS d
    LEFT JOIN public.mmi_prompt_attempts AS p
      ON p.attempt_id = p_attempt_id
      AND jsonb_typeof(p.dimension_results->d.name->'score') = 'number'
    GROUP BY d.name
  )
  SELECT a.overall_pct,
    (SELECT jsonb_object_agg(name, score ORDER BY name) FROM dimension_score),
    a.prompt_count
  FROM aggregate_score AS a;
$function$;
CREATE OR REPLACE FUNCTION public.purge_expired_mmi_private_text() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_affected INTEGER;
  v_batch INTEGER;
BEGIN
  FOR v_batch IN 1..10 LOOP
    WITH expired AS (
      SELECT p.id FROM public.mmi_prompt_attempts AS p
      INNER JOIN public.mmi_attempts AS a ON a.id = p.attempt_id
      INNER JOIN public.mmi_privacy_notices AS n ON n.version = a.privacy_notice_version
      WHERE n.retention_mode = 'fixed_days' AND p.free_text_purged_at IS NULL
        AND p.submitted_at < NOW() - make_interval(days => n.retention_days)
      ORDER BY p.submitted_at, p.id LIMIT 1000 FOR UPDATE OF p SKIP LOCKED
    )
    UPDATE public.mmi_prompt_attempts AS p
    SET reviewed_transcript = NULL,
        dimension_results = (
          SELECT jsonb_object_agg(key,
            jsonb_set(jsonb_set(value, '{evidence}', 'null'::JSONB), '{improvement}', 'null'::JSONB)
          ) FROM jsonb_each(p.dimension_results)
        ), strengths = NULL, improvements = NULL, improvement_tip = NULL,
        free_text_purged_at = NOW()
    FROM expired WHERE p.id = expired.id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    EXIT WHEN v_affected < 1000;
  END LOOP;
  FOR v_batch IN 1..10 LOOP
    WITH expired AS (
      SELECT id FROM public.mmi_scoring_claims
      WHERE status IN ('completed', 'retryable_failure')
        AND updated_at < NOW() - INTERVAL '30 days'
      ORDER BY updated_at, id LIMIT 1000 FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.mmi_scoring_claims AS claim
    USING expired WHERE claim.id = expired.id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    EXIT WHEN v_affected < 1000;
  END LOOP;
  FOR v_batch IN 1..10 LOOP
    WITH expired AS (
      SELECT id FROM public.mmi_transcription_events
      WHERE created_at < NOW() - INTERVAL '30 days'
      ORDER BY created_at, id LIMIT 1000 FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.mmi_transcription_events AS event
    USING expired WHERE event.id = expired.id;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    EXIT WHEN v_affected < 1000;
  END LOOP;
END;
$function$;
ALTER TABLE public.mmi_privacy_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_scoring_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_prompt_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_attempt_prompt_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_scoring_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_transcription_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.mmi_privacy_notices FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mmi_scoring_rubrics FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mmi_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mmi_prompt_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mmi_attempt_prompt_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mmi_scoring_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.mmi_transcription_events FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.mmi_privacy_notices, public.mmi_scoring_rubrics,
  public.mmi_attempts, public.mmi_prompt_attempts, public.mmi_attempt_prompt_snapshots,
  public.mmi_scoring_claims, public.mmi_transcription_events TO service_role;
GRANT SELECT ON TABLE public.mmi_attempts TO authenticated;
GRANT SELECT ON TABLE public.mmi_prompt_attempts TO authenticated;
DROP POLICY IF EXISTS mmi_attempts_select_own ON public.mmi_attempts;
CREATE POLICY mmi_attempts_select_own ON public.mmi_attempts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS mmi_prompt_attempts_select_own ON public.mmi_prompt_attempts;
CREATE POLICY mmi_prompt_attempts_select_own ON public.mmi_prompt_attempts
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.mmi_attempts AS a
      WHERE a.id = attempt_id AND a.user_id = auth.uid()
    )
  );
REVOKE ALL PRIVILEGES ON FUNCTION public.is_valid_mmi_content_snapshot(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_valid_mmi_text_array(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_valid_mmi_dimension_weights(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_valid_mmi_safety_items(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_valid_mmi_public_dimension_results(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.mmi_dimension_results_has_no_free_text(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.prevent_mmi_rubric_content_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.prevent_mmi_privacy_notice_content_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.prevent_mmi_snapshot_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.enforce_mmi_attempt_progression() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.enforce_mmi_prompt_attempt_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.get_active_mmi_privacy_notice() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.claim_mmi_transcription_attempt(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.complete_mmi_transcription_attempt(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.calculate_mmi_attempt_aggregate(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.purge_expired_mmi_private_text() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_mmi_content_snapshot(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_mmi_text_array(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_mmi_dimension_weights(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_mmi_safety_items(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_mmi_public_dimension_results(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.mmi_dimension_results_has_no_free_text(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_active_mmi_privacy_notice() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mmi_transcription_attempt(UUID, UUID, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_mmi_transcription_attempt(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_mmi_attempt_aggregate(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_mmi_private_text() TO service_role;
GRANT USAGE ON TYPE public.mmi_station_kind, public.mmi_attempt_status,
  public.mmi_attempt_phase, public.mmi_claim_status, public.mmi_rubric_status,
  public.mmi_transcript_retention_mode TO service_role, authenticated;
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $cron$
DECLARE
  v_job_id BIGINT;
BEGIN
  FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname = 'mmi-purge-expired-private-text'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule(
    'mmi-purge-expired-private-text',
    '17 3 * * *',
    'SELECT public.purge_expired_mmi_private_text();'
  );
END;
$cron$;
COMMIT;
