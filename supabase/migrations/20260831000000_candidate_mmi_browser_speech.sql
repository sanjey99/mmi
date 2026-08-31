-- Server-authoritative browser-speech MMI transcript persistence.
-- This migration deliberately stores reviewed text only.
BEGIN;

ALTER TABLE public.candidate_mmi_station_sessions
  ADD COLUMN privacy_notice_version text REFERENCES public.mmi_privacy_notices(version);

CREATE TABLE public.candidate_mmi_station_prompt_snapshots (
  session_id uuid NOT NULL REFERENCES public.candidate_mmi_station_sessions(id) ON DELETE CASCADE,
  prompt_order smallint NOT NULL CHECK (prompt_order BETWEEN 1 AND 5),
  sub_question_id text NOT NULL REFERENCES public.mmi_sub_questions(sub_q_id),
  prompt_text text NOT NULL CHECK (btrim(prompt_text) <> ''),
  rubric_snapshot jsonb,
  scoring_contract_snapshot jsonb,
  PRIMARY KEY (session_id, prompt_order),
  CONSTRAINT candidate_mmi_station_prompt_snapshot_scoring_pair CHECK (
    (rubric_snapshot IS NULL AND scoring_contract_snapshot IS NULL)
    OR (rubric_snapshot IS NOT NULL AND scoring_contract_snapshot IS NOT NULL)
  )
);

CREATE TABLE public.candidate_mmi_station_response_drafts (
  session_id uuid NOT NULL REFERENCES public.candidate_mmi_station_sessions(id) ON DELETE CASCADE,
  prompt_order smallint NOT NULL CHECK (prompt_order BETWEEN 1 AND 5),
  transcript text NOT NULL DEFAULT '' CHECK (char_length(transcript) <= 12000),
  client_revision bigint NOT NULL CHECK (client_revision >= 0),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (session_id, prompt_order)
);

CREATE TABLE public.candidate_mmi_station_responses (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  session_id uuid NOT NULL REFERENCES public.candidate_mmi_station_sessions(id) ON DELETE CASCADE,
  prompt_order smallint NOT NULL CHECK (prompt_order BETWEEN 1 AND 5),
  response_state text NOT NULL CHECK (response_state IN ('response', 'no_response')),
  finalized_transcript text CHECK (finalized_transcript IS NULL OR char_length(finalized_transcript) <= 12000),
  finalized_at timestamptz NOT NULL,
  finalization_key uuid NOT NULL UNIQUE,
  scoring_status text NOT NULL CHECK (scoring_status IN ('pending', 'in_progress', 'scored', 'no_response', 'feedback_unavailable', 'failed')),
  public_assessment jsonb,
  transcript_purged_at timestamptz,
  UNIQUE (session_id, prompt_order),
  CONSTRAINT candidate_mmi_station_response_text_state CHECK (
    (response_state = 'no_response' AND finalized_transcript IS NULL AND transcript_purged_at IS NULL AND scoring_status = 'no_response')
    OR (response_state = 'response' AND (finalized_transcript IS NOT NULL OR transcript_purged_at IS NOT NULL) AND scoring_status <> 'no_response')
  ),
  CONSTRAINT candidate_mmi_station_response_assessment_state CHECK (
    (scoring_status = 'scored') = (public_assessment IS NOT NULL)
  )
);

CREATE TABLE public.candidate_mmi_response_scoring_claims (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  response_id uuid NOT NULL UNIQUE REFERENCES public.candidate_mmi_station_responses(id) ON DELETE CASCADE,
  lease_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX candidate_mmi_station_responses_retention_cutoff
  ON public.candidate_mmi_station_responses (finalized_at)
  WHERE finalized_transcript IS NOT NULL AND transcript_purged_at IS NULL;
CREATE INDEX candidate_mmi_response_scoring_claims_lease
  ON public.candidate_mmi_response_scoring_claims (lease_expires_at);

CREATE OR REPLACE FUNCTION public.candidate_mmi_station_window(
  p_started_at timestamptz,
  p_prompt_order smallint
)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    p_started_at + interval '60 seconds' + (p_prompt_order - 1) * interval '120 seconds',
    p_started_at + interval '60 seconds' + p_prompt_order * interval '120 seconds';
$function$;

CREATE OR REPLACE FUNCTION public.candidate_mmi_browser_speech_contract()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT '{"version":"candidate-mmi-browser-speech-v1","input":"reviewed_transcript","output":"public_assessment"}'::jsonb;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_candidate_mmi_station_response_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.prompt_order IS DISTINCT FROM OLD.prompt_order
    OR NEW.response_state IS DISTINCT FROM OLD.response_state
    OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at
    OR NEW.finalization_key IS DISTINCT FROM OLD.finalization_key THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'immutable_candidate_mmi_response';
  END IF;
  IF OLD.transcript_purged_at IS NOT NULL
    AND (NEW.finalized_transcript IS DISTINCT FROM OLD.finalized_transcript
      OR NEW.transcript_purged_at IS DISTINCT FROM OLD.transcript_purged_at) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'purged_candidate_mmi_transcript_is_immutable';
  END IF;
  IF NEW.finalized_transcript IS DISTINCT FROM OLD.finalized_transcript
    AND NOT (OLD.finalized_transcript IS NOT NULL AND NEW.finalized_transcript IS NULL
      AND OLD.transcript_purged_at IS NULL AND NEW.transcript_purged_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_mmi_finalized_transcript_is_immutable';
  END IF;
  IF NEW.scoring_status IS DISTINCT FROM OLD.scoring_status
    AND NOT (
      (OLD.scoring_status IN ('pending', 'failed') AND NEW.scoring_status IN ('in_progress', 'feedback_unavailable'))
      OR (OLD.scoring_status = 'in_progress' AND NEW.scoring_status IN ('scored', 'failed'))
    ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_candidate_mmi_scoring_transition';
  END IF;
  IF NEW.public_assessment IS DISTINCT FROM OLD.public_assessment
    AND NOT (OLD.public_assessment IS NULL AND NEW.scoring_status = 'scored') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_mmi_assessment_is_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS candidate_mmi_station_response_immutable ON public.candidate_mmi_station_responses;
CREATE TRIGGER candidate_mmi_station_response_immutable
  BEFORE UPDATE ON public.candidate_mmi_station_responses
  FOR EACH ROW EXECUTE FUNCTION public.prevent_candidate_mmi_station_response_mutation();

CREATE OR REPLACE FUNCTION public.finalize_candidate_mmi_station_response_internal(
  p_session_id uuid,
  p_prompt_order smallint,
  p_finalization_key uuid,
  p_now timestamptz
)
RETURNS public.candidate_mmi_station_responses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_draft public.candidate_mmi_station_response_drafts;
  v_snapshot public.candidate_mmi_station_prompt_snapshots;
  v_existing public.candidate_mmi_station_responses;
  v_response_state text;
  v_scoring_status text;
BEGIN
  SELECT * INTO v_existing
  FROM public.candidate_mmi_station_responses
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_draft
  FROM public.candidate_mmi_station_response_drafts
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  SELECT * INTO v_snapshot
  FROM public.candidate_mmi_station_prompt_snapshots
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_prompt_snapshot_missing';
  END IF;

  v_response_state := CASE WHEN COALESCE(v_draft.transcript, '') = '' THEN 'no_response' ELSE 'response' END;
  v_scoring_status := CASE
    WHEN v_response_state = 'no_response' THEN 'no_response'
    WHEN v_snapshot.rubric_snapshot IS NULL OR v_snapshot.scoring_contract_snapshot IS NULL THEN 'feedback_unavailable'
    ELSE 'pending'
  END;
  INSERT INTO public.candidate_mmi_station_responses (
    session_id, prompt_order, response_state, finalized_transcript, finalized_at,
    finalization_key, scoring_status
  ) VALUES (
    p_session_id, p_prompt_order, v_response_state,
    CASE WHEN v_response_state = 'response' THEN v_draft.transcript END,
    p_now, p_finalization_key, v_scoring_status
  ) RETURNING * INTO v_existing;
  DELETE FROM public.candidate_mmi_station_response_drafts
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  RETURN v_existing;
END;
$function$;

CREATE OR REPLACE FUNCTION public.catch_up_candidate_mmi_station_responses(
  p_session_id uuid,
  p_now timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_started_at timestamptz;
  v_prompt_order smallint;
  v_window record;
BEGIN
  SELECT started_at INTO v_started_at
  FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_session_not_found';
  END IF;
  FOR v_prompt_order IN 1..5 LOOP
    SELECT * INTO v_window FROM public.candidate_mmi_station_window(v_started_at, v_prompt_order::smallint);
    EXIT WHEN p_now < v_window.ends_at;
    PERFORM public.finalize_candidate_mmi_station_response_internal(
      p_session_id, v_prompt_order::smallint, extensions.uuid_generate_v4(), v_window.ends_at
    );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_candidate_mmi_station_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_now timestamptz := clock_timestamp();
  v_station_id text;
  v_notice_version text;
  v_prompt record;
  v_snapshot_count integer := 0;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF (SELECT value FROM public.app_config WHERE key = 'normalized_mmi_station_enabled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'feature_disabled';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));
  SELECT session.id INTO v_session_id
  FROM public.candidate_mmi_station_sessions AS session
  WHERE session.user_id = v_user_id
    AND session.abandoned_at IS NULL
    AND session.privacy_notice_version IS NOT NULL
    AND v_now < session.started_at + interval '660 seconds'
  ORDER BY session.started_at DESC
  LIMIT 1
  FOR UPDATE;
  IF v_session_id IS NOT NULL THEN
    RETURN public.get_candidate_mmi_station_session(v_session_id);
  END IF;

  SELECT version INTO v_notice_version
  FROM public.mmi_privacy_notices
  WHERE is_active AND published_at IS NOT NULL
  LIMIT 1
  FOR SHARE;
  IF v_notice_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'active_privacy_notice_required';
  END IF;

  SELECT station.station_id INTO v_station_id
  FROM public.mmi_stations AS station
  LEFT JOIN public.candidate_mmi_station_sessions AS previous
    ON previous.user_id = v_user_id AND previous.station_id = station.station_id
  WHERE station.source_namespace = 'med_interview_question_bank'
    AND station.status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.mmi_normalized_station_import_batches AS batch
      WHERE batch.source_namespace = station.source_namespace
        AND batch.source_manifest_sha256 = station.source_manifest_sha256
        AND batch.normalized_manifest_sha256 = station.normalized_manifest_sha256
        AND batch.artifact_sha256 = station.source_artifact_sha256
        AND batch.finalized_at IS NOT NULL
    )
  GROUP BY station.station_id
  ORDER BY CASE WHEN max(previous.started_at) IS NULL THEN 0 ELSE 1 END,
    max(previous.started_at) ASC NULLS FIRST, station.station_id
  LIMIT 1;
  IF v_station_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate station unavailable';
  END IF;

  INSERT INTO public.candidate_mmi_station_sessions (user_id, station_id, started_at, privacy_notice_version)
  VALUES (v_user_id, v_station_id, v_now, v_notice_version)
  RETURNING id INTO v_session_id;
  FOR v_prompt IN
    SELECT question.sub_q_id, question.order_num, question.question_text,
      rubric.id AS rubric_id, rubric.version AS rubric_version, rubric.criteria,
      rubric.dimension_weights, rubric.safety_critical_items
    FROM public.mmi_sub_questions AS question
    LEFT JOIN public.mmi_scoring_rubrics AS rubric
      ON rubric.standard_sub_q_id = question.sub_q_id
      AND rubric.status = 'active'
      AND rubric.clinician_reviewed_at IS NOT NULL
      AND rubric.clinician_reviewed_by IS NOT NULL
    WHERE question.station_id = v_station_id
      AND question.source_namespace = 'med_interview_question_bank'
    ORDER BY question.order_num
  LOOP
    v_snapshot_count := v_snapshot_count + 1;
    INSERT INTO public.candidate_mmi_station_prompt_snapshots (
      session_id, prompt_order, sub_question_id, prompt_text, rubric_snapshot, scoring_contract_snapshot
    ) VALUES (
      v_session_id, v_prompt.order_num, v_prompt.sub_q_id, v_prompt.question_text,
      CASE WHEN v_prompt.rubric_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', v_prompt.rubric_id, 'version', v_prompt.rubric_version,
        'criteria', v_prompt.criteria, 'dimensionWeights', v_prompt.dimension_weights,
        'safetyCriticalItems', v_prompt.safety_critical_items
      ) END,
      CASE WHEN v_prompt.rubric_id IS NULL THEN NULL ELSE public.candidate_mmi_browser_speech_contract() END
    );
  END LOOP;
  IF v_snapshot_count <> 5 OR EXISTS (
    SELECT 1 FROM public.candidate_mmi_station_prompt_snapshots
    WHERE session_id = v_session_id AND prompt_order NOT BETWEEN 1 AND 5
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_prompt_snapshot_count_mismatch';
  END IF;
  RETURN public.get_candidate_mmi_station_session(v_session_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_candidate_mmi_station_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_session public.candidate_mmi_station_sessions;
  v_elapsed integer;
  v_prompt_order smallint;
  v_window record;
  v_snapshot public.candidate_mmi_station_prompt_snapshots;
  v_draft public.candidate_mmi_station_response_drafts;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF (SELECT value FROM public.app_config WHERE key = 'normalized_mmi_station_enabled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'feature_disabled';
  END IF;
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;
  IF v_session.abandoned_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id, 'stationId', v_session.station_id, 'serverNow', v_now,
      'phase', 'abandoned', 'phaseStartedAt', v_session.abandoned_at, 'phaseEndsAt', v_session.abandoned_at
    );
  END IF;
  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, v_now);
  v_elapsed := greatest(0, floor(extract(epoch FROM v_now - v_session.started_at))::integer);
  IF v_elapsed < 60 THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id, 'stationId', v_session.station_id, 'serverNow', v_now,
      'phase', 'scenario', 'phaseStartedAt', v_session.started_at,
      'phaseEndsAt', v_session.started_at + interval '60 seconds',
      'scenarioText', (SELECT scenario_text FROM public.mmi_stations WHERE station_id = v_session.station_id)
    );
  END IF;
  IF v_elapsed >= 660 THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id, 'stationId', v_session.station_id, 'serverNow', v_now,
      'phase', 'completed', 'phaseStartedAt', v_session.started_at + interval '660 seconds', 'phaseEndsAt', null
    );
  END IF;
  v_prompt_order := ((v_elapsed - 60) / 120) + 1;
  SELECT * INTO v_window FROM public.candidate_mmi_station_window(v_session.started_at, v_prompt_order::smallint);
  SELECT * INTO v_snapshot FROM public.candidate_mmi_station_prompt_snapshots
  WHERE session_id = p_session_id AND prompt_order = v_prompt_order;
  SELECT * INTO v_draft FROM public.candidate_mmi_station_response_drafts
  WHERE session_id = p_session_id AND prompt_order = v_prompt_order;
  IF NOT FOUND THEN
    v_draft.transcript := '';
    v_draft.client_revision := 0;
  END IF;
  RETURN jsonb_build_object(
    'sessionId', p_session_id, 'stationId', v_session.station_id, 'serverNow', v_now,
    'phase', 'response', 'phaseStartedAt', v_window.starts_at, 'phaseEndsAt', v_window.ends_at,
    'promptOrder', v_prompt_order, 'promptText', v_snapshot.prompt_text,
    'draftTranscript', v_draft.transcript, 'draftRevision', v_draft.client_revision, 'responseStatus', 'open'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.checkpoint_candidate_mmi_station_response(
  p_session_id uuid,
  p_prompt_order smallint,
  p_transcript text,
  p_client_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_session public.candidate_mmi_station_sessions;
  v_window record;
  v_current_prompt smallint;
  v_existing public.candidate_mmi_station_response_drafts;
  v_accepted_at timestamptz;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF (SELECT value FROM public.app_config WHERE key = 'normalized_mmi_station_enabled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'feature_disabled';
  END IF;
  IF p_prompt_order NOT BETWEEN 1 AND 5 OR p_transcript IS NULL OR p_client_revision < 0
    OR char_length(p_transcript) > 12000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_checkpoint';
  END IF;
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = v_user_id AND abandoned_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;
  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, v_now);
  IF v_now < v_session.started_at + interval '60 seconds' OR v_now >= v_session.started_at + interval '660 seconds' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_response_not_open';
  END IF;
  v_current_prompt := ((floor(extract(epoch FROM v_now - v_session.started_at))::integer - 60) / 120) + 1;
  SELECT * INTO v_window FROM public.candidate_mmi_station_window(v_session.started_at, p_prompt_order);
  IF p_prompt_order <> v_current_prompt OR v_now >= v_window.ends_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_response_not_open';
  END IF;
  SELECT * INTO v_existing FROM public.candidate_mmi_station_response_drafts
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order
  FOR UPDATE;
  IF FOUND AND p_client_revision <= v_existing.client_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_candidate_mmi_checkpoint';
  END IF;
  v_accepted_at := clock_timestamp();
  INSERT INTO public.candidate_mmi_station_response_drafts (
    session_id, prompt_order, transcript, client_revision, accepted_at
  ) VALUES (p_session_id, p_prompt_order, p_transcript, p_client_revision, v_accepted_at)
  ON CONFLICT (session_id, prompt_order) DO UPDATE SET
    transcript = EXCLUDED.transcript,
    client_revision = EXCLUDED.client_revision,
    accepted_at = EXCLUDED.accepted_at;
  RETURN jsonb_build_object(
    'sessionId', p_session_id, 'promptOrder', p_prompt_order,
    'draftRevision', p_client_revision, 'acceptedAt', v_accepted_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_candidate_mmi_station_response(
  p_session_id uuid,
  p_prompt_order smallint,
  p_finalization_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_session public.candidate_mmi_station_sessions;
  v_window record;
  v_response public.candidate_mmi_station_responses;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF (SELECT value FROM public.app_config WHERE key = 'normalized_mmi_station_enabled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'feature_disabled';
  END IF;
  IF p_prompt_order NOT BETWEEN 1 AND 5 OR p_finalization_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_finalization';
  END IF;
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = v_user_id AND abandoned_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;
  SELECT * INTO v_response FROM public.candidate_mmi_station_responses
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id, 'promptOrder', p_prompt_order,
      'responseState', v_response.response_state, 'finalizedAt', v_response.finalized_at,
      'scoringStatus', v_response.scoring_status
    );
  END IF;
  SELECT * INTO v_window FROM public.candidate_mmi_station_window(v_session.started_at, p_prompt_order);
  IF v_now < v_window.ends_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_response_deadline_not_reached';
  END IF;
  v_response := public.finalize_candidate_mmi_station_response_internal(
    p_session_id, p_prompt_order, p_finalization_key, v_window.ends_at
  );
  RETURN jsonb_build_object(
    'sessionId', p_session_id, 'promptOrder', p_prompt_order,
    'responseState', v_response.response_state, 'finalizedAt', v_response.finalized_at,
    'scoringStatus', v_response.scoring_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_candidate_mmi_station_feedback(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_session public.candidate_mmi_station_sessions;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF (SELECT value FROM public.app_config WHERE key = 'normalized_mmi_station_enabled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'feature_disabled';
  END IF;
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = v_user_id AND abandoned_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;
  IF v_now < v_session.started_at + interval '660 seconds' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_feedback_not_ready';
  END IF;
  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, v_now);
  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'promptOrder', response.prompt_order,
      'status', response.scoring_status,
      'assessment', CASE WHEN response.scoring_status = 'scored' THEN response.public_assessment ELSE NULL END
    ) ORDER BY response.prompt_order)
    FROM public.candidate_mmi_station_responses AS response
    WHERE response.session_id = p_session_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.abandon_candidate_mmi_station_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF (SELECT value FROM public.app_config WHERE key = 'normalized_mmi_station_enabled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'feature_disabled';
  END IF;
  PERFORM 1 FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;
  DELETE FROM public.candidate_mmi_station_response_drafts WHERE session_id = p_session_id;
  UPDATE public.candidate_mmi_station_sessions
  SET abandoned_at = COALESCE(abandoned_at, clock_timestamp())
  WHERE id = p_session_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_candidate_mmi_response_scoring(
  p_response_id uuid,
  p_session_id uuid,
  p_prompt_order smallint,
  p_lease_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_response public.candidate_mmi_station_responses;
  v_snapshot public.candidate_mmi_station_prompt_snapshots;
  v_claim public.candidate_mmi_response_scoring_claims;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_response_id IS NULL OR p_session_id IS NULL OR p_prompt_order NOT BETWEEN 1 AND 5 OR p_lease_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_scoring_claim';
  END IF;
  SELECT * INTO v_response FROM public.candidate_mmi_station_responses
  WHERE id = p_response_id AND session_id = p_session_id AND prompt_order = p_prompt_order
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_response_not_found';
  END IF;
  IF v_response.response_state = 'no_response' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_no_response_not_scoreable';
  END IF;
  SELECT * INTO v_snapshot FROM public.candidate_mmi_station_prompt_snapshots
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  IF v_snapshot.rubric_snapshot IS NULL OR v_snapshot.scoring_contract_snapshot IS NULL THEN
    UPDATE public.candidate_mmi_station_responses
    SET scoring_status = 'feedback_unavailable'
    WHERE id = p_response_id AND scoring_status IN ('pending', 'failed');
    RETURN jsonb_build_object('status', 'feedback_unavailable');
  END IF;
  IF v_response.scoring_status = 'scored' THEN
    RETURN jsonb_build_object('status', 'scored');
  END IF;
  SELECT * INTO v_claim FROM public.candidate_mmi_response_scoring_claims
  WHERE response_id = p_response_id
  FOR UPDATE;
  IF FOUND AND v_claim.lease_expires_at > v_now THEN
    RETURN jsonb_build_object('status', 'in_progress');
  END IF;
  INSERT INTO public.candidate_mmi_response_scoring_claims (
    response_id, lease_token, lease_expires_at, attempt_count, last_error_code, updated_at
  ) VALUES (p_response_id, p_lease_token, v_now + interval '5 minutes', 1, NULL, v_now)
  ON CONFLICT (response_id) DO UPDATE SET
    lease_token = EXCLUDED.lease_token,
    lease_expires_at = EXCLUDED.lease_expires_at,
    attempt_count = public.candidate_mmi_response_scoring_claims.attempt_count + 1,
    last_error_code = NULL,
    updated_at = EXCLUDED.updated_at;
  UPDATE public.candidate_mmi_station_responses
  SET scoring_status = 'in_progress'
  WHERE id = p_response_id AND scoring_status IN ('pending', 'failed');
  RETURN jsonb_build_object('status', 'claimed');
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_candidate_mmi_response_scoring(
  p_response_id uuid,
  p_session_id uuid,
  p_lease_token uuid,
  p_public_assessment jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_response_id IS NULL OR p_session_id IS NULL OR p_lease_token IS NULL
    OR p_public_assessment IS NULL OR jsonb_typeof(p_public_assessment) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_scoring_completion';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.candidate_mmi_response_scoring_claims AS claim
    JOIN public.candidate_mmi_station_responses AS response ON response.id = claim.response_id
    WHERE claim.response_id = p_response_id AND response.session_id = p_session_id
      AND claim.lease_token = p_lease_token AND claim.lease_expires_at > v_now
      AND response.scoring_status = 'in_progress'
    FOR UPDATE OF claim, response
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_candidate_mmi_scoring_lease';
  END IF;
  UPDATE public.candidate_mmi_station_responses
  SET scoring_status = 'scored', public_assessment = p_public_assessment
  WHERE id = p_response_id AND session_id = p_session_id;
  RETURN jsonb_build_object('status', 'scored');
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_candidate_mmi_response_scoring(
  p_response_id uuid,
  p_session_id uuid,
  p_lease_token uuid,
  p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_response_id IS NULL OR p_session_id IS NULL OR p_lease_token IS NULL
    OR p_error_code IS NULL OR p_error_code !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_scoring_failure';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.candidate_mmi_response_scoring_claims AS claim
    JOIN public.candidate_mmi_station_responses AS response ON response.id = claim.response_id
    WHERE claim.response_id = p_response_id AND response.session_id = p_session_id
      AND claim.lease_token = p_lease_token AND claim.lease_expires_at > v_now
      AND response.scoring_status = 'in_progress'
    FOR UPDATE OF claim, response
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_candidate_mmi_scoring_lease';
  END IF;
  UPDATE public.candidate_mmi_response_scoring_claims
  SET last_error_code = p_error_code, updated_at = v_now
  WHERE response_id = p_response_id;
  UPDATE public.candidate_mmi_station_responses
  SET scoring_status = 'failed'
  WHERE id = p_response_id AND session_id = p_session_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_expired_candidate_mmi_free_text(p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_purged integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_now IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate_mmi_purge_time_required';
  END IF;
  UPDATE public.candidate_mmi_station_responses AS response
  SET finalized_transcript = NULL, transcript_purged_at = p_now
  FROM public.candidate_mmi_station_sessions AS session
  JOIN public.mmi_privacy_notices AS notice ON notice.version = session.privacy_notice_version
  WHERE response.session_id = session.id
    AND response.response_state = 'response'
    AND response.finalized_transcript IS NOT NULL
    AND response.transcript_purged_at IS NULL
    AND notice.retention_mode = 'fixed_days'
    AND response.finalized_at < p_now - make_interval(days => notice.retention_days);
  GET DIAGNOSTICS v_purged = ROW_COUNT;
  RETURN jsonb_build_object('purged', v_purged);
END;
$function$;

ALTER TABLE public.candidate_mmi_station_prompt_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_station_response_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_station_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_response_scoring_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.candidate_mmi_station_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.candidate_mmi_station_prompt_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.candidate_mmi_station_response_drafts FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.candidate_mmi_station_responses FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.candidate_mmi_response_scoring_claims FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.candidate_mmi_station_sessions,
  public.candidate_mmi_station_prompt_snapshots,
  public.candidate_mmi_station_response_drafts,
  public.candidate_mmi_station_responses,
  public.candidate_mmi_response_scoring_claims TO service_role;

REVOKE ALL ON TABLE public.mmi_stations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.mmi_sub_questions FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.candidate_mmi_station_window(timestamptz, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.candidate_mmi_browser_speech_contract() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_candidate_mmi_station_response_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_candidate_mmi_station_response_internal(uuid, smallint, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catch_up_candidate_mmi_station_responses(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_candidate_mmi_station_session() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_candidate_mmi_station_session(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.abandon_candidate_mmi_station_session(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.checkpoint_candidate_mmi_station_response(uuid, smallint, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_candidate_mmi_station_response(uuid, smallint, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_candidate_mmi_station_feedback(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_candidate_mmi_response_scoring(uuid, uuid, smallint, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_candidate_mmi_response_scoring(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_candidate_mmi_response_scoring(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_expired_candidate_mmi_free_text(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.start_candidate_mmi_station_session() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_candidate_mmi_station_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_candidate_mmi_station_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.checkpoint_candidate_mmi_station_response(uuid, smallint, text, bigint)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_candidate_mmi_station_response(uuid, smallint, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_candidate_mmi_station_feedback(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_candidate_mmi_response_scoring(uuid, uuid, smallint, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_candidate_mmi_response_scoring(uuid, uuid, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_candidate_mmi_response_scoring(uuid, uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_candidate_mmi_free_text(timestamptz)
  TO service_role;

DO $postconditions$
DECLARE
  v_signature text;
  v_role text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_table regclass;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.start_candidate_mmi_station_session()',
    'public.get_candidate_mmi_station_session(uuid)',
    'public.abandon_candidate_mmi_station_session(uuid)',
    'public.checkpoint_candidate_mmi_station_response(uuid,smallint,text,bigint)',
    'public.finalize_candidate_mmi_station_response(uuid,smallint,uuid)',
    'public.get_candidate_mmi_station_feedback(uuid)',
    'public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid)',
    'public.complete_candidate_mmi_response_scoring(uuid,uuid,uuid,jsonb)',
    'public.fail_candidate_mmi_response_scoring(uuid,uuid,uuid,text)',
    'public.purge_expired_candidate_mmi_free_text(timestamptz)'
  ] LOOP
    SELECT pg_get_userbyid(proowner), prosecdef, proconfig
    INTO v_owner, v_security_definer, v_config
    FROM pg_proc WHERE oid = to_regprocedure(v_signature);
    IF v_owner <> 'postgres' OR v_security_definer IS DISTINCT FROM TRUE
      OR NOT (COALESCE(v_config, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION 'candidate browser-speech function security postcondition failed: %', v_signature;
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY[
    'public.candidate_mmi_station_prompt_snapshots'::regclass,
    'public.candidate_mmi_station_response_drafts'::regclass,
    'public.candidate_mmi_station_responses'::regclass,
    'public.candidate_mmi_response_scoring_claims'::regclass
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table) THEN
      RAISE EXCEPTION 'candidate browser-speech RLS postcondition failed: %', v_table;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(v_role, v_table, 'SELECT')
        OR has_table_privilege(v_role, v_table, 'INSERT')
        OR has_table_privilege(v_role, v_table, 'UPDATE')
        OR has_table_privilege(v_role, v_table, 'DELETE') THEN
        RAISE EXCEPTION 'candidate browser-speech private table ACL postcondition failed: %', v_table;
      END IF;
    END LOOP;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.mmi_stations', 'SELECT')
    OR has_table_privilege('authenticated', 'public.mmi_sub_questions', 'SELECT') THEN
    RAISE EXCEPTION 'candidate normalized-content ACL postcondition failed';
  END IF;
END;
$postconditions$;

COMMIT;
