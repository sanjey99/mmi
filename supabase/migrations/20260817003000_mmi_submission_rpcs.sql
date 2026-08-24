-- Lease-fenced, service-owned MMI scoring and explicit feedback acknowledgement.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_mmi_scoring_submission(
  p_user_id UUID, p_attempt_id UUID, p_idempotency_key UUID, p_prompt_kind TEXT,
  p_station_id TEXT, p_sub_question_id TEXT, p_request_digest TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_attempt RECORD; v_snapshot RECORD; v_claim RECORD; v_hour_attempts INTEGER;
  v_day_completed INTEGER; v_retry_after INTEGER; v_lease UUID; v_existing_claim BOOLEAN := FALSE;
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
  SELECT c.* INTO v_claim FROM public.mmi_scoring_claims AS c
  WHERE c.user_id = p_user_id AND c.idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    v_existing_claim := TRUE;
    IF v_claim.request_digest <> p_request_digest THEN RETURN jsonb_build_object('code', 'idempotency_conflict'); END IF;
    IF v_claim.status = 'completed' THEN
      RETURN jsonb_build_object('code', 'completed', 'claimId', v_claim.id, 'promptAttemptId', v_claim.prompt_attempt_id);
    END IF;
    IF v_claim.status = 'claimed' AND v_claim.lease_expires_at > clock_timestamp() THEN
      RETURN jsonb_build_object('code', 'submission_in_progress');
    END IF;
  END IF;
  IF v_attempt.status <> 'in_progress' OR v_attempt.phase <> 'prompt_active' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_scoring_attempt';
  END IF;
  SELECT COALESCE(SUM(c.provider_attempt_count) FILTER (WHERE c.updated_at >= clock_timestamp() - INTERVAL '60 minutes'), 0),
    COUNT(*) FILTER (WHERE c.status = 'completed' AND c.completed_at >= clock_timestamp() - INTERVAL '24 hours')
  INTO v_hour_attempts, v_day_completed FROM public.mmi_scoring_claims AS c WHERE c.user_id = p_user_id;
  IF v_hour_attempts >= 20 OR v_day_completed >= 60 THEN
    v_retry_after := CASE WHEN v_hour_attempts >= 20 THEN 60 ELSE 300 END;
    RETURN jsonb_build_object('code', 'rate_limited', 'retryAfter', v_retry_after);
  END IF;
  v_lease := extensions.uuid_generate_v4();
  IF v_existing_claim THEN
    UPDATE public.mmi_scoring_claims SET status = 'claimed', lease_token = v_lease,
      lease_expires_at = clock_timestamp() + INTERVAL '180 seconds', provider_attempt_count = provider_attempt_count + 1,
      safe_error_code = NULL, updated_at = clock_timestamp() WHERE id = v_claim.id;
    RETURN jsonb_build_object('code', 'claimed', 'claimId', v_claim.id, 'leaseToken', v_lease);
  END IF;
  INSERT INTO public.mmi_scoring_claims (user_id, attempt_id, idempotency_key, station_kind, standard_sub_q_id,
    request_digest, lease_token, lease_expires_at, provider_attempt_count)
  VALUES (p_user_id, p_attempt_id, p_idempotency_key, p_prompt_kind::public.mmi_station_kind,
    CASE WHEN p_prompt_kind = 'standard' THEN p_sub_question_id END, p_request_digest, v_lease,
    clock_timestamp() + INTERVAL '180 seconds', 1)
  RETURNING id INTO v_claim.id;
  RETURN jsonb_build_object('code', 'claimed', 'claimId', v_claim.id, 'leaseToken', v_lease);
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_mmi_scoring_submission(
  p_claim_id UUID, p_lease_token UUID, p_transcript TEXT, p_assessment JSONB, p_rubric_id UUID, p_rubric_version INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_claim RECORD; v_attempt RECORD; v_snapshot RECORD; v_result_id UUID; v_overall NUMERIC;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required'; END IF;
  IF p_transcript IS NULL OR BTRIM(p_transcript) = '' OR p_assessment IS NULL OR p_rubric_id IS NULL OR p_rubric_version IS NULL
    OR NOT public.is_valid_mmi_public_dimension_results(p_assessment->'dimensions')
    OR jsonb_typeof(p_assessment->'strengths') <> 'array' OR jsonb_typeof(p_assessment->'improvements') <> 'array'
    OR jsonb_typeof(p_assessment->'improvementTip') <> 'string' OR jsonb_typeof(p_assessment->'overallPct') <> 'number' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_scoring_completion';
  END IF;
  SELECT c.* INTO v_claim FROM public.mmi_scoring_claims AS c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'claimed' OR v_claim.lease_token <> p_lease_token OR v_claim.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'stale_scoring_lease'; END IF;
  SELECT a.* INTO v_attempt FROM public.mmi_attempts AS a WHERE a.id = v_claim.attempt_id FOR UPDATE;
  SELECT s.* INTO v_snapshot FROM public.mmi_attempt_prompt_snapshots AS s WHERE s.attempt_id = v_attempt.id AND s.prompt_order = v_attempt.current_prompt_order FOR SHARE;
  IF NOT FOUND OR v_attempt.status <> 'in_progress' OR v_attempt.phase <> 'prompt_active'
    OR v_snapshot.rubric_id <> p_rubric_id OR v_snapshot.rubric_version <> p_rubric_version THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_scoring_completion'; END IF;
  v_overall := (p_assessment->>'overallPct')::NUMERIC;
  IF v_overall < 0 OR v_overall > 100 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_scoring_completion'; END IF;
  INSERT INTO public.mmi_prompt_attempts (attempt_id, station_kind, standard_sub_q_id, prompt_order, reviewed_transcript,
    dimension_results, strengths, improvements, improvement_tip, overall_pct, rubric_id, rubric_version, scoring_contract_version)
  VALUES (v_attempt.id, v_snapshot.station_kind, v_snapshot.standard_sub_q_id, v_snapshot.prompt_order, p_transcript,
    p_assessment->'dimensions', p_assessment->'strengths', p_assessment->'improvements', p_assessment->>'improvementTip', v_overall,
    v_snapshot.rubric_id, v_snapshot.rubric_version, v_snapshot.scoring_contract_version) RETURNING id INTO v_result_id;
  UPDATE public.mmi_scoring_claims SET status = 'completed', prompt_attempt_id = v_result_id, completed_at = clock_timestamp(),
    lease_expires_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = v_claim.id;
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
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required'; END IF;
  IF p_safe_error_code IS NULL OR p_safe_error_code !~ '^[a-z0-9_]{1,64}$' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_safe_error_code'; END IF;
  UPDATE public.mmi_scoring_claims SET status = 'retryable_failure', safe_error_code = p_safe_error_code,
    lease_expires_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE id = p_claim_id AND status = 'claimed' AND lease_token = p_lease_token;
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
