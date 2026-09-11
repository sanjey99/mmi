-- Rubric-v3 scoring retains only auditable decisions and metered USD usage.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.candidate_mmi_station_sessions
  ADD COLUMN IF NOT EXISTS scenario_text_snapshot text,
  ADD COLUMN IF NOT EXISTS practice_scope text CHECK (practice_scope IN ('target', 'all')),
  ADD COLUMN IF NOT EXISTS target_university_snapshot text;

CREATE TABLE public.mmi_ai_usage_events (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.candidate_mmi_station_sessions(id) ON DELETE CASCADE,
  response_id uuid NOT NULL REFERENCES public.candidate_mmi_station_responses(id) ON DELETE CASCADE,
  lease_token uuid NOT NULL UNIQUE,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens bigint,
  cached_input_tokens bigint,
  output_tokens bigint,
  input_rate_per_million numeric(14,6) NOT NULL,
  cached_input_rate_per_million numeric(14,6) NOT NULL,
  output_rate_per_million numeric(14,6) NOT NULL,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  estimated_cost numeric(16,8),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  outcome text NOT NULL CHECK (outcome IN ('scored', 'provider_failed', 'invalid_response', 'persistence_failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CHECK (input_rate_per_million >= 0 AND cached_input_rate_per_million >= 0 AND output_rate_per_million >= 0)
);
ALTER TABLE public.mmi_ai_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mmi_ai_usage_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mmi_ai_usage_events TO service_role;

INSERT INTO public.app_config (key, value) VALUES
  ('ai_input_rate_per_million', '0'),
  ('ai_cached_input_rate_per_million', '0'),
  ('ai_output_rate_per_million', '0')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.candidate_mmi_station_responses
  DROP CONSTRAINT IF EXISTS candidate_mmi_station_response_assessment_state;
ALTER TABLE public.candidate_mmi_station_responses
  DROP CONSTRAINT IF EXISTS candidate_mmi_station_response_public_assessment_valid;
CREATE OR REPLACE FUNCTION public.is_valid_candidate_mmi_public_assessment(p_assessment jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $function$
  SELECT jsonb_typeof(p_assessment) = 'object' AND (
    -- Generic assessments are read-only legacy records. New completion RPCs
    -- accept only schema-v3 and additionally validate snapshot IDs in SQL.
    (
      NOT (p_assessment ? 'schemaVersion')
      AND p_assessment ?& ARRAY['dimensions', 'overallPct', 'strengths', 'improvements', 'improvementTip', 'rubricVersion']
      AND (SELECT count(*) FROM jsonb_object_keys(p_assessment)) = 6
      AND public.is_valid_mmi_public_dimension_results(p_assessment->'dimensions')
      AND jsonb_typeof(p_assessment->'overallPct') = 'number'
      AND (p_assessment->>'overallPct')::numeric BETWEEN 0 AND 100
      AND public.is_valid_mmi_text_array(p_assessment->'strengths')
      AND public.is_valid_mmi_text_array(p_assessment->'improvements')
      AND jsonb_typeof(p_assessment->'improvementTip') = 'string'
      AND char_length(btrim(p_assessment->>'improvementTip')) BETWEEN 1 AND 1000
      AND jsonb_typeof(p_assessment->'rubricVersion') = 'number'
      AND (p_assessment->>'rubricVersion')::numeric > 0
      AND (p_assessment->>'rubricVersion')::numeric % 1 = 0
    )
    OR (
      jsonb_typeof(p_assessment->'schemaVersion') = 'number'
      AND (p_assessment->>'schemaVersion')::numeric = 3
      AND (p_assessment->>'schemaVersion')::numeric % 1 = 0
      AND (SELECT count(*) FROM jsonb_object_keys(p_assessment)) = 3
      AND jsonb_typeof(p_assessment->'questionScorePct') = 'number'
      AND (p_assessment->>'questionScorePct')::numeric BETWEEN 0 AND 100
      AND jsonb_typeof(p_assessment->'criteria') = 'array'
      AND jsonb_array_length(p_assessment->'criteria') BETWEEN 1 AND 20
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_assessment->'criteria') AS item(value)
        WHERE jsonb_typeof(item.value) <> 'object'
          OR (SELECT count(*) FROM jsonb_object_keys(item.value)) <> 3
          OR jsonb_typeof(item.value->'criterionId') <> 'string'
          OR char_length(btrim(item.value->>'criterionId')) NOT BETWEEN 1 AND 100
          OR jsonb_typeof(item.value->'achieved') <> 'boolean'
          OR jsonb_typeof(item.value->'weightPct') <> 'number'
          OR (item.value->>'weightPct')::numeric < 0
          OR (item.value->>'weightPct')::numeric > 100
      )
    )
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_valid_candidate_mmi_usage(p_usage jsonb, p_scored boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $function$
  SELECT jsonb_typeof(p_usage) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(p_usage)) = 12
    AND p_usage ?& ARRAY['provider','model','inputTokens','cachedInputTokens','outputTokens','inputRatePerMillion','cachedInputRatePerMillion','outputRatePerMillion','currency','estimatedCost','latencyMs','outcome']
    AND jsonb_typeof(p_usage->'provider') = 'string' AND char_length(btrim(p_usage->>'provider')) BETWEEN 1 AND 100
    AND jsonb_typeof(p_usage->'model') = 'string' AND char_length(btrim(p_usage->>'model')) BETWEEN 1 AND 200
    AND p_usage->>'currency' = 'USD'
    AND jsonb_typeof(p_usage->'latencyMs') = 'number' AND (p_usage->>'latencyMs') ~ '^[0-9]+$' AND (p_usage->>'latencyMs')::numeric BETWEEN 0 AND 2147483647
    AND p_usage->>'outcome' IN ('scored','provider_failed','invalid_response','persistence_failed')
    AND (NOT p_scored OR p_usage->>'outcome' = 'scored')
    AND (p_scored OR p_usage->>'outcome' <> 'scored')
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['inputTokens','cachedInputTokens','outputTokens']) key WHERE jsonb_typeof(p_usage->key) <> 'null' AND (jsonb_typeof(p_usage->key) <> 'number' OR (p_usage->>key) !~ '^[0-9]+$' OR (p_usage->>key)::numeric > 9223372036854775807))
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['inputRatePerMillion','cachedInputRatePerMillion','outputRatePerMillion']) key WHERE jsonb_typeof(p_usage->key) <> 'number' OR (p_usage->>key)::numeric < 0 OR (p_usage->>key)::numeric > 99999999.999999 OR scale((p_usage->>key)::numeric) > 6)
    AND (jsonb_typeof(p_usage->'estimatedCost') = 'null' OR (jsonb_typeof(p_usage->'estimatedCost') = 'string' AND p_usage->>'estimatedCost' ~ '^(?:0|[1-9][0-9]{0,7})\.[0-9]{8}$' AND (p_usage->>'estimatedCost')::numeric BETWEEN 0 AND 99999999.99999999))
    AND (
      (jsonb_typeof(p_usage->'inputTokens') = 'null' AND jsonb_typeof(p_usage->'cachedInputTokens') = 'null' AND jsonb_typeof(p_usage->'outputTokens') = 'null' AND jsonb_typeof(p_usage->'estimatedCost') = 'null')
      OR
      (jsonb_typeof(p_usage->'inputTokens') = 'number' AND jsonb_typeof(p_usage->'cachedInputTokens') = 'number' AND jsonb_typeof(p_usage->'outputTokens') = 'number' AND jsonb_typeof(p_usage->'estimatedCost') = 'string' AND (p_usage->>'estimatedCost')::numeric = round(((p_usage->>'inputTokens')::numeric * (p_usage->>'inputRatePerMillion')::numeric + (p_usage->>'cachedInputTokens')::numeric * (p_usage->>'cachedInputRatePerMillion')::numeric + (p_usage->>'outputTokens')::numeric * (p_usage->>'outputRatePerMillion')::numeric) / 1000000, 8))
      OR
      (jsonb_typeof(p_usage->'inputTokens') = 'number' AND jsonb_typeof(p_usage->'cachedInputTokens') = 'number' AND jsonb_typeof(p_usage->'outputTokens') = 'number' AND jsonb_typeof(p_usage->'estimatedCost') = 'null' AND p_usage->>'outcome' = 'persistence_failed')
    )
    AND (NOT p_scored OR (jsonb_typeof(p_usage->'estimatedCost') = 'string' AND jsonb_typeof(p_usage->'inputTokens') = 'number' AND jsonb_typeof(p_usage->'cachedInputTokens') = 'number' AND jsonb_typeof(p_usage->'outputTokens') = 'number'));
$function$;
ALTER TABLE public.candidate_mmi_station_responses
  ADD CONSTRAINT candidate_mmi_station_response_public_assessment_valid CHECK (
    public_assessment IS NULL OR public.is_valid_candidate_mmi_public_assessment(public_assessment)
  );
ALTER TABLE public.candidate_mmi_station_responses
  ADD CONSTRAINT candidate_mmi_station_response_assessment_state CHECK (
    (scoring_status = 'scored') = (public_assessment IS NOT NULL)
    AND (public_assessment IS NULL OR jsonb_typeof(public_assessment) = 'object')
  );

CREATE OR REPLACE FUNCTION public.snapshot_candidate_mmi_session_rubric()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  SELECT station.scenario_text INTO NEW.scenario_text_snapshot
  FROM public.mmi_stations station WHERE station.station_id = NEW.station_id;
  NEW.practice_scope := COALESCE(NEW.practice_scope, 'all');
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.snapshot_candidate_mmi_prompt_rubric()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_criteria jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('criterionId', criterion.criterion_id, 'bulletText', criterion.bullet_text, 'domain', criterion.domain) ORDER BY criterion.order_num)
  INTO v_criteria FROM public.mmi_marking_criteria criterion WHERE criterion.sub_q_id = NEW.sub_question_id;
  IF v_criteria IS NULL OR jsonb_array_length(v_criteria) = 0 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_rubric_snapshot_missing'; END IF;
  NEW.rubric_snapshot := jsonb_build_object('version', 1, 'criteria', v_criteria);
  NEW.scoring_contract_snapshot := jsonb_build_object('version', '2026-09-10.1');
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS candidate_mmi_session_rubric_snapshot ON public.candidate_mmi_station_sessions;
CREATE TRIGGER candidate_mmi_session_rubric_snapshot BEFORE INSERT ON public.candidate_mmi_station_sessions FOR EACH ROW EXECUTE FUNCTION public.snapshot_candidate_mmi_session_rubric();
DROP TRIGGER IF EXISTS candidate_mmi_prompt_rubric_snapshot ON public.candidate_mmi_station_prompt_snapshots;
CREATE TRIGGER candidate_mmi_prompt_rubric_snapshot BEFORE INSERT ON public.candidate_mmi_station_prompt_snapshots FOR EACH ROW EXECUTE FUNCTION public.snapshot_candidate_mmi_prompt_rubric();

-- Never retain historic free text or provider-authored narrative under the new policy.
-- The pre-v3 trigger intentionally rejects edits after finalization.  Disable only
-- that named trigger while this one-time forward scrub runs, then restore it.
ALTER TABLE public.candidate_mmi_station_responses DISABLE TRIGGER candidate_mmi_station_response_immutable;
UPDATE public.answers SET text = '' WHERE text <> '';
UPDATE public.scores
SET ai_feedback = 'Legacy narrative removed under the current retention policy.',
    improvement_tip = 'Legacy narrative removed under the current retention policy.';
UPDATE public.candidate_mmi_station_responses AS response
SET public_assessment = jsonb_set(
  response.public_assessment,
  '{dimensions}',
  (SELECT jsonb_object_agg(key, jsonb_set(value, '{evidence}', 'null'::jsonb, true))
   FROM jsonb_each(response.public_assessment->'dimensions')),
  true
)
WHERE response.public_assessment ? 'dimensions';
ALTER TABLE public.candidate_mmi_station_responses ENABLE TRIGGER candidate_mmi_station_response_immutable;
DO $post_scrub_trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger trigger
    WHERE trigger.tgrelid = 'public.candidate_mmi_station_responses'::regclass
      AND trigger.tgname = 'candidate_mmi_station_response_immutable'
      AND trigger.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'candidate response immutability trigger was not restored';
  END IF;
END;
$post_scrub_trigger$;

-- Account-owned old scoring metadata must never prevent account deletion.
ALTER TABLE public.legacy_scoring_attempts DROP CONSTRAINT IF EXISTS legacy_scoring_attempts_claim_id_fkey;
ALTER TABLE public.legacy_scoring_attempts DROP CONSTRAINT IF EXISTS legacy_scoring_attempts_user_id_fkey;
ALTER TABLE public.legacy_scoring_claims DROP CONSTRAINT IF EXISTS legacy_scoring_claims_user_id_fkey;
ALTER TABLE public.legacy_scoring_claims DROP CONSTRAINT IF EXISTS legacy_scoring_claims_session_id_fkey;
ALTER TABLE public.legacy_scoring_claims DROP CONSTRAINT IF EXISTS legacy_scoring_claims_answer_id_fkey;
ALTER TABLE public.legacy_scoring_attempts ADD CONSTRAINT legacy_scoring_attempts_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.legacy_scoring_claims(id) ON DELETE CASCADE;
ALTER TABLE public.legacy_scoring_attempts ADD CONSTRAINT legacy_scoring_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.legacy_scoring_claims ADD CONSTRAINT legacy_scoring_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.legacy_scoring_claims ADD CONSTRAINT legacy_scoring_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.mock_sessions(id) ON DELETE CASCADE;
ALTER TABLE public.legacy_scoring_claims ADD CONSTRAINT legacy_scoring_claims_answer_id_fkey FOREIGN KEY (answer_id) REFERENCES public.answers(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.claim_candidate_mmi_response_scoring(p_user_id uuid, p_session_id uuid, p_prompt_order smallint, p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_now timestamptz := clock_timestamp(); v_session public.candidate_mmi_station_sessions;
  v_response public.candidate_mmi_station_responses; v_snapshot public.candidate_mmi_station_prompt_snapshots;
  v_claim public.candidate_mmi_response_scoring_claims; v_criteria jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required'; END IF;
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_prompt_order NOT BETWEEN 1 AND 5 OR p_lease_token IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_scoring_claim'; END IF;
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions WHERE id = p_session_id AND user_id = p_user_id AND abandoned_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_response_not_found'; END IF;
  IF v_now < v_session.started_at + interval '660 seconds' THEN RETURN jsonb_build_object('status','not_ready'); END IF;
  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, v_now);
  IF (SELECT count(*) FROM public.candidate_mmi_station_responses WHERE session_id = p_session_id) <> 5 THEN RETURN jsonb_build_object('status','not_ready'); END IF;
  SELECT * INTO v_response FROM public.candidate_mmi_station_responses WHERE session_id=p_session_id AND prompt_order=p_prompt_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_response_not_found'; END IF;
  IF v_response.response_state='no_response' THEN RETURN jsonb_build_object('status','no_response'); END IF;
  IF v_response.scoring_status='scored' THEN RETURN jsonb_build_object('status','scored'); END IF;
  SELECT * INTO v_snapshot FROM public.candidate_mmi_station_prompt_snapshots WHERE session_id=p_session_id AND prompt_order=p_prompt_order;
  v_criteria := v_snapshot.rubric_snapshot->'criteria';
  IF NOT FOUND OR v_session.scenario_text_snapshot IS NULL OR (v_snapshot.scoring_contract_snapshot->>'version') IS DISTINCT FROM '2026-09-10.1' OR jsonb_typeof(v_criteria) IS DISTINCT FROM 'array' OR jsonb_array_length(v_criteria) < 1 THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  SELECT * INTO v_claim FROM public.candidate_mmi_response_scoring_claims WHERE response_id=v_response.id FOR UPDATE;
  IF FOUND AND v_claim.lease_expires_at > v_now AND v_response.scoring_status='in_progress' THEN RETURN jsonb_build_object('status','in_progress'); END IF;
  IF v_response.finalized_transcript IS NULL THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  INSERT INTO public.candidate_mmi_response_scoring_claims(response_id,lease_token,lease_expires_at,attempt_count,last_error_code,updated_at)
  VALUES(v_response.id,p_lease_token,v_now+interval '5 minutes',1,NULL,v_now)
  ON CONFLICT(response_id) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_expires_at=EXCLUDED.lease_expires_at,attempt_count=public.candidate_mmi_response_scoring_claims.attempt_count+1,last_error_code=NULL,updated_at=EXCLUDED.updated_at;
  UPDATE public.candidate_mmi_station_responses SET scoring_status='in_progress' WHERE id=v_response.id AND scoring_status IN ('pending','failed','feedback_unavailable');
  RETURN jsonb_build_object('status','claimed','responseId',v_response.id,'sessionId',p_session_id,'promptOrder',p_prompt_order,'scenarioText',v_session.scenario_text_snapshot,'promptText',v_snapshot.prompt_text,'transcript',v_response.finalized_transcript,'criteria',v_criteria,'scoringContractVersion','2026-09-10.1');
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_candidate_mmi_response_scoring(p_response_id uuid, p_session_id uuid, p_lease_token uuid, p_public_assessment jsonb, p_usage jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_response public.candidate_mmi_station_responses; v_session public.candidate_mmi_station_sessions;
  v_claim public.candidate_mmi_response_scoring_claims; v_snapshot public.candidate_mmi_station_prompt_snapshots;
  v_criteria jsonb; v_expected_ids text[]; v_actual_ids text[]; v_achieved integer; v_score numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='service role required'; END IF;
  -- Keep the same session -> response -> claim lock order as claim/fail.
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='candidate_response_not_found'; END IF;
  SELECT response.* INTO v_response FROM public.candidate_mmi_station_responses response WHERE response.id=p_response_id AND response.session_id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='candidate_response_not_found'; END IF;
  SELECT * INTO v_claim FROM public.candidate_mmi_response_scoring_claims WHERE response_id=p_response_id AND lease_token=p_lease_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND OR v_response.scoring_status <> 'in_progress' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_scoring_lease_invalid'; END IF;
  SELECT * INTO v_snapshot FROM public.candidate_mmi_station_prompt_snapshots WHERE session_id=p_session_id AND prompt_order=v_response.prompt_order;
  v_criteria:=v_snapshot.rubric_snapshot->'criteria';
  IF NOT FOUND OR jsonb_typeof(p_public_assessment)<>'object' OR jsonb_typeof(p_public_assessment->'schemaVersion')<>'number' OR (p_public_assessment->>'schemaVersion')::numeric<>3 OR (p_public_assessment->>'schemaVersion')::numeric%1<>0 OR jsonb_typeof(p_public_assessment->'criteria')<>'array' OR (SELECT count(*) FROM jsonb_object_keys(p_public_assessment))<>3 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_rubric_assessment'; END IF;
  SELECT array_agg(value->>'criterionId' ORDER BY ordinality) INTO v_expected_ids FROM jsonb_array_elements(v_criteria) WITH ORDINALITY;
  SELECT array_agg(value->>'criterionId' ORDER BY ordinality), count(*) FILTER (WHERE (value->>'achieved')::boolean) INTO v_actual_ids,v_achieved FROM jsonb_array_elements(p_public_assessment->'criteria') WITH ORDINALITY;
  IF v_actual_ids IS DISTINCT FROM v_expected_ids OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_public_assessment->'criteria') AS item(value) WHERE jsonb_typeof(item.value)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item.value))<>3 OR jsonb_typeof(item.value->'achieved')<>'boolean' OR jsonb_typeof(item.value->'weightPct')<>'number' OR (item.value->>'weightPct')::numeric <> round(100::numeric/cardinality(v_expected_ids), 8)) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_rubric_assessment'; END IF;
  v_score:=round((v_achieved::numeric / cardinality(v_expected_ids))*100,2);
  IF (p_public_assessment->>'questionScorePct')::numeric <> v_score THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_rubric_assessment'; END IF;
  IF NOT public.is_valid_candidate_mmi_usage(p_usage, true) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_usage'; END IF;
  INSERT INTO public.mmi_ai_usage_events(user_id,session_id,response_id,lease_token,provider,model,input_tokens,cached_input_tokens,output_tokens,input_rate_per_million,cached_input_rate_per_million,output_rate_per_million,currency,estimated_cost,latency_ms,outcome)
  VALUES(v_session.user_id,p_session_id,p_response_id,p_lease_token,p_usage->>'provider',p_usage->>'model',(p_usage->>'inputTokens')::bigint,(p_usage->>'cachedInputTokens')::bigint,(p_usage->>'outputTokens')::bigint,(p_usage->>'inputRatePerMillion')::numeric,(p_usage->>'cachedInputRatePerMillion')::numeric,(p_usage->>'outputRatePerMillion')::numeric,'USD',round(((p_usage->>'inputTokens')::numeric*(p_usage->>'inputRatePerMillion')::numeric+(p_usage->>'cachedInputTokens')::numeric*(p_usage->>'cachedInputRatePerMillion')::numeric+(p_usage->>'outputTokens')::numeric*(p_usage->>'outputRatePerMillion')::numeric)/1000000,8),(p_usage->>'latencyMs')::integer,'scored');
  UPDATE public.candidate_mmi_station_responses SET public_assessment=p_public_assessment,scoring_status='scored',finalized_transcript=NULL,transcript_purged_at=clock_timestamp() WHERE id=p_response_id;
  DELETE FROM public.candidate_mmi_station_response_drafts WHERE session_id=p_session_id AND prompt_order=v_response.prompt_order;
  RETURN jsonb_build_object('status','scored');
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_candidate_mmi_response_scoring(p_response_id uuid,p_session_id uuid,p_lease_token uuid,p_error_code text,p_usage jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_response public.candidate_mmi_station_responses; v_session public.candidate_mmi_station_sessions;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='service role required'; END IF;
  -- Claim, complete and fail all acquire session -> response -> claim.
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='candidate_response_not_found'; END IF;
  SELECT response.* INTO v_response FROM public.candidate_mmi_station_responses response WHERE response.id=p_response_id AND response.session_id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='candidate_response_not_found'; END IF;
  IF p_usage IS NOT NULL THEN
    IF NOT public.is_valid_candidate_mmi_usage(p_usage, false) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_usage'; END IF;
    INSERT INTO public.mmi_ai_usage_events(user_id,session_id,response_id,lease_token,provider,model,input_tokens,cached_input_tokens,output_tokens,input_rate_per_million,cached_input_rate_per_million,output_rate_per_million,currency,estimated_cost,latency_ms,outcome)
    VALUES(v_session.user_id,p_session_id,p_response_id,p_lease_token,p_usage->>'provider',p_usage->>'model',(p_usage->>'inputTokens')::bigint,(p_usage->>'cachedInputTokens')::bigint,(p_usage->>'outputTokens')::bigint,(p_usage->>'inputRatePerMillion')::numeric,(p_usage->>'cachedInputRatePerMillion')::numeric,(p_usage->>'outputRatePerMillion')::numeric,'USD',CASE WHEN jsonb_typeof(p_usage->'estimatedCost')='null' THEN NULL ELSE round(((p_usage->>'inputTokens')::numeric*(p_usage->>'inputRatePerMillion')::numeric+(p_usage->>'cachedInputTokens')::numeric*(p_usage->>'cachedInputRatePerMillion')::numeric+(p_usage->>'outputTokens')::numeric*(p_usage->>'outputRatePerMillion')::numeric)/1000000,8) END,(p_usage->>'latencyMs')::integer,p_usage->>'outcome');
  END IF;
  UPDATE public.candidate_mmi_response_scoring_claims SET lease_expires_at=clock_timestamp(),last_error_code=p_error_code,updated_at=clock_timestamp() WHERE response_id=p_response_id AND lease_token=p_lease_token;
  -- A stale provider attempt may record its own usage, but cannot fail a newer lease.
  UPDATE public.candidate_mmi_station_responses SET scoring_status='failed'
  WHERE id=p_response_id AND scoring_status='in_progress' AND EXISTS (
    SELECT 1 FROM public.candidate_mmi_response_scoring_claims claim
    WHERE claim.response_id=p_response_id AND claim.lease_token=p_lease_token
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_expired_candidate_mmi_free_text(p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_responses integer; v_drafts integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='service role required'; END IF;
  IF p_now IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='candidate_mmi_purge_time_required'; END IF;
  UPDATE public.candidate_mmi_station_responses response SET scoring_status='failed'
  WHERE response.response_state='response' AND response.finalized_transcript IS NOT NULL
    AND response.finalized_at < p_now-interval '24 hours' AND response.scoring_status='in_progress'
    AND NOT EXISTS (SELECT 1 FROM public.candidate_mmi_response_scoring_claims claim WHERE claim.response_id=response.id AND claim.lease_expires_at>p_now);
  UPDATE public.candidate_mmi_station_responses response SET finalized_transcript=NULL,transcript_purged_at=p_now,scoring_status='feedback_unavailable'
  WHERE response.response_state='response' AND response.finalized_transcript IS NOT NULL AND response.finalized_at < p_now-interval '24 hours' AND response.scoring_status IN ('pending','failed') AND NOT EXISTS (SELECT 1 FROM public.candidate_mmi_response_scoring_claims claim WHERE claim.response_id=response.id AND claim.lease_expires_at>p_now AND response.scoring_status='in_progress');
  GET DIAGNOSTICS v_responses=ROW_COUNT;
  DELETE FROM public.candidate_mmi_station_response_drafts draft WHERE draft.accepted_at < p_now-interval '24 hours' AND NOT EXISTS (SELECT 1 FROM public.candidate_mmi_station_responses response JOIN public.candidate_mmi_response_scoring_claims claim ON claim.response_id=response.id WHERE response.session_id=draft.session_id AND response.prompt_order=draft.prompt_order AND response.scoring_status='in_progress' AND claim.lease_expires_at>p_now);
  GET DIAGNOSTICS v_drafts=ROW_COUNT;
  RETURN jsonb_build_object('purged',v_responses+v_drafts);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_candidate_mmi_station_feedback(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_user_id uuid:=auth.uid(); v_session public.candidate_mmi_station_sessions;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication required'; END IF;
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions WHERE id=p_session_id AND user_id=v_user_id AND abandoned_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='candidate session is not owned by caller'; END IF;
  IF clock_timestamp()<v_session.started_at+interval '660 seconds' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_feedback_not_ready'; END IF;
  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id,clock_timestamp());
  RETURN (SELECT jsonb_agg(jsonb_build_object('promptOrder',response.prompt_order,'status',response.scoring_status,'legacy',CASE WHEN response.scoring_status='scored' THEN COALESCE((response.public_assessment->>'schemaVersion')::integer,0)<>3 ELSE false END,'assessment',CASE WHEN response.scoring_status<>'scored' THEN NULL WHEN COALESCE((response.public_assessment->>'schemaVersion')::integer,0)<>3 THEN response.public_assessment ELSE jsonb_build_object('schemaVersion',3,'questionScorePct',response.public_assessment->'questionScorePct','criteria',(SELECT jsonb_agg(jsonb_build_object('criterionId',decision.value->>'criterionId','achieved',(decision.value->>'achieved')::boolean,'weightPct',(decision.value->>'weightPct')::numeric,'bulletText',criterion.value->>'bulletText','domain',criterion.value->'domain') ORDER BY decision.ordinality) FROM jsonb_array_elements(response.public_assessment->'criteria') WITH ORDINALITY AS decision(value, ordinality) JOIN LATERAL jsonb_array_elements(snapshot.rubric_snapshot->'criteria') AS criterion(value) ON criterion.value->>'criterionId'=decision.value->>'criterionId') ) END) ORDER BY response.prompt_order) FROM public.candidate_mmi_station_responses response JOIN public.candidate_mmi_station_prompt_snapshots snapshot ON snapshot.session_id=response.session_id AND snapshot.prompt_order=response.prompt_order WHERE response.session_id=p_session_id);
END;
$function$;

-- The Task-3 four-argument functions have no usage payload and must not remain
-- callable alongside the metered, transcript-erasing variants above.
DROP FUNCTION IF EXISTS public.complete_candidate_mmi_response_scoring(uuid,uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.fail_candidate_mmi_response_scoring(uuid,uuid,uuid,text);

ALTER FUNCTION public.complete_candidate_mmi_response_scoring(uuid,uuid,uuid,jsonb,jsonb) OWNER TO postgres;
ALTER FUNCTION public.fail_candidate_mmi_response_scoring(uuid,uuid,uuid,text,jsonb) OWNER TO postgres;
ALTER FUNCTION public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid) OWNER TO postgres;
ALTER FUNCTION public.purge_expired_candidate_mmi_free_text(timestamptz) OWNER TO postgres;
ALTER FUNCTION public.get_candidate_mmi_station_feedback(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_candidate_mmi_response_scoring(uuid,uuid,uuid,jsonb,jsonb), public.fail_candidate_mmi_response_scoring(uuid,uuid,uuid,text,jsonb), public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid), public.purge_expired_candidate_mmi_free_text(timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.complete_candidate_mmi_response_scoring(uuid,uuid,uuid,jsonb,jsonb), public.fail_candidate_mmi_response_scoring(uuid,uuid,uuid,text,jsonb), public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid), public.purge_expired_candidate_mmi_free_text(timestamptz) TO service_role;
DO $obsolete_rpc_postcondition$
BEGIN
  IF to_regprocedure('public.complete_candidate_mmi_response_scoring(uuid,uuid,uuid,jsonb)') IS NOT NULL
    OR to_regprocedure('public.fail_candidate_mmi_response_scoring(uuid,uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'obsolete unmetered candidate MMI scoring RPC remains installed';
  END IF;
END;
$obsolete_rpc_postcondition$;
COMMIT;
