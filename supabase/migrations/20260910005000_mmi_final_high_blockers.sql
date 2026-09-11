-- Close final paid-retry, identifier, retention-SLO, and unknown-usage gaps.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.mmi_paid_scoring_claim_attempts (
  lease_token uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  response_id uuid NOT NULL REFERENCES public.candidate_mmi_station_responses(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX mmi_paid_scoring_claim_attempts_window
  ON public.mmi_paid_scoring_claim_attempts(response_id, user_id, claimed_at);
ALTER TABLE public.mmi_paid_scoring_claim_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mmi_paid_scoring_claim_attempts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_valid_candidate_mmi_usage(p_usage jsonb, p_scored boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_typeof(p_usage) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(p_usage)) = 12
    AND p_usage ?& ARRAY['provider','model','inputTokens','cachedInputTokens','outputTokens','inputRatePerMillion','cachedInputRatePerMillion','outputRatePerMillion','currency','estimatedCost','latencyMs','outcome']
    AND jsonb_typeof(p_usage->'provider') = 'string'
    AND char_length(btrim(p_usage->>'provider')) BETWEEN 1 AND 100
    AND jsonb_typeof(p_usage->'model') = 'string'
    AND char_length(btrim(p_usage->>'model')) BETWEEN 1 AND 200
    AND p_usage->>'currency' = 'USD'
    AND jsonb_typeof(p_usage->'latencyMs') = 'number'
    AND (p_usage->>'latencyMs') ~ '^[0-9]+$'
    AND (p_usage->>'latencyMs')::numeric BETWEEN 0 AND 2147483647
    AND p_usage->>'outcome' IN ('scored','provider_failed','invalid_response','persistence_failed')
    AND (NOT p_scored OR p_usage->>'outcome' = 'scored')
    AND (p_scored OR p_usage->>'outcome' <> 'scored')
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY['inputTokens','cachedInputTokens','outputTokens']) key
      WHERE jsonb_typeof(p_usage->key) <> 'null'
        AND (
          jsonb_typeof(p_usage->key) <> 'number'
          OR (p_usage->>key) !~ '^[0-9]+$'
          OR (p_usage->>key)::numeric > 9223372036854775807
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY['inputRatePerMillion','cachedInputRatePerMillion','outputRatePerMillion']) key
      WHERE jsonb_typeof(p_usage->key) <> 'number'
        OR (p_usage->>key)::numeric < 0
        OR (p_usage->>key)::numeric > 99999999.999999
        OR scale((p_usage->>key)::numeric) > 6
    )
    AND (
      jsonb_typeof(p_usage->'estimatedCost') = 'null'
      OR (
        jsonb_typeof(p_usage->'estimatedCost') = 'string'
        AND p_usage->>'estimatedCost' ~ '^(?:0|[1-9][0-9]{0,7})\.[0-9]{8}$'
        AND (p_usage->>'estimatedCost')::numeric BETWEEN 0 AND 99999999.99999999
      )
    )
    AND (
      (
        jsonb_typeof(p_usage->'inputTokens') = 'null'
        AND jsonb_typeof(p_usage->'cachedInputTokens') = 'null'
        AND jsonb_typeof(p_usage->'outputTokens') = 'null'
        AND jsonb_typeof(p_usage->'estimatedCost') = 'null'
      )
      OR (
        jsonb_typeof(p_usage->'inputTokens') = 'number'
        AND jsonb_typeof(p_usage->'cachedInputTokens') = 'number'
        AND jsonb_typeof(p_usage->'outputTokens') = 'number'
        AND jsonb_typeof(p_usage->'estimatedCost') = 'string'
        AND (p_usage->>'estimatedCost')::numeric = round((
          (p_usage->>'inputTokens')::numeric * (p_usage->>'inputRatePerMillion')::numeric
          + (p_usage->>'cachedInputTokens')::numeric * (p_usage->>'cachedInputRatePerMillion')::numeric
          + (p_usage->>'outputTokens')::numeric * (p_usage->>'outputRatePerMillion')::numeric
        ) / 1000000, 8)
      )
      OR (
        NOT p_scored
        AND p_usage->>'outcome' = 'persistence_failed'
        AND jsonb_typeof(p_usage->'inputTokens') = 'number'
        AND jsonb_typeof(p_usage->'cachedInputTokens') = 'number'
        AND jsonb_typeof(p_usage->'outputTokens') = 'number'
        AND jsonb_typeof(p_usage->'estimatedCost') = 'null'
      )
    );
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
  v_claim_exists boolean := false;
  v_criteria jsonb;
  v_recent_claim_count integer;
  v_earliest_claim_at timestamptz;
  v_retry_at timestamptz;
  v_retry_after_seconds integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_prompt_order NOT BETWEEN 1 AND 5 OR p_lease_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_scoring_claim';
  END IF;

  SELECT * INTO v_session
  FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = p_user_id AND abandoned_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_response_not_found';
  END IF;
  IF v_now < v_session.started_at + interval '660 seconds' THEN
    RETURN jsonb_build_object('status', 'not_ready');
  END IF;

  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, v_now);
  IF (SELECT count(*) FROM public.candidate_mmi_station_responses WHERE session_id = p_session_id) <> 5 THEN
    RETURN jsonb_build_object('status', 'not_ready');
  END IF;

  SELECT * INTO v_response
  FROM public.candidate_mmi_station_responses
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_response_not_found';
  END IF;
  IF v_response.response_state = 'no_response' THEN
    RETURN jsonb_build_object('status', 'no_response');
  END IF;
  IF v_response.scoring_status = 'scored' THEN
    RETURN jsonb_build_object('status', 'scored');
  END IF;

  SELECT * INTO v_snapshot
  FROM public.candidate_mmi_station_prompt_snapshots
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  v_criteria := v_snapshot.rubric_snapshot->'criteria';
  IF NOT FOUND
    OR v_session.scenario_text_snapshot IS NULL
    OR (v_snapshot.scoring_contract_snapshot->>'version') IS DISTINCT FROM '2026-09-10.1'
    OR jsonb_typeof(v_criteria) IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_criteria) < 1 THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  SELECT * INTO v_claim
  FROM public.candidate_mmi_response_scoring_claims
  WHERE response_id = v_response.id
  FOR UPDATE;
  v_claim_exists := FOUND;

  -- The privacy cutoff outranks a live paid-scoring lease.
  IF v_response.finalized_at <= v_now - interval '23 hours 30 minutes' THEN
    IF v_response.scoring_status = 'in_progress' THEN
      UPDATE public.candidate_mmi_station_responses
      SET scoring_status = 'failed'
      WHERE id = v_response.id;
    END IF;
    IF v_claim_exists THEN
      UPDATE public.candidate_mmi_response_scoring_claims
      SET lease_expires_at = LEAST(lease_expires_at, v_now),
          last_error_code = 'retention_cutoff',
          updated_at = v_now
      WHERE response_id = v_response.id;
    END IF;
    UPDATE public.candidate_mmi_station_responses
    SET finalized_transcript = NULL,
        transcript_purged_at = v_now,
        scoring_status = 'feedback_unavailable'
    WHERE id = v_response.id
      AND scoring_status IN ('pending', 'failed');
    DELETE FROM public.candidate_mmi_station_response_drafts
    WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  IF v_claim_exists AND v_claim.lease_expires_at > v_now AND v_response.scoring_status = 'in_progress' THEN
    RETURN jsonb_build_object('status', 'in_progress');
  END IF;
  IF v_response.finalized_transcript IS NULL THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  DELETE FROM public.mmi_paid_scoring_claim_attempts
  WHERE response_id = v_response.id
    AND user_id = p_user_id
    AND claimed_at <= v_now - interval '1 hour';

  SELECT count(*)::integer, min(claimed_at)
  INTO v_recent_claim_count, v_earliest_claim_at
  FROM public.mmi_paid_scoring_claim_attempts
  WHERE response_id = v_response.id
    AND user_id = p_user_id;

  IF v_recent_claim_count >= 3 THEN
    v_retry_at := v_earliest_claim_at + interval '1 hour';
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(epoch FROM (v_retry_at - v_now)))::integer
    );
    RETURN jsonb_build_object(
      'status', 'rate_limited',
      'retryAfterSeconds', v_retry_after_seconds,
      'retryAt', v_retry_at
    );
  END IF;

  INSERT INTO public.mmi_paid_scoring_claim_attempts(
    lease_token, user_id, response_id, claimed_at
  ) VALUES (
    p_lease_token, p_user_id, v_response.id, v_now
  );

  IF v_claim_exists THEN
    UPDATE public.candidate_mmi_response_scoring_claims
    SET lease_token = p_lease_token,
        lease_expires_at = v_now + interval '5 minutes',
        attempt_count = attempt_count + 1,
        last_error_code = NULL,
        updated_at = v_now
    WHERE response_id = v_response.id;
  ELSE
    INSERT INTO public.candidate_mmi_response_scoring_claims(
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
    );
  END IF;

  UPDATE public.candidate_mmi_station_responses
  SET scoring_status = 'in_progress'
  WHERE id = v_response.id
    AND scoring_status IN ('pending', 'failed', 'feedback_unavailable');

  RETURN jsonb_build_object(
    'status', 'claimed',
    'responseId', v_response.id,
    'sessionId', p_session_id,
    'promptOrder', p_prompt_order,
    'scenarioText', v_session.scenario_text_snapshot,
    'promptText', v_snapshot.prompt_text,
    'transcript', v_response.finalized_transcript,
    'criteria', v_criteria,
    'scoringContractVersion', '2026-09-10.1'
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
  v_responses integer;
  v_drafts integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_now IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate_mmi_purge_time_required';
  END IF;

  UPDATE public.candidate_mmi_station_responses AS response
  SET scoring_status = 'failed'
  WHERE response.response_state = 'response'
    AND response.finalized_transcript IS NOT NULL
    AND response.finalized_at <= p_now - interval '23 hours 30 minutes'
    AND response.scoring_status = 'in_progress';

  UPDATE public.candidate_mmi_response_scoring_claims AS claim
  SET lease_expires_at = LEAST(claim.lease_expires_at, p_now),
      last_error_code = 'retention_cutoff',
      updated_at = p_now
  WHERE EXISTS (
    SELECT 1
    FROM public.candidate_mmi_station_responses AS response
    WHERE response.id = claim.response_id
      AND response.response_state = 'response'
      AND response.finalized_transcript IS NOT NULL
      AND response.finalized_at <= p_now - interval '23 hours 30 minutes'
  );

  UPDATE public.candidate_mmi_station_responses AS response
  SET finalized_transcript=NULL,transcript_purged_at=p_now,scoring_status='feedback_unavailable'
  WHERE response.response_state = 'response'
    AND response.finalized_transcript IS NOT NULL
    AND response.finalized_at <= p_now - interval '23 hours 30 minutes'
    AND response.scoring_status IN ('pending', 'failed');
  GET DIAGNOSTICS v_responses = ROW_COUNT;

  DELETE FROM public.candidate_mmi_station_response_drafts AS draft
  WHERE draft.accepted_at <= p_now - interval '23 hours 30 minutes';
  GET DIAGNOSTICS v_drafts = ROW_COUNT;

  RETURN jsonb_build_object('purged', v_responses + v_drafts);
END;
$function$;

CREATE TABLE public.mmi_retention_job_health (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_completed_at timestamptz,
  last_purged_count integer CHECK (last_purged_count IS NULL OR last_purged_count >= 0)
);
ALTER TABLE public.mmi_retention_job_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mmi_retention_job_health FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.mmi_retention_job_health(singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.purge_expired_candidate_mmi_free_text_internal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.purge_expired_candidate_mmi_free_text(clock_timestamp());
  INSERT INTO public.mmi_retention_job_health(singleton, last_completed_at, last_purged_count)
  VALUES (true, clock_timestamp(), (v_result->>'purged')::integer)
  ON CONFLICT (singleton) DO UPDATE
  SET last_completed_at = EXCLUDED.last_completed_at,
      last_purged_count = EXCLUDED.last_purged_count;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_candidate_mmi_free_text_internal()
  FROM PUBLIC, anon, authenticated, service_role;

DO $schedule$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'candidate MMI transcript retention requires pg_cron';
  END IF;
  FOR v_job_id IN
    SELECT jobid FROM cron.job
    WHERE jobname = 'candidate-mmi-purge-expired-free-text'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
  PERFORM cron.schedule(
    'candidate-mmi-purge-expired-free-text',
    '*/5 * * * *',
    'SELECT public.purge_expired_candidate_mmi_free_text_internal();'
  );
END;
$schedule$;

DO $postconditions$
DECLARE
  v_owner text;
  v_security_definer boolean;
  v_config text[];
BEGIN
  SELECT pg_get_userbyid(proowner), prosecdef, proconfig
  INTO v_owner, v_security_definer, v_config
  FROM pg_proc
  WHERE oid = 'public.purge_expired_candidate_mmi_free_text_internal()'::regprocedure;

  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM true
    OR v_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'candidate MMI retention operator function hardening is incomplete';
  END IF;
  IF has_function_privilege('public', 'public.purge_expired_candidate_mmi_free_text_internal()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.purge_expired_candidate_mmi_free_text_internal()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.purge_expired_candidate_mmi_free_text_internal()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.purge_expired_candidate_mmi_free_text_internal()', 'EXECUTE') THEN
    RAISE EXCEPTION 'candidate MMI retention operator function exposes unexpected execution privileges';
  END IF;
  IF has_table_privilege('public', 'public.mmi_retention_job_health', 'SELECT')
    OR has_table_privilege('anon', 'public.mmi_retention_job_health', 'SELECT')
    OR has_table_privilege('authenticated', 'public.mmi_retention_job_health', 'SELECT')
    OR has_table_privilege('service_role', 'public.mmi_retention_job_health', 'SELECT') THEN
    RAISE EXCEPTION 'candidate MMI retention heartbeat is not private';
  END IF;
  IF (
    SELECT count(*) FROM cron.job
    WHERE jobname = 'candidate-mmi-purge-expired-free-text'
  ) <> 1 THEN
    RAISE EXCEPTION 'candidate MMI retention schedule is missing or duplicated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'candidate-mmi-purge-expired-free-text'
      AND schedule = '*/5 * * * *'
      AND command = 'SELECT public.purge_expired_candidate_mmi_free_text_internal();'
      AND active
  ) THEN
    RAISE EXCEPTION 'candidate MMI retention schedule contract is incorrect';
  END IF;
END;
$postconditions$;

COMMIT;
