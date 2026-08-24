-- Lease-fenced, service-owned MMI scoring and explicit feedback acknowledgement.
BEGIN;

-- These fields make an idempotency claim self-describing. In particular, a
-- completed claim can be replayed after the attempt advances without trusting
-- the attempt's *current* prompt identity.
ALTER TABLE public.mmi_scoring_claims
  ADD COLUMN IF NOT EXISTS station_id TEXT,
  ADD COLUMN IF NOT EXISTS prompt_order INTEGER,
  ADD COLUMN IF NOT EXISTS completion_reservation_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.mmi_scoring_provider_attempts (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  claim_id UUID NOT NULL REFERENCES public.mmi_scoring_claims(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS mmi_scoring_provider_attempts_user_attempted
  ON public.mmi_scoring_provider_attempts (user_id, attempted_at);
ALTER TABLE public.mmi_scoring_provider_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.mmi_scoring_provider_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.mmi_scoring_provider_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.claim_mmi_scoring_submission(
  p_user_id UUID, p_attempt_id UUID, p_idempotency_key UUID, p_prompt_kind TEXT,
  p_station_id TEXT, p_sub_question_id TEXT, p_request_digest TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_attempt RECORD; v_snapshot RECORD; v_claim RECORD; v_hour_attempts INTEGER;
  v_completion_capacity INTEGER; v_retry_after INTEGER; v_lease UUID;
  v_oldest_window_event TIMESTAMPTZ; v_existing_claim BOOLEAN := FALSE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required'; END IF;
  IF p_user_id IS NULL OR p_attempt_id IS NULL OR p_idempotency_key IS NULL
    OR p_prompt_kind NOT IN ('standard', 'roleplay') OR p_station_id IS NULL OR BTRIM(p_station_id) = ''
    OR p_request_digest IS NULL OR p_request_digest !~ '^[a-f0-9]{64}$'
    OR (p_prompt_kind = 'standard' AND (p_sub_question_id IS NULL OR BTRIM(p_sub_question_id) = ''))
    OR (p_prompt_kind = 'roleplay' AND p_sub_question_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_scoring_request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));
  -- Expired and abandoned reservations are deliberately excluded from the
  -- capacity query below. They therefore release atomically under this user
  -- lock without acquiring unrelated claim rows before the idempotency row.
  -- Lookup comes before current-phase validation so an exact completed request
  -- remains replayable after an explicit Continue action changes prompt order.
  SELECT c.* INTO v_claim FROM public.mmi_scoring_claims AS c
  WHERE c.user_id = p_user_id AND c.idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    v_existing_claim := TRUE;
    IF v_claim.request_digest <> p_request_digest
      OR v_claim.attempt_id <> p_attempt_id
      OR v_claim.station_kind::TEXT <> p_prompt_kind
      OR v_claim.station_id IS DISTINCT FROM p_station_id
      OR v_claim.standard_sub_q_id IS DISTINCT FROM (CASE WHEN p_prompt_kind = 'standard' THEN p_sub_question_id ELSE NULL END) THEN
      RETURN jsonb_build_object('code', 'idempotency_conflict');
    END IF;
    IF v_claim.status = 'completed' THEN
      SELECT a.* INTO v_attempt FROM public.mmi_attempts AS a
      WHERE a.id = v_claim.attempt_id AND a.user_id = p_user_id FOR UPDATE;
      IF NOT FOUND OR v_claim.prompt_order IS NULL OR v_claim.prompt_order < 1
        OR v_claim.prompt_order > v_attempt.expected_prompt_count THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_scoring_attempt';
      END IF;
      RETURN jsonb_build_object(
        'code', 'completed', 'claimId', v_claim.id, 'promptAttemptId', v_claim.prompt_attempt_id,
        'promptOrder', v_claim.prompt_order, 'expectedPromptCount', v_attempt.expected_prompt_count
      );
    END IF;
    IF v_claim.status = 'claimed' AND v_claim.lease_expires_at > clock_timestamp() THEN
      RETURN jsonb_build_object('code', 'submission_in_progress');
    END IF;
  END IF;
  SELECT a.* INTO v_attempt FROM public.mmi_attempts AS a
  WHERE a.id = p_attempt_id AND a.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'attempt_not_found'; END IF;
  SELECT s.* INTO v_snapshot FROM public.mmi_attempt_prompt_snapshots AS s
  WHERE s.attempt_id = v_attempt.id AND s.prompt_order = v_attempt.current_prompt_order FOR SHARE;
  IF NOT FOUND
    OR v_attempt.station_kind::TEXT <> p_prompt_kind
    OR COALESCE(v_attempt.standard_station_id, v_attempt.roleplay_station_id) <> p_station_id
    OR (p_prompt_kind = 'standard' AND v_snapshot.standard_sub_q_id <> p_sub_question_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_scoring_attempt';
  END IF;
  IF v_attempt.status <> 'in_progress' OR v_attempt.phase <> 'prompt_active' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_scoring_attempt';
  END IF;
  SELECT COUNT(*), MIN(p.attempted_at) INTO v_hour_attempts, v_oldest_window_event
  FROM public.mmi_scoring_provider_attempts AS p
  WHERE p.user_id = p_user_id AND p.attempted_at >= clock_timestamp() - INTERVAL '60 minutes';
  IF v_hour_attempts >= 20 THEN
    v_retry_after := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_oldest_window_event + INTERVAL '60 minutes' - clock_timestamp())))::INTEGER);
    RETURN jsonb_build_object('code', 'rate_limited', 'retryAfter', v_retry_after);
  END IF;
  SELECT COUNT(*), MIN(release_at) INTO v_completion_capacity, v_oldest_window_event
  FROM (
    SELECT c.completed_at + INTERVAL '24 hours' AS release_at FROM public.mmi_scoring_claims AS c
    WHERE c.user_id = p_user_id AND c.status = 'completed' AND c.completed_at >= clock_timestamp() - INTERVAL '24 hours'
    UNION ALL
    SELECT c.lease_expires_at AS release_at FROM public.mmi_scoring_claims AS c
    JOIN public.mmi_attempts AS a ON a.id = c.attempt_id
    WHERE c.user_id = p_user_id AND c.status = 'claimed' AND c.completion_reservation_at IS NOT NULL
      AND c.lease_expires_at > clock_timestamp() AND a.status = 'in_progress'
      AND (NOT v_existing_claim OR c.id <> v_claim.id)
  ) AS capacity;
  IF v_completion_capacity >= 60 THEN
    v_retry_after := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_oldest_window_event - clock_timestamp()))::INTEGER));
    RETURN jsonb_build_object('code', 'rate_limited', 'retryAfter', v_retry_after);
  END IF;
  v_lease := extensions.uuid_generate_v4();
  IF v_existing_claim THEN
    UPDATE public.mmi_scoring_claims SET status = 'claimed', lease_token = v_lease,
      lease_expires_at = clock_timestamp() + INTERVAL '180 seconds', provider_attempt_count = provider_attempt_count + 1,
      completion_reservation_at = clock_timestamp(),
      safe_error_code = NULL, updated_at = clock_timestamp() WHERE id = v_claim.id;
    INSERT INTO public.mmi_scoring_provider_attempts (claim_id, user_id) VALUES (v_claim.id, p_user_id);
    RETURN jsonb_build_object('code', 'claimed', 'claimId', v_claim.id, 'leaseToken', v_lease);
  END IF;
  INSERT INTO public.mmi_scoring_claims (user_id, attempt_id, idempotency_key, station_kind, station_id, prompt_order, standard_sub_q_id,
    request_digest, lease_token, lease_expires_at, provider_attempt_count, completion_reservation_at)
  VALUES (p_user_id, p_attempt_id, p_idempotency_key, p_prompt_kind::public.mmi_station_kind,
    p_station_id, v_snapshot.prompt_order, CASE WHEN p_prompt_kind = 'standard' THEN p_sub_question_id END, p_request_digest, v_lease,
    clock_timestamp() + INTERVAL '180 seconds', 1, clock_timestamp())
  RETURNING id INTO v_claim.id;
  INSERT INTO public.mmi_scoring_provider_attempts (claim_id, user_id) VALUES (v_claim.id, p_user_id);
  RETURN jsonb_build_object('code', 'claimed', 'claimId', v_claim.id, 'leaseToken', v_lease);
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_mmi_scoring_submission(
  p_claim_id UUID, p_lease_token UUID, p_transcript TEXT, p_assessment JSONB, p_rubric_id UUID, p_rubric_version INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_claim RECORD; v_claim_user UUID; v_attempt RECORD; v_snapshot RECORD; v_result_id UUID; v_overall NUMERIC; v_completed_count INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required'; END IF;
  IF p_transcript IS NULL OR BTRIM(p_transcript) = '' OR p_assessment IS NULL OR p_rubric_id IS NULL OR p_rubric_version IS NULL
    OR NOT public.is_valid_mmi_public_dimension_results(p_assessment->'dimensions')
    OR jsonb_typeof(p_assessment->'strengths') <> 'array' OR jsonb_typeof(p_assessment->'improvements') <> 'array'
    OR jsonb_typeof(p_assessment->'improvementTip') <> 'string' OR jsonb_typeof(p_assessment->'overallPct') <> 'number' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_scoring_completion';
  END IF;
  SELECT c.user_id INTO v_claim_user FROM public.mmi_scoring_claims AS c WHERE c.id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_scoring_lease'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_claim_user::TEXT, 0));
  SELECT c.* INTO v_claim FROM public.mmi_scoring_claims AS c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.user_id IS DISTINCT FROM v_claim_user
    OR v_claim.status <> 'claimed' OR v_claim.lease_token <> p_lease_token OR v_claim.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_scoring_lease'; END IF;
  SELECT a.* INTO v_attempt FROM public.mmi_attempts AS a WHERE a.id = v_claim.attempt_id FOR UPDATE;
  SELECT s.* INTO v_snapshot FROM public.mmi_attempt_prompt_snapshots AS s
  WHERE s.attempt_id = v_attempt.id AND s.prompt_order = v_claim.prompt_order FOR SHARE;
  IF NOT FOUND OR v_attempt.status <> 'in_progress' OR v_attempt.phase <> 'prompt_active'
    OR v_attempt.current_prompt_order <> v_claim.prompt_order
    OR v_claim.station_id IS NULL OR v_claim.prompt_order IS NULL
    OR v_claim.station_kind IS DISTINCT FROM v_snapshot.station_kind
    OR v_claim.standard_sub_q_id IS DISTINCT FROM v_snapshot.standard_sub_q_id
    OR v_claim.station_id IS DISTINCT FROM COALESCE(v_attempt.standard_station_id, v_attempt.roleplay_station_id)
    OR v_snapshot.rubric_id <> p_rubric_id OR v_snapshot.rubric_version <> p_rubric_version THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_scoring_completion'; END IF;
  -- The claim's reservation makes provider work safe under concurrency. Check
  -- again while holding the same per-user lock so retained-data drift cannot
  -- turn a completion into a 61st result.
  SELECT COUNT(*) INTO v_completed_count FROM public.mmi_scoring_claims AS c
  WHERE c.user_id = v_claim.user_id AND c.status = 'completed'
    AND c.completed_at >= clock_timestamp() - INTERVAL '24 hours';
  IF v_claim.completion_reservation_at IS NULL OR v_completed_count >= 60 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'rate_limited';
  END IF;
  v_overall := (p_assessment->>'overallPct')::NUMERIC;
  IF v_overall < 0 OR v_overall > 100 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_scoring_completion'; END IF;
  INSERT INTO public.mmi_prompt_attempts (attempt_id, station_kind, standard_sub_q_id, prompt_order, reviewed_transcript,
    dimension_results, strengths, improvements, improvement_tip, overall_pct, rubric_id, rubric_version, scoring_contract_version)
  VALUES (v_attempt.id, v_snapshot.station_kind, v_snapshot.standard_sub_q_id, v_snapshot.prompt_order, p_transcript,
    p_assessment->'dimensions', p_assessment->'strengths', p_assessment->'improvements', p_assessment->>'improvementTip', v_overall,
    v_snapshot.rubric_id, v_snapshot.rubric_version, v_snapshot.scoring_contract_version) RETURNING id INTO v_result_id;
  UPDATE public.mmi_scoring_claims SET status = 'completed', prompt_attempt_id = v_result_id, completed_at = clock_timestamp(),
    lease_expires_at = clock_timestamp(), completion_reservation_at = NULL, updated_at = clock_timestamp() WHERE id = v_claim.id;
  IF v_attempt.current_prompt_order < v_attempt.expected_prompt_count THEN
    UPDATE public.mmi_attempts SET phase = 'awaiting_continue', updated_at = clock_timestamp() WHERE id = v_attempt.id;
    RETURN jsonb_build_object('assessment', p_assessment, 'attemptStatus', 'in_progress', 'hasNextPrompt', true);
  END IF;
  SELECT round(sum(p.overall_pct)::numeric / nullif(count(*), 0), 1) INTO v_overall FROM public.mmi_prompt_attempts AS p WHERE p.attempt_id = v_attempt.id;
  UPDATE public.mmi_attempts SET status = 'completed', phase = 'final_feedback', completed_at = clock_timestamp(),
    overall_pct = v_overall, updated_at = clock_timestamp() WHERE id = v_attempt.id;
  RETURN jsonb_build_object('assessment', p_assessment, 'attemptStatus', 'completed', 'hasNextPrompt', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_mmi_scoring_submission(p_claim_id UUID, p_lease_token UUID, p_safe_error_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_claim RECORD; v_claim_user UUID; v_attempt RECORD;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required'; END IF;
  IF p_safe_error_code IS NULL OR p_safe_error_code !~ '^[a-z0-9_]{1,64}$' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_safe_error_code'; END IF;
  SELECT c.user_id INTO v_claim_user FROM public.mmi_scoring_claims AS c WHERE c.id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_scoring_lease'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_claim_user::TEXT, 0));
  SELECT c.* INTO v_claim FROM public.mmi_scoring_claims AS c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.user_id IS DISTINCT FROM v_claim_user
    OR v_claim.status <> 'claimed' OR v_claim.lease_token <> p_lease_token THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_scoring_lease';
  END IF;
  SELECT a.* INTO v_attempt FROM public.mmi_attempts AS a WHERE a.id = v_claim.attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.user_id <> v_claim.user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_scoring_lease';
  END IF;
  UPDATE public.mmi_scoring_claims SET status = 'retryable_failure', safe_error_code = p_safe_error_code,
    lease_expires_at = clock_timestamp(), completion_reservation_at = NULL, updated_at = clock_timestamp()
  WHERE id = p_claim_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_scoring_lease'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_mmi_attempt_after_feedback(p_user_id UUID, p_attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_attempt RECORD; v_prompt RECORD;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required'; END IF;
  SELECT a.* INTO v_attempt FROM public.mmi_attempts AS a WHERE a.id = p_attempt_id AND a.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'attempt_not_found'; END IF;
  IF v_attempt.status <> 'in_progress' OR v_attempt.phase <> 'awaiting_continue' OR v_attempt.current_prompt_order >= v_attempt.expected_prompt_count
    OR NOT EXISTS (SELECT 1 FROM public.mmi_prompt_attempts AS p WHERE p.attempt_id = v_attempt.id AND p.prompt_order = v_attempt.current_prompt_order) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_continue_attempt'; END IF;
  UPDATE public.mmi_attempts SET current_prompt_order = current_prompt_order + 1, phase = 'prompt_active', updated_at = clock_timestamp() WHERE id = v_attempt.id;
  SELECT prompt_order, prompt_text, time_limit_sec INTO v_prompt FROM public.mmi_attempt_prompt_snapshots
  WHERE attempt_id = v_attempt.id AND prompt_order = v_attempt.current_prompt_order + 1;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'attempt_not_found'; END IF;
  RETURN jsonb_build_object('prompt', jsonb_build_object('order', v_prompt.prompt_order, 'text', v_prompt.prompt_text, 'timeLimitSec', v_prompt.time_limit_sec));
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.claim_mmi_scoring_submission(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.complete_mmi_scoring_submission(UUID, UUID, TEXT, JSONB, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.fail_mmi_scoring_submission(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.advance_mmi_attempt_after_feedback(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mmi_scoring_submission(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_mmi_scoring_submission(UUID, UUID, TEXT, JSONB, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_mmi_scoring_submission(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_mmi_attempt_after_feedback(UUID, UUID) TO service_role;
COMMIT;
