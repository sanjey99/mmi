-- Service-owned MMI attempt creation, first-prompt reveal, and abandonment.
-- These functions are deliberately unavailable to browser JWTs.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_mmi_attempt(
  p_user_id UUID,
  p_station_kind public.mmi_station_kind,
  p_station_id TEXT,
  p_privacy_notice_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt_id UUID;
  v_station RECORD;
  v_notice_version TEXT;
  v_prompt_count INTEGER;
  v_preparation_ends_at TIMESTAMPTZ;
  v_content_snapshot JSONB;
  v_content_version TEXT;
  v_prompt RECORD;
  v_rubric RECORD;
  v_min_prompt_order INTEGER; v_max_prompt_order INTEGER; v_snapshot_count INTEGER;
  v_contract_snapshot JSONB := $contract${"version":"2026-08-17.1","parserVersion":"1","assessorInstructions":"You are a UK medical-school MMI assessor grading only the reviewed transcript supplied below. Do not infer vocal confidence, pace, tone, hesitation, pronunciation, or any delivery quality from transcript text. Assess valid alternative reasoning fairly; a curated reference answer is context, never the only acceptable answer. For each applicable dimension, return a score from 1 through 5 and one evidenceReference using start-inclusive, end-exclusive Unicode code-point offsets into the reviewed transcript. For each non-applicable dimension, return null for both score and evidenceReference. Select only rubricStrengthCodes, rubricImprovementCodes, and safetyCriticalOmissionCodes supplied in the clinician-reviewed rubric. Select improvementFramework only from sbar, starr, spar, or four-pillars. Return no prose, overall percentage, hidden context, rubric criteria, internal instructions, or fields outside the strict JSON schema.","responseSchema":{"type":"object","additionalProperties":false,"required":["dimensions","rubricStrengthCodes","rubricImprovementCodes","safetyCriticalOmissionCodes","improvementFramework"],"properties":{"dimensions":{"type":"object","additionalProperties":false,"required":["structure","ethics","communication","reflection","nhs_awareness"],"properties":{"structure":{"oneOf":[{"type":"object","additionalProperties":false,"required":["score","evidenceReference"],"properties":{"score":{"type":"integer","enum":[1,2,3,4,5]},"evidenceReference":{"type":"object","additionalProperties":false,"required":["start","end"],"properties":{"start":{"type":"integer","minimum":0,"maximum":12000},"end":{"type":"integer","minimum":1,"maximum":12000}}}}},{"type":"object","additionalProperties":false,"required":["score","evidenceReference"],"properties":{"score":{"type":"null"},"evidenceReference":{"type":"null"}}}]},"ethics":{"oneOf":[{"type":"object","additionalProperties":false,"required":["score","evidenceReference"],"properties":{"score":{"type":"integer","enum":[1,2,3,4,5]},"evidenceReference":{"type":"object","additionalProperties":false,"required":["start","end"],"properties":{"start":{"type":"integer","minimum":0,"maximum":12000},"end":{"type":"integer","minimum":1,"maximum":12000}}}}},{"type":"object","additionalProperties":false,"required":["score","evidenceReference"],"properties":{"score":{"type":"null"},"evidenceReference":{"type":"null"}}}]},"communication":{"oneOf":[{"type":"object","additionalProperties":false,"required":["score","evidenceReference"],"properties":{"score":{"type":"integer","enum":[1,2,3,4,5]},"evidenceReference":{"type":"object","additionalProperties":false,"required":["start","end"],"properties":{"start":{"type":"integer","minimum":0,"maximum":12000},"end":{"type":"integer","minimum":1,"maximum":12000}}}}},{"type":"object","additionalProperties":false,"required":["score","evidenceReference"],"properties":{"score":{"type":"null"},"evidenceReference":{"type":"null"}}}]},"reflection":{"oneOf":[{"type":"object","additionalProperties":false,"required":["score","evidenceReference"],"properties":{"score":{"type":"integer","enum":[1,2,3,4,5]},"evidenceReference":{"type":"object","additionalProperties":false,"required":["start","end"],"properties":{"start":{"type":"integer","minimum":0,"maximum":12000},"end":{"type":"integer","minimum":1,"maximum":12000}}}}},{"type":"object","additionalProperties":false,"required":["score","evidenceReference"],"properties":{"score":{"type":"null"},"evidenceReference":{"type":"null"}}}]},"nhs_awareness":{"oneOf":[{"type":"object","additionalProperties":false,"required":["score","evidenceReference"],"properties":{"score":{"type":"integer","enum":[1,2,3,4,5]},"evidenceReference":{"type":"object","additionalProperties":false,"required":["start","end"],"properties":{"start":{"type":"integer","minimum":0,"maximum":12000},"end":{"type":"integer","minimum":1,"maximum":12000}}}}},{"type":"object","additionalProperties":false,"required":["score","evidenceReference"],"properties":{"score":{"type":"null"},"evidenceReference":{"type":"null"}}}]}}},"rubricStrengthCodes":{"type":"array","minItems":1,"maxItems":5,"items":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"}},"rubricImprovementCodes":{"type":"array","minItems":1,"maxItems":5,"items":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"}},"safetyCriticalOmissionCodes":{"type":"array","minItems":0,"maxItems":20,"items":{"type":"string","minLength":1,"maxLength":64,"pattern":"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$"}},"improvementFramework":{"type":"string","enum":["sbar","starr","spar","four-pillars"]}}},"studentFeedbackCatalog":{"templates":{"clear-priorities":{"kind":"strength","text":"You set out the main priorities in a clear and logical order."},"balanced-ethical-reasoning":{"kind":"strength","text":"You considered more than one ethical responsibility before reaching a decision."},"patient-centred-language":{"kind":"strength","text":"You kept the explanation focused on the patient and used accessible language."},"reflective-learning":{"kind":"strength","text":"You identified a concrete lesson that could improve future practice."},"nhs-context":{"kind":"strength","text":"You connected your reasoning to relevant NHS values and responsibilities."},"explicit-safety-netting":{"kind":"improvement","text":"Make the safety-netting steps explicit, including when and how you would escalate."},"weigh-ethical-pillars":{"kind":"improvement","text":"Explain how the relevant ethical principles support or conflict with each possible action."},"check-understanding":{"kind":"improvement","text":"Add a clear check that the patient has understood the explanation and next steps."},"deepen-reflection":{"kind":"improvement","text":"State what you would change next time and how you would know that the change helped."},"connect-nhs-values":{"kind":"improvement","text":"Link your proposed action to the most relevant NHS value or professional responsibility."},"escalate-immediate-risk":{"kind":"safety","text":"Explain when you would escalate an immediate risk to a senior clinician."},"protect-confidentiality":{"kind":"safety","text":"Explain how you would protect confidentiality while responding to the concern."},"seek-senior-support":{"kind":"safety","text":"Include the point at which you would seek appropriate senior support."}},"frameworkTips":{"sbar":"Use SBAR to organise a concise escalation: situation, background, assessment, then recommendation.","starr":"Use STARR to structure the example: situation, task, action, result, then reflection.","spar":"Use SPAR to structure the response: situation, problem, action, then reflection.","four-pillars":"Use the four pillars to compare autonomy, beneficence, non-maleficence, and justice."}}}$contract$::JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;
  IF p_user_id IS NULL OR p_station_id IS NULL OR BTRIM(p_station_id) = ''
    OR p_privacy_notice_version IS NULL OR BTRIM(p_privacy_notice_version) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_attempt_request';
  END IF;

  SELECT n.version INTO v_notice_version
  FROM public.mmi_privacy_notices AS n
  WHERE n.version = p_privacy_notice_version
    AND n.is_active
    AND n.published_at IS NOT NULL FOR SHARE;
  IF v_notice_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'privacy_notice_not_current';
  END IF;

  IF p_station_kind = 'standard' THEN
    SELECT s.station_id, s.topic, s.category, s.difficulty, s.uni_tags,
      s.prep_time_sec, s.scenario_text, s.updated_at
    INTO v_station
    FROM public.mmi_stations AS s
    WHERE s.station_id = p_station_id AND s.status::TEXT = 'published' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'station_not_found';
    END IF;

    PERFORM 1 FROM public.mmi_sub_questions AS q WHERE q.station_id = p_station_id ORDER BY q.order_num FOR SHARE;
    PERFORM 1 FROM public.mmi_scoring_rubrics AS r WHERE r.standard_sub_q_id IN (SELECT q.sub_q_id FROM public.mmi_sub_questions AS q WHERE q.station_id = p_station_id) ORDER BY r.standard_sub_q_id FOR SHARE;
    SELECT COUNT(*), MIN(q.order_num), MAX(q.order_num) INTO v_prompt_count, v_min_prompt_order, v_max_prompt_order
    FROM public.mmi_sub_questions AS q
    JOIN public.mmi_scoring_rubrics AS r
      ON r.standard_sub_q_id = q.sub_q_id AND r.status = 'active'
    WHERE q.station_id = p_station_id;
    IF v_prompt_count < 1 OR v_min_prompt_order <> 1 OR v_max_prompt_order <> v_prompt_count OR v_prompt_count <> (
      SELECT COUNT(*) FROM public.mmi_sub_questions WHERE station_id = p_station_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'active_rubric_required';
    END IF;

    v_content_version := p_station_id || ':' || v_station.updated_at::TEXT;
    v_content_snapshot := jsonb_build_object(
      'content_version', v_content_version,
      'station_kind', 'standard',
      'station_id', v_station.station_id,
      'title', v_station.topic,
      'category', v_station.category,
      'topic', v_station.topic,
      'difficulty', v_station.difficulty,
      'university_tags', COALESCE(to_jsonb(v_station.uni_tags), '[]'::JSONB),
      'prep_time_sec', v_station.prep_time_sec,
      'prompt_count', v_prompt_count,
      'student_brief', v_station.scenario_text,
      'opening_line', NULL
    );
  ELSE
    SELECT r.station_id, r.title, r.topic, r.category, r.difficulty, r.uni_tags,
      r.prep_time_sec, r.time_limit_sec, r.opening_line, r.actor_persona,
      r.background_info, r.updated_at
    INTO v_station
    FROM public.roleplay_stations AS r
    WHERE r.station_id = p_station_id AND r.status::TEXT = 'published' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'station_not_found';
    END IF;
    SELECT r.* INTO v_rubric
    FROM public.mmi_scoring_rubrics AS r
    WHERE r.roleplay_station_id = p_station_id AND r.status = 'active' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'active_rubric_required';
    END IF;

    v_prompt_count := 1;
    v_content_version := p_station_id || ':' || v_station.updated_at::TEXT;
    v_content_snapshot := jsonb_build_object(
      'content_version', v_content_version,
      'station_kind', 'roleplay',
      'station_id', v_station.station_id,
      'title', v_station.title,
      'category', v_station.category,
      'topic', v_station.topic,
      'difficulty', v_station.difficulty,
      'university_tags', COALESCE(to_jsonb(v_station.uni_tags), '[]'::JSONB),
      'prep_time_sec', v_station.prep_time_sec,
      'prompt_count', 1,
      'student_brief', v_station.title,
      'opening_line', v_station.opening_line
    );
  END IF;

  v_preparation_ends_at := clock_timestamp()
    + make_interval(secs => v_station.prep_time_sec::INTEGER);
  INSERT INTO public.mmi_attempts (
    user_id, station_kind, standard_station_id, roleplay_station_id,
    preparation_ends_at, expected_prompt_count, content_snapshot,
    privacy_notice_version, privacy_notice_acknowledged_at
  ) VALUES (
    p_user_id, p_station_kind,
    CASE WHEN p_station_kind = 'standard' THEN p_station_id END,
    CASE WHEN p_station_kind = 'roleplay' THEN p_station_id END,
    v_preparation_ends_at, v_prompt_count, v_content_snapshot,
    v_notice_version, clock_timestamp()
  ) RETURNING id INTO v_attempt_id;

  IF p_station_kind = 'standard' THEN
    FOR v_prompt IN
      SELECT q.sub_q_id, q.order_num, q.question_text, q.time_limit_sec,
        q.model_answer_cached, r.id AS rubric_id, r.version AS rubric_version,
        r.criteria, r.dimension_weights, r.safety_critical_items
      FROM public.mmi_sub_questions AS q
      JOIN public.mmi_scoring_rubrics AS r
        ON r.standard_sub_q_id = q.sub_q_id AND r.status = 'active'
      WHERE q.station_id = p_station_id
      ORDER BY q.order_num
    LOOP
      INSERT INTO public.mmi_attempt_prompt_snapshots (
        attempt_id, station_kind, prompt_order, standard_sub_q_id, prompt_text,
        time_limit_sec, hidden_reference_answer, rubric_id, rubric_version,
        rubric_criteria, rubric_dimension_weights, rubric_safety_critical_items,
        content_version, scoring_contract_version, global_contract_snapshot,
        response_schema_snapshot
      ) VALUES (
        v_attempt_id, 'standard', v_prompt.order_num, v_prompt.sub_q_id,
        v_prompt.question_text, v_prompt.time_limit_sec,
        v_prompt.model_answer_cached, v_prompt.rubric_id, v_prompt.rubric_version,
        v_prompt.criteria, v_prompt.dimension_weights, v_prompt.safety_critical_items,
        v_content_version, v_contract_snapshot->>'version', v_contract_snapshot,
        v_contract_snapshot->'responseSchema'
      );
    END LOOP;
  ELSE
    INSERT INTO public.mmi_attempt_prompt_snapshots (
      attempt_id, station_kind, prompt_order, prompt_text, time_limit_sec,
      hidden_actor_context, rubric_id, rubric_version, rubric_criteria,
      rubric_dimension_weights, rubric_safety_critical_items, content_version,
      scoring_contract_version, global_contract_snapshot, response_schema_snapshot
    ) VALUES (
      v_attempt_id, 'roleplay', 1,
      CONCAT_WS(E'\n\n', v_station.title, v_station.opening_line), v_station.time_limit_sec,
      jsonb_build_object('actor_persona', v_station.actor_persona, 'background_info', v_station.background_info),
      v_rubric.id, v_rubric.version, v_rubric.criteria, v_rubric.dimension_weights,
      v_rubric.safety_critical_items, v_content_version, v_contract_snapshot->>'version',
      v_contract_snapshot, v_contract_snapshot->'responseSchema'
    );
  END IF;

  SELECT COUNT(*) INTO v_snapshot_count FROM public.mmi_attempt_prompt_snapshots WHERE attempt_id = v_attempt_id;
  IF v_snapshot_count <> v_prompt_count OR EXISTS (SELECT 1 FROM public.mmi_attempt_prompt_snapshots AS s WHERE s.attempt_id = v_attempt_id AND (s.prompt_order < 1 OR s.prompt_order > v_prompt_count)) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'snapshot_count_mismatch';
  END IF;
  RETURN jsonb_build_object(
    'id', v_attempt_id,
    'status', 'in_progress',
    'phase', 'preparing',
    'preparationEndsAt', v_preparation_ends_at,
    'currentPromptOrder', 1,
    'expectedPromptCount', v_prompt_count,
    'station', v_content_snapshot
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reveal_mmi_first_prompt(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt RECORD;
  v_prompt RECORD;
  v_remaining_seconds INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;
  SELECT a.id, a.status, a.phase, a.preparation_ends_at, a.current_prompt_order
  INTO v_attempt FROM public.mmi_attempts AS a
  WHERE a.id = p_attempt_id AND a.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'attempt_not_found';
  END IF;
  IF v_attempt.phase = 'preparing' AND clock_timestamp() < v_attempt.preparation_ends_at THEN
    v_remaining_seconds := GREATEST(0, CEIL(EXTRACT(EPOCH FROM v_attempt.preparation_ends_at - clock_timestamp()))::INTEGER);
    RETURN jsonb_build_object('code', 'preparation_in_progress', 'remainingSeconds', v_remaining_seconds);
  END IF;
  IF v_attempt.phase = 'preparing' THEN
    UPDATE public.mmi_attempts SET phase = 'prompt_active', updated_at = clock_timestamp()
    WHERE id = v_attempt.id;
    v_attempt.phase := 'prompt_active';
  END IF;
  IF v_attempt.phase <> 'prompt_active' OR v_attempt.current_prompt_order <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_attempt_phase';
  END IF;
  SELECT prompt_order, prompt_text, time_limit_sec INTO v_prompt
  FROM public.mmi_attempt_prompt_snapshots
  WHERE attempt_id = v_attempt.id AND prompt_order = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'attempt_not_found';
  END IF;
  RETURN jsonb_build_object(
    'phase', 'prompt_active',
    'prompt', jsonb_build_object(
      'order', v_prompt.prompt_order,
      'text', v_prompt.prompt_text,
      'timeLimitSec', v_prompt.time_limit_sec
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.abandon_mmi_attempt(
  p_user_id UUID,
  p_attempt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_attempt RECORD;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service_role_required';
  END IF;
  SELECT a.id, a.status
  INTO v_attempt FROM public.mmi_attempts AS a
  WHERE a.id = p_attempt_id AND a.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'attempt_not_found';
  END IF;
  IF v_attempt.status = 'completed' THEN
    RETURN jsonb_build_object('code', 'completed_attempt');
  END IF;
  IF v_attempt.status = 'in_progress' THEN
    UPDATE public.mmi_attempts
    SET status = 'abandoned', abandoned_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE id = v_attempt.id;
  END IF;
  RETURN jsonb_build_object('code', 'abandoned');
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.create_mmi_attempt(UUID, public.mmi_station_kind, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.reveal_mmi_first_prompt(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.abandon_mmi_attempt(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mmi_attempt(UUID, public.mmi_station_kind, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reveal_mmi_first_prompt(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.abandon_mmi_attempt(UUID, UUID) TO service_role;

COMMIT;
