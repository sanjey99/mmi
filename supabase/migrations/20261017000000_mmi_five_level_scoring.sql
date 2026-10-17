-- Five-level rubric scores retain bounded, answer-verified feedback for candidates.
-- Existing v3 assessments remain readable; historical answers are never regraded.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.is_valid_candidate_mmi_v4_assessment(p_assessment jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $function$
DECLARE
  v_criterion jsonb;
  v_level numeric;
BEGIN
  IF jsonb_typeof(p_assessment) IS DISTINCT FROM 'object'
    OR NOT p_assessment ?& ARRAY['schemaVersion','questionScorePct','criteria']
    OR (SELECT count(*) FROM jsonb_object_keys(p_assessment)) <> 3
    OR jsonb_typeof(p_assessment->'schemaVersion') IS DISTINCT FROM 'number'
    OR p_assessment->>'schemaVersion' <> '4'
    OR jsonb_typeof(p_assessment->'questionScorePct') IS DISTINCT FROM 'number'
    OR (p_assessment->>'questionScorePct')::numeric NOT BETWEEN 0 AND 100
    OR jsonb_typeof(p_assessment->'criteria') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_assessment->'criteria') NOT BETWEEN 1 AND 20 THEN
    RETURN false;
  END IF;
  FOR v_criterion IN SELECT value FROM jsonb_array_elements(p_assessment->'criteria') LOOP
    IF jsonb_typeof(v_criterion) IS DISTINCT FROM 'object'
      OR NOT v_criterion ?& ARRAY['criterionId','performanceLevel','weightPct','evidenceQuote','justification']
      OR (SELECT count(*) FROM jsonb_object_keys(v_criterion)) <> 5
      OR jsonb_typeof(v_criterion->'criterionId') IS DISTINCT FROM 'string'
      OR char_length(btrim(v_criterion->>'criterionId')) NOT BETWEEN 1 AND 100
      OR jsonb_typeof(v_criterion->'performanceLevel') IS DISTINCT FROM 'number'
      OR jsonb_typeof(v_criterion->'weightPct') IS DISTINCT FROM 'number'
      OR (v_criterion->>'weightPct')::numeric NOT BETWEEN 0 AND 100
      OR jsonb_typeof(v_criterion->'justification') IS DISTINCT FROM 'string'
      OR char_length(v_criterion->>'justification') NOT BETWEEN 1 AND 600
      OR NOT (v_criterion->>'justification' ~ '[^[:space:]]')
      OR jsonb_typeof(v_criterion->'evidenceQuote') NOT IN ('string','null') THEN
      RETURN false;
    END IF;
    v_level := (v_criterion->>'performanceLevel')::numeric;
    IF v_level NOT BETWEEN 0 AND 4 OR v_level % 1 <> 0
      OR (v_level > 0 AND jsonb_typeof(v_criterion->'evidenceQuote') <> 'string')
      OR (jsonb_typeof(v_criterion->'evidenceQuote') = 'string' AND (
        char_length(v_criterion->>'evidenceQuote') NOT BETWEEN 1 AND 300
        OR NOT (v_criterion->>'evidenceQuote' ~ '[^[:space:]]')
      )) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_valid_candidate_mmi_public_assessment(p_assessment jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $function$
  SELECT jsonb_typeof(p_assessment) = 'object' AND (
    -- Generic assessments are read-only legacy records. Binary assessments
    -- remain supported for in-flight v3 requests and immutable historic rows.
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
  ) OR public.is_valid_candidate_mmi_v4_assessment(p_assessment);
$function$;

CREATE OR REPLACE FUNCTION public.complete_candidate_mmi_response_scoring(p_response_id uuid, p_session_id uuid, p_lease_token uuid, p_public_assessment jsonb, p_usage jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_response public.candidate_mmi_station_responses; v_session public.candidate_mmi_station_sessions;
  v_claim public.candidate_mmi_response_scoring_claims; v_snapshot public.candidate_mmi_station_prompt_snapshots;
  v_criteria jsonb; v_expected_ids text[]; v_actual_ids text[]; v_achieved integer; v_level_total numeric; v_score numeric;
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
  IF NOT FOUND OR jsonb_typeof(v_criteria) IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_criteria) NOT BETWEEN 1 AND 20
    OR public.is_valid_candidate_mmi_public_assessment(p_public_assessment) IS DISTINCT FROM true
    OR p_public_assessment->>'schemaVersion' NOT IN ('3','4') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_rubric_assessment';
  END IF;
  SELECT array_agg(value->>'criterionId' ORDER BY ordinality) INTO v_expected_ids FROM jsonb_array_elements(v_criteria) WITH ORDINALITY;
  SELECT array_agg(value->>'criterionId' ORDER BY ordinality) INTO v_actual_ids FROM jsonb_array_elements(p_public_assessment->'criteria') WITH ORDINALITY;
  IF v_actual_ids IS DISTINCT FROM v_expected_ids
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_public_assessment->'criteria') AS item(value)
      WHERE (item.value->>'weightPct')::numeric <> round(100::numeric/cardinality(v_expected_ids), 8)) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_rubric_assessment';
  END IF;
  IF p_public_assessment->>'schemaVersion' = '4' THEN
    -- Verify retained quotes against this exact answer before atomically purging it.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_public_assessment->'criteria') AS item(value)
      WHERE jsonb_typeof(item.value->'evidenceQuote') = 'string'
        AND (v_response.finalized_transcript IS NULL
          OR position(item.value->>'evidenceQuote' IN v_response.finalized_transcript) = 0)) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_rubric_evidence';
    END IF;
    SELECT sum((value->>'performanceLevel')::numeric) INTO v_level_total
    FROM jsonb_array_elements(p_public_assessment->'criteria');
    -- Calculate from exact levels, avoiding accumulated eight-decimal weight drift.
    v_score := round(v_level_total * 100 / (4 * cardinality(v_expected_ids)), 2);
  ELSE
    SELECT count(*) FILTER (WHERE (value->>'achieved')::boolean) INTO v_achieved
    FROM jsonb_array_elements(p_public_assessment->'criteria');
    v_score := round((v_achieved::numeric / cardinality(v_expected_ids))*100,2);
  END IF;
  IF (p_public_assessment->>'questionScorePct')::numeric <> v_score THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_rubric_assessment';
  END IF;
  IF NOT public.is_valid_candidate_mmi_usage(p_usage, true) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_usage'; END IF;
  INSERT INTO public.mmi_ai_usage_events(user_id,session_id,response_id,lease_token,provider,model,input_tokens,cached_input_tokens,output_tokens,input_rate_per_million,cached_input_rate_per_million,output_rate_per_million,currency,estimated_cost,latency_ms,outcome)
  VALUES(v_session.user_id,p_session_id,p_response_id,p_lease_token,p_usage->>'provider',p_usage->>'model',(p_usage->>'inputTokens')::bigint,(p_usage->>'cachedInputTokens')::bigint,(p_usage->>'outputTokens')::bigint,(p_usage->>'inputRatePerMillion')::numeric,(p_usage->>'cachedInputRatePerMillion')::numeric,(p_usage->>'outputRatePerMillion')::numeric,'USD',round(((p_usage->>'inputTokens')::numeric*(p_usage->>'inputRatePerMillion')::numeric+(p_usage->>'cachedInputTokens')::numeric*(p_usage->>'cachedInputRatePerMillion')::numeric+(p_usage->>'outputTokens')::numeric*(p_usage->>'outputRatePerMillion')::numeric)/1000000,8),(p_usage->>'latencyMs')::integer,'scored');
  UPDATE public.candidate_mmi_station_responses SET public_assessment=p_public_assessment,scoring_status='scored',finalized_transcript=NULL,transcript_purged_at=clock_timestamp() WHERE id=p_response_id;
  DELETE FROM public.candidate_mmi_station_response_drafts WHERE session_id=p_session_id AND prompt_order=v_response.prompt_order;
  RETURN jsonb_build_object('status','scored');
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
  RETURN (
    SELECT jsonb_agg(
      jsonb_build_object(
        'promptOrder', response.prompt_order,
        'status', response.scoring_status,
        'legacy', CASE WHEN response.scoring_status = 'scored'
          THEN COALESCE((response.public_assessment->>'schemaVersion')::integer, 0) NOT IN (3,4)
          ELSE false
        END,
        'assessment', CASE
          WHEN response.scoring_status = 'no_response'
            AND jsonb_typeof(snapshot.rubric_snapshot) = 'object'
            AND jsonb_typeof(snapshot.rubric_snapshot->'version') = 'number'
            AND snapshot.rubric_snapshot->>'version' = '1'
            AND jsonb_typeof(snapshot.rubric_snapshot->'criteria') = 'array'
            AND jsonb_array_length(snapshot.rubric_snapshot->'criteria') BETWEEN 1 AND 20
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(snapshot.rubric_snapshot->'criteria') AS criterion(value)
              WHERE jsonb_typeof(criterion.value) <> 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(criterion.value)) <> 3
                OR jsonb_typeof(criterion.value->'criterionId') <> 'string'
                OR char_length(btrim(criterion.value->>'criterionId')) NOT BETWEEN 1 AND 100
                OR jsonb_typeof(criterion.value->'bulletText') <> 'string'
                OR char_length(btrim(criterion.value->>'bulletText')) NOT BETWEEN 1 AND 2000
                OR (criterion.value->'domain' <> 'null'::jsonb AND jsonb_typeof(criterion.value->'domain') <> 'string')
                OR (jsonb_typeof(criterion.value->'domain') = 'string' AND char_length(btrim(criterion.value->>'domain')) NOT BETWEEN 1 AND 100)
            )
            THEN jsonb_build_object(
            'schemaVersion', 3,
            'questionScorePct', 0,
            'criteria', (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'criterionId', criterion.value->>'criterionId',
                  'achieved', false,
                  'weightPct', round(100::numeric / jsonb_array_length(snapshot.rubric_snapshot->'criteria'), 8),
                  'bulletText', criterion.value->>'bulletText',
                  'domain', criterion.value->'domain'
                )
                ORDER BY criterion.ordinality
              )
              FROM jsonb_array_elements(snapshot.rubric_snapshot->'criteria') WITH ORDINALITY AS criterion(value, ordinality)
            )
          )
          WHEN response.scoring_status <> 'scored' THEN NULL
          WHEN response.public_assessment->>'schemaVersion' = '4' THEN jsonb_build_object(
            'schemaVersion', 4,
            'questionScorePct', response.public_assessment->'questionScorePct',
            'criteria', (
              SELECT jsonb_agg(jsonb_build_object(
                'criterionId', decision.value->>'criterionId',
                'performanceLevel', (decision.value->>'performanceLevel')::integer,
                'weightPct', (decision.value->>'weightPct')::numeric,
                'evidenceQuote', decision.value->'evidenceQuote',
                'justification', decision.value->>'justification',
                'bulletText', criterion.value->>'bulletText',
                'domain', criterion.value->'domain'
              ) ORDER BY decision.ordinality)
              FROM jsonb_array_elements(response.public_assessment->'criteria') WITH ORDINALITY AS decision(value, ordinality)
              JOIN LATERAL jsonb_array_elements(snapshot.rubric_snapshot->'criteria') AS criterion(value)
                ON criterion.value->>'criterionId' = decision.value->>'criterionId'
            )
          )
          WHEN COALESCE((response.public_assessment->>'schemaVersion')::integer, 0) NOT IN (3,4)
            THEN jsonb_build_object(
              'overallPct', response.public_assessment->'overallPct',
              'rubricVersion', response.public_assessment->'rubricVersion'
            )
          ELSE jsonb_build_object(
            'schemaVersion', 3,
            'questionScorePct', response.public_assessment->'questionScorePct',
            'criteria', (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'criterionId', decision.value->>'criterionId',
                  'achieved', (decision.value->>'achieved')::boolean,
                  'weightPct', (decision.value->>'weightPct')::numeric,
                  'bulletText', criterion.value->>'bulletText',
                  'domain', criterion.value->'domain'
                )
                ORDER BY decision.ordinality
              )
              FROM jsonb_array_elements(response.public_assessment->'criteria') WITH ORDINALITY AS decision(value, ordinality)
              JOIN LATERAL jsonb_array_elements(snapshot.rubric_snapshot->'criteria') AS criterion(value)
                ON criterion.value->>'criterionId' = decision.value->>'criterionId'
            )
          )
        END
      )
      ORDER BY response.prompt_order
    )
    FROM public.candidate_mmi_station_responses response
    JOIN public.candidate_mmi_station_prompt_snapshots snapshot
      ON snapshot.session_id = response.session_id
      AND snapshot.prompt_order = response.prompt_order
    WHERE response.session_id = p_session_id
  );
END;
$function$;

-- The existing helper name is retained for callers; both rubric versions complete a station.
CREATE OR REPLACE FUNCTION public.candidate_mmi_station_has_complete_v3_result(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $function$
  SELECT count(*)=5 AND bool_and(COALESCE(
    (response.scoring_status='scored' AND jsonb_typeof(response.public_assessment->'schemaVersion')='number' AND response.public_assessment->>'schemaVersion' IN ('3','4'))
    OR (response.scoring_status='no_response' AND snapshot.rubric_snapshot->>'version'='1' AND jsonb_typeof(snapshot.rubric_snapshot->'criteria')='array' AND jsonb_array_length(snapshot.rubric_snapshot->'criteria')>0),
    false
  )) FROM public.candidate_mmi_station_responses AS response
  JOIN public.candidate_mmi_station_prompt_snapshots AS snapshot ON snapshot.session_id=response.session_id AND snapshot.prompt_order=response.prompt_order
  WHERE response.session_id=p_session_id;
$function$;

CREATE OR REPLACE FUNCTION public.list_candidate_mmi_history(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_user_id uuid:=auth.uid();
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication required'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_candidate_mmi_history_limit'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(item ORDER BY item->>'startedAt' DESC) FROM (
    SELECT jsonb_build_object(
      'sessionId',session.id,'stationId',session.station_id,'scope',COALESCE(session.practice_scope,'all'),'targetUniversity',session.target_university_snapshot,'startedAt',session.started_at,
      'completedAt',CASE WHEN session.abandoned_at IS NULL AND clock_timestamp()>=session.started_at+interval '660 seconds' THEN session.started_at+interval '660 seconds' ELSE NULL END,
      'status',CASE WHEN session.abandoned_at IS NOT NULL THEN 'abandoned' WHEN state.complete THEN 'completed' ELSE 'awaiting_scoring' END,
      'overallPct',CASE WHEN state.complete THEN round(sum(CASE WHEN response.scoring_status='scored' THEN (response.public_assessment->>'questionScorePct')::numeric ELSE 0 END)/5,2) ELSE NULL END,
      'domainAttainment',CASE WHEN state.complete THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('domain',grouped.domain,'achieved',grouped.achieved,'total',grouped.total,'pct',round(grouped.achieved::numeric*100/grouped.total,2)) ORDER BY grouped.domain)
        FROM (
          SELECT criterion.value->>'domain' AS domain,count(*)::integer AS total,sum(CASE WHEN domain_response.public_assessment->>'schemaVersion'='4' THEN COALESCE((decision.value->>'performanceLevel')::numeric,0)/4 ELSE CASE WHEN COALESCE((decision.value->>'achieved')::boolean,false) THEN 1 ELSE 0 END END) AS achieved
          FROM public.candidate_mmi_station_prompt_snapshots AS snapshot
          CROSS JOIN LATERAL jsonb_array_elements(snapshot.rubric_snapshot->'criteria') AS criterion(value)
          LEFT JOIN public.candidate_mmi_station_responses AS domain_response ON domain_response.session_id=snapshot.session_id AND domain_response.prompt_order=snapshot.prompt_order
          LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN domain_response.public_assessment->>'schemaVersion' IN ('3','4') THEN domain_response.public_assessment->'criteria' ELSE '[]'::jsonb END) AS decision(value) ON decision.value->>'criterionId'=criterion.value->>'criterionId'
          WHERE snapshot.session_id=session.id AND jsonb_typeof(criterion.value->'domain')='string'
          GROUP BY criterion.value->>'domain'
        ) AS grouped
      ),'[]'::jsonb) ELSE '[]'::jsonb END
    ) AS item
    FROM public.candidate_mmi_station_sessions AS session
    LEFT JOIN public.candidate_mmi_station_responses AS response ON response.session_id=session.id
    CROSS JOIN LATERAL (SELECT public.candidate_mmi_station_has_complete_v3_result(session.id) AS complete) AS state
    WHERE session.user_id=v_user_id
    GROUP BY session.id,state.complete
    ORDER BY session.started_at DESC LIMIT p_limit
  ) AS history),'[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_admin_mmi_assessments(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_limit integer;
  v_offset integer;
  v_from timestamptz;
  v_to timestamptz;
  v_user_id uuid;
  v_provider text;
  v_model text;
  v_station_id text;
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF jsonb_typeof(p_filters) <> 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_filters) AS key WHERE key <> ALL(ARRAY['from','to','userId','provider','model','stationId','limit','offset']))
    OR COALESCE(p_filters->>'limit','20') !~ '^[0-9]+$'
    OR COALESCE(p_filters->>'offset','0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_admin_assessment_filters';
  END IF;
  v_limit:=COALESCE((p_filters->>'limit')::integer,20);
  v_offset:=COALESCE((p_filters->>'offset')::integer,0);
  IF v_limit NOT BETWEEN 1 AND 100 OR v_offset NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_admin_assessment_page'; END IF;
  BEGIN
    v_from:=NULLIF(p_filters->>'from','')::timestamptz;
    v_to:=NULLIF(p_filters->>'to','')::timestamptz;
    v_user_id:=NULLIF(p_filters->>'userId','')::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_admin_assessment_filters'; END;
  v_provider:=NULLIF(btrim(p_filters->>'provider'),'');
  v_model:=NULLIF(btrim(p_filters->>'model'),'');
  v_station_id:=NULLIF(btrim(p_filters->>'stationId'),'');
  IF (v_provider IS NOT NULL AND char_length(v_provider)>100)
    OR (v_model IS NOT NULL AND char_length(v_model)>200)
    OR (v_station_id IS NOT NULL AND v_station_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$')
    OR (v_from IS NOT NULL AND v_to IS NOT NULL AND v_from>v_to) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_admin_assessment_filters';
  END IF;
  RETURN (
    WITH filtered AS (
      SELECT response.id AS response_id,response.prompt_order,response.public_assessment,response.finalized_at,response.transcript_purged_at,
        snapshot.sub_question_id,
        session.station_id,session.user_id,COALESCE(NULLIF(btrim(profile.full_name),''),'User '||left(session.user_id::text,8)) AS user_display_name,
        usage.provider,usage.model,usage.estimated_cost,usage.outcome
      FROM public.candidate_mmi_station_responses AS response
      JOIN public.candidate_mmi_station_sessions AS session ON session.id=response.session_id
      JOIN public.candidate_mmi_station_prompt_snapshots AS snapshot
        ON snapshot.session_id=response.session_id AND snapshot.prompt_order=response.prompt_order
      JOIN public.profiles AS profile ON profile.id=session.user_id
      LEFT JOIN LATERAL (
        SELECT event.provider,event.model,event.estimated_cost,event.outcome
        FROM public.mmi_ai_usage_events AS event WHERE event.response_id=response.id
        ORDER BY (event.outcome='scored') DESC,event.created_at DESC LIMIT 1
      ) AS usage ON true
      WHERE response.scoring_status='scored'
        AND jsonb_typeof(response.public_assessment->'schemaVersion')='number'
        AND response.public_assessment->>'schemaVersion' IN ('3','4')
        AND (v_from IS NULL OR response.finalized_at>=v_from)
        AND (v_to IS NULL OR response.finalized_at<=v_to)
        AND (v_user_id IS NULL OR session.user_id=v_user_id)
        AND (v_provider IS NULL OR usage.provider=v_provider)
        AND (v_model IS NULL OR usage.model=v_model)
        AND (v_station_id IS NULL OR session.station_id=v_station_id)
    )
    SELECT jsonb_build_object(
      'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'responseId',page.response_id,'userId',page.user_id,'userDisplayName',page.user_display_name,
        'stationId',page.station_id,'subQuestionId',page.sub_question_id,'promptOrder',page.prompt_order,
        'questionScorePct',(page.public_assessment->>'questionScorePct')::numeric,
        'provider',page.provider,'model',page.model,
        'estimatedCost',CASE WHEN page.estimated_cost IS NULL THEN NULL ELSE to_char(page.estimated_cost,'FM99999999.00000000') END,
        'costKnown',page.estimated_cost IS NOT NULL,'outcome',page.outcome,
        'scoredAt',COALESCE(page.transcript_purged_at,page.finalized_at)
      ) ORDER BY page.finalized_at DESC,page.response_id)
      FROM (SELECT * FROM filtered ORDER BY finalized_at DESC,response_id LIMIT v_limit OFFSET v_offset) AS page),'[]'::jsonb),
      'total',count(*)
    ) FROM filtered
  );
END;
$function$;

-- Admin review retains structured performance only; candidate answer excerpts stay private.
CREATE OR REPLACE FUNCTION public.get_admin_mmi_assessment(
  p_response_id uuid,
  p_purpose text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_admin_id uuid;
  v_response_id public.candidate_mmi_station_responses.id%TYPE;
  v_session_id public.candidate_mmi_station_responses.session_id%TYPE;
  v_prompt_order public.candidate_mmi_station_responses.prompt_order%TYPE;
  v_public_assessment public.candidate_mmi_station_responses.public_assessment%TYPE;
  v_finalized_at public.candidate_mmi_station_responses.finalized_at%TYPE;
  v_transcript_purged_at public.candidate_mmi_station_responses.transcript_purged_at%TYPE;
  v_station_id public.candidate_mmi_station_sessions.station_id%TYPE;
  v_user_id public.candidate_mmi_station_sessions.user_id%TYPE;
  v_display_name text;
  v_sub_question_id public.candidate_mmi_station_prompt_snapshots.sub_question_id%TYPE;
  v_rubric_snapshot public.candidate_mmi_station_prompt_snapshots.rubric_snapshot%TYPE;
  v_provider public.mmi_ai_usage_events.provider%TYPE;
  v_model public.mmi_ai_usage_events.model%TYPE;
  v_input_tokens public.mmi_ai_usage_events.input_tokens%TYPE;
  v_cached_input_tokens public.mmi_ai_usage_events.cached_input_tokens%TYPE;
  v_output_tokens public.mmi_ai_usage_events.output_tokens%TYPE;
  v_estimated_cost public.mmi_ai_usage_events.estimated_cost%TYPE;
  v_latency_ms public.mmi_ai_usage_events.latency_ms%TYPE;
  v_outcome public.mmi_ai_usage_events.outcome%TYPE;
  v_audit_id uuid;
  v_criteria jsonb;
BEGIN
  v_admin_id := public.require_mmi_admin();
  IF p_response_id IS NULL OR p_purpose NOT IN ('scoring_review','support','cost_review','quality_audit') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_admin_assessment_request';
  END IF;
  SELECT response.id,response.session_id,response.prompt_order,response.public_assessment,
         response.finalized_at,response.transcript_purged_at
  INTO v_response_id,v_session_id,v_prompt_order,v_public_assessment,
       v_finalized_at,v_transcript_purged_at
  FROM public.candidate_mmi_station_responses AS response
  WHERE response.id=p_response_id AND response.scoring_status='scored'
    AND jsonb_typeof(response.public_assessment->'schemaVersion')='number'
    AND response.public_assessment->>'schemaVersion' IN ('3','4');
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='admin_assessment_not_found'; END IF;
  SELECT session.station_id,session.user_id INTO v_station_id,v_user_id
  FROM public.candidate_mmi_station_sessions AS session WHERE session.id=v_session_id;
  SELECT COALESCE(NULLIF(btrim(profile.full_name),''),'User '||left(profile.id::text,8)) INTO v_display_name
  FROM public.profiles AS profile WHERE profile.id=v_user_id;
  SELECT snapshot.sub_question_id,snapshot.rubric_snapshot INTO v_sub_question_id,v_rubric_snapshot
  FROM public.candidate_mmi_station_prompt_snapshots AS snapshot
  WHERE snapshot.session_id=v_session_id AND snapshot.prompt_order=v_prompt_order;
  SELECT usage.provider,usage.model,usage.input_tokens,usage.cached_input_tokens,
         usage.output_tokens,usage.estimated_cost,usage.latency_ms,usage.outcome
  INTO v_provider,v_model,v_input_tokens,v_cached_input_tokens,
       v_output_tokens,v_estimated_cost,v_latency_ms,v_outcome
  FROM public.mmi_ai_usage_events AS usage WHERE usage.response_id=v_response_id
  ORDER BY (usage.outcome='scored') DESC,usage.created_at DESC LIMIT 1;

  INSERT INTO public.mmi_admin_access_audit(admin_user_id,subject_user_id,response_id,purpose)
  VALUES (v_admin_id,v_user_id,v_response_id,p_purpose) RETURNING id INTO v_audit_id;

  SELECT jsonb_agg(jsonb_build_object(
    'criterionId',decision.value->>'criterionId',
    'bulletText',rubric.value->>'bulletText',
    'domain',rubric.value->'domain',
    'weightPct',(decision.value->>'weightPct')::numeric
  ) || CASE WHEN v_public_assessment->>'schemaVersion'='4'
    THEN jsonb_build_object('performanceLevel',(decision.value->>'performanceLevel')::integer)
    ELSE jsonb_build_object('achieved',(decision.value->>'achieved')::boolean) END ORDER BY decision.ordinality)
  INTO v_criteria
  FROM jsonb_array_elements(v_public_assessment->'criteria') WITH ORDINALITY AS decision(value,ordinality)
  JOIN LATERAL jsonb_array_elements(v_rubric_snapshot->'criteria') AS rubric(value)
    ON rubric.value->>'criterionId'=decision.value->>'criterionId';
  IF v_criteria IS NULL OR jsonb_array_length(v_criteria)<>jsonb_array_length(v_public_assessment->'criteria') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='admin_assessment_rubric_unavailable';
  END IF;
  RETURN jsonb_build_object(
    'accessAuditId',v_audit_id,'responseId',v_response_id,'userId',v_user_id,
    'userDisplayName',v_display_name,'stationId',v_station_id,'subQuestionId',v_sub_question_id,'promptOrder',v_prompt_order,
    'questionScorePct',(v_public_assessment->>'questionScorePct')::numeric,'criteria',v_criteria,
    'provider',v_provider,'model',v_model,'inputTokens',v_input_tokens,
    'cachedInputTokens',v_cached_input_tokens,'outputTokens',v_output_tokens,
    'estimatedCost',CASE WHEN v_estimated_cost IS NULL THEN NULL ELSE to_char(v_estimated_cost,'FM99999999.00000000') END,
    'latencyMs',v_latency_ms,'outcome',v_outcome,'finalizedAt',v_finalized_at,
    'scoredAt',COALESCE(v_transcript_purged_at,v_finalized_at)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.is_valid_candidate_mmi_v4_assessment(jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
