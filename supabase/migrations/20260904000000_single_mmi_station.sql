-- One authenticated 11-minute MMI station for every signed-in user.
-- Audio is never stored. Finalized transcript text is retained for seven days.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DELETE FROM public.app_config
WHERE key = 'normalized_mmi_station_enabled';

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
  v_existing public.candidate_mmi_station_responses;
  v_response_state text;
BEGIN
  SELECT * INTO v_existing
  FROM public.candidate_mmi_station_responses
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  PERFORM 1
  FROM public.candidate_mmi_station_prompt_snapshots
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_prompt_snapshot_missing';
  END IF;

  SELECT * INTO v_draft
  FROM public.candidate_mmi_station_response_drafts
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;

  v_response_state := CASE
    WHEN COALESCE(v_draft.transcript, '') ~ '^[[:space:]]*$' THEN 'no_response'
    ELSE 'response'
  END;

  INSERT INTO public.candidate_mmi_station_responses (
    session_id,
    prompt_order,
    response_state,
    finalized_transcript,
    finalized_at,
    finalization_key,
    scoring_status
  ) VALUES (
    p_session_id,
    p_prompt_order,
    v_response_state,
    CASE WHEN v_response_state = 'response' THEN v_draft.transcript END,
    p_now,
    p_finalization_key,
    CASE WHEN v_response_state = 'response' THEN 'pending' ELSE 'no_response' END
  )
  RETURNING * INTO v_existing;

  DELETE FROM public.candidate_mmi_station_response_drafts
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;

  RETURN v_existing;
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
  v_prompt record;
  v_snapshot_count integer := 0;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));

  SELECT session.id INTO v_session_id
  FROM public.candidate_mmi_station_sessions AS session
  WHERE session.user_id = v_user_id
    AND session.abandoned_at IS NULL
    AND v_now < session.started_at + interval '660 seconds'
  ORDER BY session.started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_session_id IS NOT NULL THEN
    RETURN public.get_candidate_mmi_station_session(v_session_id);
  END IF;

  SELECT station.station_id INTO v_station_id
  FROM public.mmi_stations AS station
  LEFT JOIN public.candidate_mmi_station_sessions AS previous
    ON previous.user_id = v_user_id
    AND previous.station_id = station.station_id
  WHERE station.source_namespace = 'med_interview_question_bank'
    AND station.status = 'published'
    AND station.prep_time_sec = 60
    AND EXISTS (
      SELECT 1
      FROM public.mmi_sub_questions AS question
      WHERE question.station_id = station.station_id
        AND question.source_namespace = station.source_namespace
      GROUP BY question.station_id
      HAVING count(*) = 5
        AND count(DISTINCT question.order_num) = 5
        AND min(question.order_num) = 1
        AND max(question.order_num) = 5
        AND bool_and(question.time_limit_sec = 120)
    )
    AND EXISTS (
      SELECT 1
      FROM public.mmi_normalized_station_import_batches AS batch
      WHERE batch.source_namespace = station.source_namespace
        AND batch.source_manifest_sha256 = station.source_manifest_sha256
        AND batch.normalized_manifest_sha256 = station.normalized_manifest_sha256
        AND batch.artifact_sha256 = station.source_artifact_sha256
        AND batch.finalized_at IS NOT NULL
    )
  GROUP BY station.station_id
  ORDER BY
    CASE WHEN max(previous.started_at) IS NULL THEN 0 ELSE 1 END,
    max(previous.started_at) ASC NULLS FIRST,
    station.station_id
  LIMIT 1;

  IF v_station_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MMI station unavailable';
  END IF;

  INSERT INTO public.candidate_mmi_station_sessions (user_id, station_id, started_at)
  VALUES (v_user_id, v_station_id, v_now)
  RETURNING id INTO v_session_id;

  FOR v_prompt IN
    SELECT question.sub_q_id, question.order_num, question.question_text
    FROM public.mmi_sub_questions AS question
    WHERE question.station_id = v_station_id
      AND question.source_namespace = 'med_interview_question_bank'
    ORDER BY question.order_num
  LOOP
    v_snapshot_count := v_snapshot_count + 1;
    INSERT INTO public.candidate_mmi_station_prompt_snapshots (
      session_id,
      prompt_order,
      sub_question_id,
      prompt_text
    ) VALUES (
      v_session_id,
      v_prompt.order_num,
      v_prompt.sub_q_id,
      v_prompt.question_text
    );
  END LOOP;

  IF v_snapshot_count <> 5 OR EXISTS (
    SELECT 1
    FROM public.candidate_mmi_station_prompt_snapshots
    WHERE session_id = v_session_id
      AND prompt_order NOT BETWEEN 1 AND 5
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

  SELECT * INTO v_session
  FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;

  IF v_session.abandoned_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id,
      'stationId', v_session.station_id,
      'serverNow', v_now,
      'phase', 'abandoned',
      'phaseStartedAt', v_session.abandoned_at,
      'phaseEndsAt', v_session.abandoned_at
    );
  END IF;

  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, v_now);
  v_elapsed := greatest(0, floor(extract(epoch FROM v_now - v_session.started_at))::integer);

  IF v_elapsed < 60 THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id,
      'stationId', v_session.station_id,
      'serverNow', v_now,
      'phase', 'scenario',
      'phaseStartedAt', v_session.started_at,
      'phaseEndsAt', v_session.started_at + interval '60 seconds',
      'scenarioText', (
        SELECT station.scenario_text
        FROM public.mmi_stations AS station
        WHERE station.station_id = v_session.station_id
      )
    );
  END IF;

  IF v_elapsed >= 660 THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id,
      'stationId', v_session.station_id,
      'serverNow', v_now,
      'phase', 'completed',
      'phaseStartedAt', v_session.started_at + interval '660 seconds',
      'phaseEndsAt', null
    );
  END IF;

  v_prompt_order := (((v_elapsed - 60) / 120) + 1)::smallint;
  SELECT * INTO v_window
  FROM public.candidate_mmi_station_window(v_session.started_at, v_prompt_order);
  SELECT * INTO v_snapshot
  FROM public.candidate_mmi_station_prompt_snapshots
  WHERE session_id = p_session_id AND prompt_order = v_prompt_order;
  SELECT * INTO v_draft
  FROM public.candidate_mmi_station_response_drafts
  WHERE session_id = p_session_id AND prompt_order = v_prompt_order;
  IF NOT FOUND THEN
    v_draft.transcript := '';
    v_draft.client_revision := 0;
  END IF;

  RETURN jsonb_build_object(
    'sessionId', p_session_id,
    'stationId', v_session.station_id,
    'serverNow', v_now,
    'phase', 'response',
    'phaseStartedAt', v_window.starts_at,
    'phaseEndsAt', v_window.ends_at,
    'promptOrder', v_prompt_order,
    'promptText', v_snapshot.prompt_text,
    'draftTranscript', v_draft.transcript,
    'draftRevision', v_draft.client_revision,
    'responseStatus', 'open'
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
  v_checkpoint_window_started_at timestamptz;
  v_checkpoint_count smallint;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
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

  v_current_prompt := (((floor(extract(epoch FROM v_now - v_session.started_at))::integer - 60) / 120) + 1)::smallint;
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
  IF p_prompt_order NOT BETWEEN 1 AND 5 OR p_finalization_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_finalization';
  END IF;

  SELECT * INTO v_session
  FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = v_user_id AND abandoned_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller';
  END IF;

  SELECT * INTO v_response
  FROM public.candidate_mmi_station_responses
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'sessionId', p_session_id,
      'promptOrder', p_prompt_order,
      'responseState', v_response.response_state,
      'finalizedAt', v_response.finalized_at,
      'scoringStatus', v_response.scoring_status
    );
  END IF;

  SELECT * INTO v_window
  FROM public.candidate_mmi_station_window(v_session.started_at, p_prompt_order);
  IF v_now < v_window.ends_at THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_response_deadline_not_reached';
  END IF;

  v_response := public.finalize_candidate_mmi_station_response_internal(
    p_session_id,
    p_prompt_order,
    p_finalization_key,
    v_window.ends_at
  );

  RETURN jsonb_build_object(
    'sessionId', p_session_id,
    'promptOrder', p_prompt_order,
    'responseState', v_response.response_state,
    'finalizedAt', v_response.finalized_at,
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

  SELECT * INTO v_session
  FROM public.candidate_mmi_station_sessions
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
    SELECT jsonb_agg(
      jsonb_build_object(
        'promptOrder', response.prompt_order,
        'status', response.scoring_status,
        'assessment', CASE
          WHEN response.scoring_status = 'scored' THEN response.public_assessment
          ELSE NULL
        END
      )
      ORDER BY response.prompt_order
    )
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
  v_session public.candidate_mmi_station_sessions;
  v_response public.candidate_mmi_station_responses;
  v_snapshot public.candidate_mmi_station_prompt_snapshots;
  v_claim public.candidate_mmi_response_scoring_claims;
  v_has_claim boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_prompt_order NOT BETWEEN 1 AND 5
    OR p_lease_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_scoring_claim';
  END IF;

  SELECT * INTO v_session
  FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id
    AND user_id = p_user_id
    AND abandoned_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_response_not_found';
  END IF;
  IF v_now < v_session.started_at + interval '660 seconds' THEN
    RETURN jsonb_build_object('status', 'not_ready');
  END IF;

  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, v_now);
  IF (
    SELECT count(*)
    FROM public.candidate_mmi_station_responses
    WHERE session_id = p_session_id
  ) <> 5 THEN
    RETURN jsonb_build_object('status', 'not_ready');
  END IF;

  SELECT response.* INTO v_response
  FROM public.candidate_mmi_station_responses AS response
  WHERE response.session_id = p_session_id
    AND response.prompt_order = p_prompt_order
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_response_not_found';
  END IF;
  IF v_response.response_state = 'no_response' THEN
    RETURN jsonb_build_object('status', 'no_response');
  END IF;
  IF v_response.scoring_status = 'scored' THEN
    RETURN jsonb_build_object('status', 'scored', 'assessment', v_response.public_assessment);
  END IF;

  SELECT * INTO v_claim
  FROM public.candidate_mmi_response_scoring_claims
  WHERE response_id = v_response.id
  FOR UPDATE;
  v_has_claim := FOUND;

  IF v_response.finalized_transcript IS NULL THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;
  IF v_has_claim AND v_claim.lease_expires_at > v_now
    AND v_response.scoring_status = 'in_progress' THEN
    RETURN jsonb_build_object('status', 'in_progress');
  END IF;

  SELECT * INTO v_snapshot
  FROM public.candidate_mmi_station_prompt_snapshots
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_prompt_snapshot_missing';
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
  WHERE id = v_response.id AND scoring_status IN ('pending', 'failed', 'feedback_unavailable');

  RETURN jsonb_build_object(
    'status', 'claimed',
    'responseId', v_response.id,
    'sessionId', p_session_id,
    'promptOrder', p_prompt_order,
    'transcript', v_response.finalized_transcript,
    'promptText', v_snapshot.prompt_text
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
  SET finalized_transcript = NULL,
    transcript_purged_at = p_now
  WHERE response.response_state = 'response'
    AND response.finalized_transcript IS NOT NULL
    AND response.transcript_purged_at IS NULL
    AND response.finalized_at < p_now - interval '7 days';
  GET DIAGNOSTICS v_finalized_purged = ROW_COUNT;

  DELETE FROM public.candidate_mmi_station_response_drafts AS draft
  WHERE draft.accepted_at < p_now - interval '7 days';
  GET DIAGNOSTICS v_drafts_purged = ROW_COUNT;

  RETURN jsonb_build_object('purged', v_finalized_purged + v_drafts_purged);
END;
$function$;

ALTER FUNCTION public.finalize_candidate_mmi_station_response_internal(uuid, smallint, uuid, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.start_candidate_mmi_station_session() OWNER TO postgres;
ALTER FUNCTION public.get_candidate_mmi_station_session(uuid) OWNER TO postgres;
ALTER FUNCTION public.checkpoint_candidate_mmi_station_response(uuid, smallint, text, bigint) OWNER TO postgres;
ALTER FUNCTION public.finalize_candidate_mmi_station_response(uuid, smallint, uuid) OWNER TO postgres;
ALTER FUNCTION public.get_candidate_mmi_station_feedback(uuid) OWNER TO postgres;
ALTER FUNCTION public.abandon_candidate_mmi_station_session(uuid) OWNER TO postgres;
ALTER FUNCTION public.claim_candidate_mmi_response_scoring(uuid, uuid, smallint, uuid) OWNER TO postgres;
ALTER FUNCTION public.purge_expired_candidate_mmi_free_text(timestamptz) OWNER TO postgres;

ALTER TABLE public.candidate_mmi_station_prompt_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_station_response_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_station_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_response_scoring_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.candidate_mmi_station_sessions,
  public.candidate_mmi_station_prompt_snapshots,
  public.candidate_mmi_station_response_drafts,
  public.candidate_mmi_station_responses,
  public.candidate_mmi_response_scoring_claims
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.finalize_candidate_mmi_station_response_internal(uuid, smallint, uuid, timestamptz),
  public.start_candidate_mmi_station_session(),
  public.get_candidate_mmi_station_session(uuid),
  public.checkpoint_candidate_mmi_station_response(uuid, smallint, text, bigint),
  public.finalize_candidate_mmi_station_response(uuid, smallint, uuid),
  public.get_candidate_mmi_station_feedback(uuid),
  public.abandon_candidate_mmi_station_session(uuid),
  public.claim_candidate_mmi_response_scoring(uuid, uuid, smallint, uuid),
  public.purge_expired_candidate_mmi_free_text(timestamptz)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.start_candidate_mmi_station_session(),
  public.get_candidate_mmi_station_session(uuid),
  public.checkpoint_candidate_mmi_station_response(uuid, smallint, text, bigint),
  public.finalize_candidate_mmi_station_response(uuid, smallint, uuid),
  public.get_candidate_mmi_station_feedback(uuid),
  public.abandon_candidate_mmi_station_session(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.claim_candidate_mmi_response_scoring(uuid, uuid, smallint, uuid),
  public.purge_expired_candidate_mmi_free_text(timestamptz)
TO service_role;

DO $postconditions$
DECLARE
  v_signature text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_table regclass;
  v_station_count integer;
  v_prompt_count integer;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.finalize_candidate_mmi_station_response_internal(uuid,smallint,uuid,timestamptz)',
    'public.start_candidate_mmi_station_session()',
    'public.get_candidate_mmi_station_session(uuid)',
    'public.checkpoint_candidate_mmi_station_response(uuid,smallint,text,bigint)',
    'public.finalize_candidate_mmi_station_response(uuid,smallint,uuid)',
    'public.get_candidate_mmi_station_feedback(uuid)',
    'public.abandon_candidate_mmi_station_session(uuid)',
    'public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid)',
    'public.purge_expired_candidate_mmi_free_text(timestamptz)'
  ] LOOP
    v_owner := NULL;
    v_security_definer := NULL;
    v_config := NULL;
    SELECT pg_get_userbyid(proowner), prosecdef, proconfig
    INTO v_owner, v_security_definer, v_config
    FROM pg_proc
    WHERE oid = to_regprocedure(v_signature);
    IF NOT FOUND
      OR v_owner <> 'postgres'
      OR v_security_definer IS DISTINCT FROM TRUE
      OR NOT (COALESCE(v_config, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_temp']) THEN
      RAISE EXCEPTION 'single MMI station function security postcondition failed: %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.start_candidate_mmi_station_session()',
    'public.get_candidate_mmi_station_session(uuid)',
    'public.checkpoint_candidate_mmi_station_response(uuid,smallint,text,bigint)',
    'public.finalize_candidate_mmi_station_response(uuid,smallint,uuid)',
    'public.get_candidate_mmi_station_feedback(uuid)',
    'public.abandon_candidate_mmi_station_session(uuid)'
  ] LOOP
    IF NOT has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR has_function_privilege('anon', v_signature, 'EXECUTE')
      OR has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'single MMI station browser RPC ACL postcondition failed: %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid)',
    'public.purge_expired_candidate_mmi_free_text(timestamptz)'
  ] LOOP
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE')
      OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR has_function_privilege('anon', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'single MMI station service RPC ACL postcondition failed: %', v_signature;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'public.candidate_mmi_station_sessions'::regclass,
    'public.candidate_mmi_station_prompt_snapshots'::regclass,
    'public.candidate_mmi_station_response_drafts'::regclass,
    'public.candidate_mmi_station_responses'::regclass,
    'public.candidate_mmi_response_scoring_claims'::regclass
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table)
      OR has_table_privilege('authenticated', v_table, 'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'single MMI station private table postcondition failed: %', v_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.app_config
    WHERE key = 'normalized_mmi_station_enabled'
  ) THEN
    RAISE EXCEPTION 'obsolete normalized MMI station config remains';
  END IF;

  SELECT count(*) INTO v_station_count
  FROM public.mmi_stations
  WHERE source_namespace = 'med_interview_question_bank'
    AND status = 'published';
  SELECT count(*) INTO v_prompt_count
  FROM public.mmi_sub_questions
  WHERE source_namespace = 'med_interview_question_bank';
  IF v_station_count > 0 AND (
    v_station_count <> 155
    OR v_prompt_count <> 775
    OR EXISTS (
      SELECT 1
      FROM public.mmi_stations AS station
      LEFT JOIN public.mmi_sub_questions AS question
        ON question.station_id = station.station_id
      WHERE station.source_namespace = 'med_interview_question_bank'
        AND station.status = 'published'
      GROUP BY station.station_id
      HAVING count(question.sub_q_id) <> 5
        OR count(DISTINCT question.order_num) <> 5
        OR min(question.order_num) <> 1
        OR max(question.order_num) <> 5
    )
  ) THEN
    RAISE EXCEPTION 'normalized MMI content postcondition failed';
  END IF;
END;
$postconditions$;

COMMIT;
