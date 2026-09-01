-- Release hardening for browser-speech transcript persistence and scoring.
-- Raw microphone audio remains outside application storage; these controls apply to transcript text.
BEGIN;

ALTER TABLE public.candidate_mmi_station_response_drafts
  ADD COLUMN checkpoint_window_started_at timestamptz,
  ADD COLUMN checkpoint_count smallint NOT NULL DEFAULT 0
    CHECK (checkpoint_count BETWEEN 0 AND 5);

CREATE INDEX candidate_mmi_station_response_drafts_retention_cutoff
  ON public.candidate_mmi_station_response_drafts (accepted_at);

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
  v_checkpoint_window_started_at timestamptz;
  v_checkpoint_count smallint;
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

  SELECT * INTO v_session
  FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = v_user_id AND abandoned_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;

  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, v_now);
  IF v_now < v_session.started_at + interval '60 seconds'
    OR v_now >= v_session.started_at + interval '660 seconds' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_response_not_open';
  END IF;
  v_current_prompt := ((floor(extract(epoch FROM v_now - v_session.started_at))::integer - 60) / 120) + 1;
  SELECT * INTO v_window
  FROM public.candidate_mmi_station_window(v_session.started_at, p_prompt_order);
  IF p_prompt_order <> v_current_prompt OR v_now >= v_window.ends_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_response_not_open';
  END IF;

  SELECT * INTO v_existing
  FROM public.candidate_mmi_station_response_drafts
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order
  FOR UPDATE;
  IF FOUND AND p_client_revision <= v_existing.client_revision THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_candidate_mmi_checkpoint';
  END IF;

  IF FOUND
    AND v_existing.checkpoint_window_started_at IS NOT NULL
    AND v_now < v_existing.checkpoint_window_started_at + interval '1 second' THEN
    IF v_existing.checkpoint_count >= 5 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_checkpoint_rate_limited';
    END IF;
    v_checkpoint_window_started_at := v_existing.checkpoint_window_started_at;
    v_checkpoint_count := v_existing.checkpoint_count + 1;
  ELSE
    v_checkpoint_window_started_at := v_now;
    v_checkpoint_count := 1;
  END IF;

  INSERT INTO public.candidate_mmi_station_response_drafts (
    session_id,
    prompt_order,
    transcript,
    client_revision,
    accepted_at,
    checkpoint_window_started_at,
    checkpoint_count
  ) VALUES (
    p_session_id,
    p_prompt_order,
    p_transcript,
    p_client_revision,
    v_now,
    v_checkpoint_window_started_at,
    v_checkpoint_count
  )
  ON CONFLICT (session_id, prompt_order) DO UPDATE SET
    transcript = EXCLUDED.transcript,
    client_revision = EXCLUDED.client_revision,
    accepted_at = EXCLUDED.accepted_at,
    checkpoint_window_started_at = EXCLUDED.checkpoint_window_started_at,
    checkpoint_count = EXCLUDED.checkpoint_count;

  RETURN jsonb_build_object(
    'sessionId', p_session_id,
    'promptOrder', p_prompt_order,
    'draftRevision', p_client_revision,
    'acceptedAt', v_now
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

  PERFORM 1
  FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;

  DELETE FROM public.candidate_mmi_station_response_drafts
  WHERE session_id = p_session_id;
  UPDATE public.candidate_mmi_station_sessions
  SET abandoned_at = COALESCE(abandoned_at, clock_timestamp())
  WHERE id = p_session_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_candidate_mmi_response_scoring(
  p_user_id uuid,
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
  v_has_claim boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_prompt_order NOT BETWEEN 1 AND 5 OR p_lease_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_scoring_claim';
  END IF;
  IF (SELECT value FROM public.app_config WHERE key = 'normalized_mmi_station_enabled') IS DISTINCT FROM 'true' THEN
    RETURN jsonb_build_object('status', 'feature_disabled');
  END IF;

  SELECT response.* INTO v_response
  FROM public.candidate_mmi_station_responses AS response
  JOIN public.candidate_mmi_station_sessions AS session ON session.id = response.session_id
  WHERE session.user_id = p_user_id
    AND session.id = p_session_id
    AND response.prompt_order = p_prompt_order
  FOR UPDATE OF response, session;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_response_not_found';
  END IF;
  IF v_response.response_state = 'no_response' THEN
    RETURN jsonb_build_object('status', 'no_response');
  END IF;
  IF v_response.scoring_status = 'scored' THEN
    RETURN jsonb_build_object('status', 'scored', 'assessment', v_response.public_assessment);
  END IF;
  IF v_response.scoring_status = 'feedback_unavailable' THEN
    RETURN jsonb_build_object('status', 'feedback_unavailable');
  END IF;

  SELECT * INTO v_claim
  FROM public.candidate_mmi_response_scoring_claims
  WHERE response_id = v_response.id
  FOR UPDATE;
  v_has_claim := FOUND;

  IF v_response.finalized_transcript IS NULL THEN
    IF v_response.scoring_status IN ('pending', 'failed') THEN
      UPDATE public.candidate_mmi_station_responses
      SET scoring_status = 'feedback_unavailable'
      WHERE id = v_response.id;
    ELSIF v_response.scoring_status = 'in_progress'
      AND v_has_claim
      AND v_claim.lease_expires_at > v_now THEN
      RETURN jsonb_build_object('status', 'in_progress');
    ELSIF v_response.scoring_status = 'in_progress' THEN
      UPDATE public.candidate_mmi_station_responses
      SET scoring_status = 'failed'
      WHERE id = v_response.id;
      UPDATE public.candidate_mmi_station_responses
      SET scoring_status = 'feedback_unavailable'
      WHERE id = v_response.id;
    END IF;
    RETURN jsonb_build_object('status', 'feedback_unavailable');
  END IF;

  SELECT * INTO v_snapshot
  FROM public.candidate_mmi_station_prompt_snapshots
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  IF v_snapshot.rubric_snapshot IS NULL OR v_snapshot.scoring_contract_snapshot IS NULL THEN
    UPDATE public.candidate_mmi_station_responses
    SET scoring_status = 'feedback_unavailable'
    WHERE id = v_response.id AND scoring_status IN ('pending', 'failed');
    RETURN jsonb_build_object('status', 'feedback_unavailable');
  END IF;
  IF v_has_claim AND v_claim.lease_expires_at > v_now THEN
    RETURN jsonb_build_object('status', 'in_progress');
  END IF;
  IF v_has_claim AND v_claim.attempt_count >= 3 THEN
    IF v_response.scoring_status = 'in_progress' THEN
      UPDATE public.candidate_mmi_station_responses
      SET scoring_status = 'failed'
      WHERE id = v_response.id;
    END IF;
    UPDATE public.candidate_mmi_station_responses
    SET scoring_status = 'feedback_unavailable'
    WHERE id = v_response.id AND scoring_status IN ('pending', 'failed');
    RETURN jsonb_build_object('status', 'feedback_unavailable');
  END IF;

  INSERT INTO public.candidate_mmi_response_scoring_claims (
    response_id,
    lease_token,
    lease_expires_at,
    attempt_count,
    last_error_code,
    updated_at
  ) VALUES (
    v_response.id,
    p_lease_token,
    v_now + interval '5 minutes',
    1,
    NULL,
    v_now
  )
  ON CONFLICT (response_id) DO UPDATE SET
    lease_token = EXCLUDED.lease_token,
    lease_expires_at = EXCLUDED.lease_expires_at,
    attempt_count = public.candidate_mmi_response_scoring_claims.attempt_count + 1,
    last_error_code = NULL,
    updated_at = EXCLUDED.updated_at;

  UPDATE public.candidate_mmi_station_responses
  SET scoring_status = 'in_progress'
  WHERE id = v_response.id AND scoring_status IN ('pending', 'failed');

  RETURN jsonb_build_object(
    'status', 'claimed',
    'responseId', v_response.id,
    'sessionId', p_session_id,
    'promptOrder', p_prompt_order,
    'transcript', v_response.finalized_transcript,
    'promptText', v_snapshot.prompt_text,
    'rubric', v_snapshot.rubric_snapshot,
    'scoringContract', v_snapshot.scoring_contract_snapshot
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_expired_candidate_mmi_free_text(p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_finalized_purged integer;
  v_drafts_purged integer;
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
  GET DIAGNOSTICS v_finalized_purged = ROW_COUNT;

  DELETE FROM public.candidate_mmi_station_response_drafts AS draft
  USING public.candidate_mmi_station_sessions AS session,
    public.mmi_privacy_notices AS notice
  WHERE draft.session_id = session.id
    AND notice.version = session.privacy_notice_version
    AND notice.retention_mode = 'fixed_days'
    AND draft.accepted_at < p_now - make_interval(days => notice.retention_days);
  GET DIAGNOSTICS v_drafts_purged = ROW_COUNT;

  RETURN jsonb_build_object('purged', v_finalized_purged + v_drafts_purged);
END;
$function$;

REVOKE ALL ON FUNCTION public.checkpoint_candidate_mmi_station_response(uuid, smallint, text, bigint),
  public.abandon_candidate_mmi_station_session(uuid),
  public.claim_candidate_mmi_response_scoring(uuid, uuid, smallint, uuid),
  public.purge_expired_candidate_mmi_free_text(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.checkpoint_candidate_mmi_station_response(uuid, smallint, text, bigint),
  public.abandon_candidate_mmi_station_session(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_candidate_mmi_response_scoring(uuid, uuid, smallint, uuid),
  public.purge_expired_candidate_mmi_free_text(timestamptz)
  TO service_role;

DO $postconditions$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND routine_name IN (
        'checkpoint_candidate_mmi_station_response',
        'abandon_candidate_mmi_station_session',
        'claim_candidate_mmi_response_scoring',
        'purge_expired_candidate_mmi_free_text'
      )
      AND grantee IN ('PUBLIC', 'anon')
  ) THEN
    RAISE EXCEPTION 'candidate MMI hardening functions expose unexpected execution privileges';
  END IF;
END;
$postconditions$;

COMMIT;
