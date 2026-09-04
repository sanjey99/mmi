-- Let a candidate submit or skip the current response before its two-minute
-- maximum. Advancing remains server-authoritative and future prompts remain
-- inaccessible.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

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
  v_elapsed integer;
  v_current_prompt smallint;
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

  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, v_now);
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

  v_elapsed := greatest(
    0,
    floor(extract(epoch FROM v_now - v_session.started_at))::integer
  );
  IF v_elapsed < 60 OR v_elapsed >= 660 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_response_not_open';
  END IF;
  v_current_prompt := (((v_elapsed - 60) / 120) + 1)::smallint;
  IF p_prompt_order <> v_current_prompt THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_response_not_open';
  END IF;

  SELECT * INTO v_window
  FROM public.candidate_mmi_station_window(v_session.started_at, p_prompt_order);
  v_response := public.finalize_candidate_mmi_station_response_internal(
    p_session_id,
    p_prompt_order,
    p_finalization_key,
    v_now
  );

  IF v_now < v_window.ends_at THEN
    UPDATE public.candidate_mmi_station_sessions
    SET started_at = started_at - (v_window.ends_at - v_now)
    WHERE id = p_session_id;
  END IF;

  RETURN jsonb_build_object(
    'sessionId', p_session_id,
    'promptOrder', p_prompt_order,
    'responseState', v_response.response_state,
    'finalizedAt', v_response.finalized_at,
    'scoringStatus', v_response.scoring_status
  );
END;
$function$;

ALTER FUNCTION public.finalize_candidate_mmi_station_response(uuid, smallint, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_candidate_mmi_station_response(uuid, smallint, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_candidate_mmi_station_response(uuid, smallint, uuid)
  TO authenticated;

COMMIT;
