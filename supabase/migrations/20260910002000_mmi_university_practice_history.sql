-- Candidate practice is scoped by a canonical university pool and only exposes
-- retained, structured rubric outcomes. Free text stays in the retention-only tables.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.canonical_mmi_university_tag(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE lower(btrim(COALESCE(p_value, '')))
    WHEN '' THEN NULL
    WHEN 'oxford' THEN 'oxford'
    WHEN 'university of oxford' THEN 'oxford'
    WHEN 'cambridge' THEN 'cambridge'
    WHEN 'university of cambridge' THEN 'cambridge'
    WHEN 'imperial' THEN 'imperial'
    WHEN 'imperial college london' THEN 'imperial'
    WHEN 'ucl' THEN 'ucl'
    WHEN 'university college london' THEN 'ucl'
    WHEN 'kcl' THEN 'kcl'
    WHEN 'kings' THEN 'kcl'
    WHEN 'king''s' THEN 'kcl'
    WHEN 'king''s college london' THEN 'kcl'
    WHEN 'kings college london' THEN 'kcl'
    WHEN 'manchester' THEN 'manchester'
    WHEN 'university of manchester' THEN 'manchester'
    ELSE lower(btrim(p_value))
  END;
$function$;

CREATE OR REPLACE FUNCTION public.is_complete_published_mmi_station(p_station_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.mmi_stations AS station
    WHERE station.station_id = p_station_id
      AND station.status = 'published'
      AND station.prep_time_sec = 60
      AND EXISTS (
        SELECT 1
        FROM public.mmi_sub_questions AS question
        WHERE question.station_id = station.station_id
        GROUP BY question.station_id
        HAVING count(*) = 5
          AND count(DISTINCT question.order_num) = 5
          AND min(question.order_num) = 1
          AND max(question.order_num) = 5
          AND bool_and(question.time_limit_sec = 120)
          AND bool_and(EXISTS (
            SELECT 1 FROM public.mmi_marking_criteria AS criterion
            WHERE criterion.sub_q_id = question.sub_q_id
          ))
      )
  );
$function$;

ALTER TABLE public.candidate_mmi_station_sessions
  ADD COLUMN IF NOT EXISTS station_version_snapshot integer;

CREATE OR REPLACE FUNCTION public.prevent_candidate_mmi_station_session_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.station_id IS DISTINCT FROM OLD.station_id
    OR NEW.scenario_text_snapshot IS DISTINCT FROM OLD.scenario_text_snapshot
    OR NEW.practice_scope IS DISTINCT FROM OLD.practice_scope
    OR NEW.target_university_snapshot IS DISTINCT FROM OLD.target_university_snapshot
    OR NEW.station_version_snapshot IS DISTINCT FROM OLD.station_version_snapshot THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'immutable_candidate_mmi_station_snapshot';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS candidate_mmi_station_session_snapshot_immutable ON public.candidate_mmi_station_sessions;
CREATE TRIGGER candidate_mmi_station_session_snapshot_immutable
  BEFORE UPDATE ON public.candidate_mmi_station_sessions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_candidate_mmi_station_session_snapshot_mutation();

CREATE OR REPLACE FUNCTION public.prevent_candidate_mmi_station_prompt_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.prompt_order IS DISTINCT FROM OLD.prompt_order
    OR NEW.sub_question_id IS DISTINCT FROM OLD.sub_question_id
    OR NEW.prompt_text IS DISTINCT FROM OLD.prompt_text
    OR NEW.rubric_snapshot IS DISTINCT FROM OLD.rubric_snapshot
    OR NEW.scoring_contract_snapshot IS DISTINCT FROM OLD.scoring_contract_snapshot THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'immutable_candidate_mmi_prompt_snapshot';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS candidate_mmi_station_prompt_snapshot_immutable ON public.candidate_mmi_station_prompt_snapshots;
CREATE TRIGGER candidate_mmi_station_prompt_snapshot_immutable
  BEFORE UPDATE ON public.candidate_mmi_station_prompt_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.prevent_candidate_mmi_station_prompt_snapshot_mutation();

-- Preserve a caller-supplied immutable version snapshot; legacy fixture paths
-- still receive a live rubric only when no immutable snapshot was supplied.
CREATE OR REPLACE FUNCTION public.snapshot_candidate_mmi_session_rubric()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
BEGIN
  IF NEW.scenario_text_snapshot IS NULL THEN
    SELECT station.scenario_text INTO NEW.scenario_text_snapshot
    FROM public.mmi_stations AS station WHERE station.station_id = NEW.station_id;
  END IF;
  NEW.practice_scope := COALESCE(NEW.practice_scope, 'all');
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.snapshot_candidate_mmi_prompt_rubric()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_criteria jsonb;
BEGIN
  IF NEW.rubric_snapshot IS NULL THEN
    SELECT jsonb_agg(jsonb_build_object('criterionId', criterion.criterion_id, 'bulletText', criterion.bullet_text, 'domain', criterion.domain) ORDER BY criterion.order_num)
    INTO v_criteria FROM public.mmi_marking_criteria AS criterion WHERE criterion.sub_q_id = NEW.sub_question_id;
    IF v_criteria IS NULL OR jsonb_array_length(v_criteria) = 0 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_rubric_snapshot_missing'; END IF;
    NEW.rubric_snapshot := jsonb_build_object('version', 1, 'criteria', v_criteria);
  END IF;
  IF NEW.scoring_contract_snapshot IS NULL THEN NEW.scoring_contract_snapshot := jsonb_build_object('version', '2026-09-10.1'); END IF;
  IF jsonb_typeof(NEW.rubric_snapshot) <> 'object'
    OR NEW.rubric_snapshot->>'version' <> '1'
    OR jsonb_typeof(NEW.rubric_snapshot->'criteria') <> 'array'
    OR jsonb_array_length(NEW.rubric_snapshot->'criteria') < 1
    OR jsonb_typeof(NEW.scoring_contract_snapshot) <> 'object'
    OR NEW.scoring_contract_snapshot->>'version' <> '2026-09-10.1' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_candidate_mmi_rubric_snapshot';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_candidate_mmi_practice_options()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_target text;
  v_target_count integer := 0;
  v_all_count integer := 0;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  SELECT public.canonical_mmi_university_tag(profile.university_target)
  INTO v_target FROM public.profiles AS profile WHERE profile.id = v_user_id;
  SELECT count(*)::integer INTO v_all_count
  FROM public.mmi_stations AS station
  WHERE public.is_complete_published_mmi_station(station.station_id);
  IF v_target IS NOT NULL THEN
    SELECT count(*)::integer INTO v_target_count
    FROM public.mmi_stations AS station
    WHERE public.is_complete_published_mmi_station(station.station_id)
      AND (v_target = ANY(station.uni_tags) OR 'all' = ANY(station.uni_tags));
  END IF;
  RETURN jsonb_build_object(
    'targetUniversity', v_target,
    'targetTag', v_target,
    'targetCount', v_target_count,
    'allCount', v_all_count
  );
END;
$function$;

-- Replace the former zero-argument picker so a caller cannot evade scope by
-- choosing the legacy overload. The default preserves existing no-argument clients.
DROP FUNCTION IF EXISTS public.start_candidate_mmi_station_session();
CREATE FUNCTION public.start_candidate_mmi_station_session(p_scope text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_station_id text;
  v_now timestamptz := clock_timestamp();
  v_target text;
  v_prompt record;
  v_snapshot_count integer := 0;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_scope NOT IN ('target', 'all') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_practice_scope';
  END IF;
  SELECT public.canonical_mmi_university_tag(profile.university_target)
  INTO v_target FROM public.profiles AS profile WHERE profile.id = v_user_id;
  IF p_scope = 'target' AND v_target IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate_university_target_required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));
  SELECT session.id INTO v_session_id
  FROM public.candidate_mmi_station_sessions AS session
  WHERE session.user_id = v_user_id AND session.abandoned_at IS NULL
    AND v_now < session.started_at + interval '660 seconds'
  ORDER BY session.started_at DESC LIMIT 1 FOR UPDATE;
  IF v_session_id IS NOT NULL THEN
    RETURN public.get_candidate_mmi_station_session(v_session_id);
  END IF;
  SELECT station.station_id INTO v_station_id
  FROM public.mmi_stations AS station
  LEFT JOIN public.candidate_mmi_station_sessions AS previous
    ON previous.user_id = v_user_id AND previous.station_id = station.station_id
  WHERE public.is_complete_published_mmi_station(station.station_id)
    AND (p_scope = 'all' OR v_target = ANY(station.uni_tags) OR 'all' = ANY(station.uni_tags))
  GROUP BY station.station_id
  ORDER BY CASE WHEN max(previous.started_at) IS NULL THEN 0 ELSE 1 END,
    max(previous.started_at) ASC NULLS FIRST, station.station_id
  LIMIT 1;
  IF v_station_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate_mmi_station_unavailable';
  END IF;
  INSERT INTO public.candidate_mmi_station_sessions (
    user_id, station_id, started_at, practice_scope, target_university_snapshot
  ) VALUES (v_user_id, v_station_id, v_now, p_scope, CASE WHEN p_scope = 'target' THEN v_target END)
  RETURNING id INTO v_session_id;
  FOR v_prompt IN
    SELECT question.sub_q_id, question.order_num, question.question_text
    FROM public.mmi_sub_questions AS question
    WHERE question.station_id = v_station_id
    ORDER BY question.order_num
  LOOP
    v_snapshot_count := v_snapshot_count + 1;
    INSERT INTO public.candidate_mmi_station_prompt_snapshots (
      session_id, prompt_order, sub_question_id, prompt_text
    ) VALUES (v_session_id, v_prompt.order_num, v_prompt.sub_q_id, v_prompt.question_text);
  END LOOP;
  IF v_snapshot_count <> 5 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'candidate_prompt_snapshot_count_mismatch';
  END IF;
  RETURN public.get_candidate_mmi_station_session(v_session_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_candidate_mmi_station_result(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_session public.candidate_mmi_station_sessions;
  v_feedback jsonb;
  v_complete boolean;
  v_overall numeric;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions AS session
  WHERE session.id = p_session_id AND session.user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'candidate session is not owned by caller'; END IF;
  IF v_session.abandoned_at IS NOT NULL OR clock_timestamp() < v_session.started_at + interval '660 seconds' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'candidate_mmi_result_not_ready';
  END IF;
  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, clock_timestamp());
  SELECT bool_and(response.scoring_status IN ('scored', 'no_response')),
    round(sum(CASE WHEN response.scoring_status = 'scored'
      THEN COALESCE((response.public_assessment->>'questionScorePct')::numeric, 0) ELSE 0 END) / 5, 2)
  INTO v_complete, v_overall
  FROM public.candidate_mmi_station_responses AS response WHERE response.session_id = p_session_id;
  v_feedback := public.get_candidate_mmi_station_feedback(p_session_id);
  RETURN jsonb_build_object(
    'sessionId', p_session_id,
    'stationId', v_session.station_id,
    'status', CASE WHEN v_complete THEN 'completed' ELSE 'awaiting_scoring' END,
    'overallPct', CASE WHEN v_complete THEN v_overall ELSE NULL END,
    'feedback', v_feedback
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_candidate_mmi_history(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_history_limit';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(item ORDER BY item->>'startedAt' DESC)
    FROM (
      SELECT jsonb_build_object(
        'sessionId', session.id, 'stationId', session.station_id,
        'scope', COALESCE(session.practice_scope, 'all'),
        'targetUniversity', session.target_university_snapshot,
        'startedAt', session.started_at,
        'completedAt', CASE WHEN session.abandoned_at IS NULL AND clock_timestamp() >= session.started_at + interval '660 seconds' THEN session.started_at + interval '660 seconds' ELSE NULL END,
        'status', CASE WHEN session.abandoned_at IS NOT NULL THEN 'abandoned'
          WHEN count(response.id) = 5 AND bool_and(response.scoring_status IN ('scored', 'no_response')) THEN 'completed'
          ELSE 'awaiting_scoring' END,
        'overallPct', CASE WHEN session.abandoned_at IS NULL AND count(response.id) = 5 AND bool_and(response.scoring_status IN ('scored', 'no_response'))
          THEN round(sum(CASE WHEN response.scoring_status = 'scored' THEN COALESCE((response.public_assessment->>'questionScorePct')::numeric, 0) ELSE 0 END) / 5, 2) ELSE NULL END,
        'domainAttainment', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('domain', grouped.domain, 'achieved', grouped.achieved, 'total', grouped.total, 'pct', round(grouped.achieved::numeric * 100 / grouped.total, 2)) ORDER BY grouped.domain)
          FROM (
            SELECT criterion.value->>'domain' AS domain,
              count(*)::integer AS total,
              count(*) FILTER (WHERE COALESCE((decision.value->>'achieved')::boolean, false))::integer AS achieved
            FROM public.candidate_mmi_station_prompt_snapshots AS snapshot
            CROSS JOIN LATERAL jsonb_array_elements(snapshot.rubric_snapshot->'criteria') AS criterion(value)
            LEFT JOIN public.candidate_mmi_station_responses AS domain_response
              ON domain_response.session_id = snapshot.session_id AND domain_response.prompt_order = snapshot.prompt_order
            LEFT JOIN LATERAL jsonb_array_elements(COALESCE(domain_response.public_assessment->'criteria', '[]'::jsonb)) AS decision(value)
              ON decision.value->>'criterionId' = criterion.value->>'criterionId'
            WHERE snapshot.session_id = session.id AND jsonb_typeof(criterion.value->'domain') = 'string'
            GROUP BY criterion.value->>'domain'
          ) AS grouped
        ), '[]'::jsonb)
      ) AS item
      FROM public.candidate_mmi_station_sessions AS session
      LEFT JOIN public.candidate_mmi_station_responses AS response ON response.session_id = session.id
      WHERE session.user_id = v_user_id
      GROUP BY session.id
      ORDER BY session.started_at DESC
      LIMIT p_limit
    ) AS history
  ), '[]'::jsonb);
END;
$function$;

-- Re-define start after snapshot triggers: one station-version row is loaded
-- once and supplies scenario, questions, and criteria atomically.
CREATE OR REPLACE FUNCTION public.start_candidate_mmi_station_session(p_scope text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_session_id uuid; v_station_id text; v_target text;
  v_now timestamptz := clock_timestamp(); v_version integer; v_content jsonb; v_prompt jsonb; v_count integer := 0; v_content_valid boolean;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication required'; END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('target','all') THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_candidate_mmi_practice_scope'; END IF;
  SELECT public.canonical_mmi_university_tag(university_target) INTO v_target FROM public.profiles WHERE id=v_user_id;
  IF p_scope='target' AND v_target IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='candidate_university_target_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));
  SELECT id INTO v_session_id FROM public.candidate_mmi_station_sessions
  WHERE user_id=v_user_id AND abandoned_at IS NULL AND v_now<started_at+interval '660 seconds'
  ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
  IF v_session_id IS NOT NULL THEN RETURN public.get_candidate_mmi_station_session(v_session_id); END IF;
  SELECT station.station_id INTO v_station_id FROM public.mmi_stations AS station
  LEFT JOIN public.candidate_mmi_station_sessions AS previous ON previous.user_id=v_user_id AND previous.station_id=station.station_id
  WHERE public.is_complete_published_mmi_station(station.station_id)
    AND (p_scope='all' OR v_target=ANY(station.uni_tags) OR 'all'=ANY(station.uni_tags))
  GROUP BY station.station_id
  ORDER BY CASE WHEN max(previous.started_at) IS NULL THEN 0 ELSE 1 END, max(previous.started_at) ASC NULLS FIRST, station.station_id LIMIT 1;
  IF v_station_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='candidate_mmi_station_unavailable'; END IF;
  SELECT version, content_snapshot INTO v_version, v_content FROM public.mmi_station_versions
  WHERE station_id=v_station_id ORDER BY version DESC LIMIT 1 FOR KEY SHARE;
  IF v_content IS NULL OR jsonb_typeof(v_content->'questions') <> 'array' OR jsonb_array_length(v_content->'questions') <> 5
    OR jsonb_typeof(v_content->'scenarioText') <> 'string' OR v_content->>'stationId' IS DISTINCT FROM v_station_id THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_mmi_station_version_unavailable'; END IF;
  SELECT count(*)=5 AND count(DISTINCT (prompt.value->>'orderNum'))=5
    AND min((prompt.value->>'orderNum')::integer)=1 AND max((prompt.value->>'orderNum')::integer)=5
    AND bool_and(jsonb_typeof(prompt.value->'subQuestionId')='string' AND jsonb_typeof(prompt.value->'questionText')='string'
      AND jsonb_typeof(prompt.value->'criteria')='array' AND jsonb_array_length(prompt.value->'criteria')>0)
  INTO v_content_valid FROM jsonb_array_elements(v_content->'questions') AS prompt(value);
  IF NOT COALESCE(v_content_valid,false) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_mmi_station_version_invalid'; END IF;
  INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,practice_scope,target_university_snapshot,scenario_text_snapshot,station_version_snapshot)
  VALUES(v_user_id,v_station_id,v_now,p_scope,CASE WHEN p_scope='target' THEN v_target END,v_content->>'scenarioText',v_version)
  RETURNING id INTO v_session_id;
  FOR v_prompt IN SELECT value FROM jsonb_array_elements(v_content->'questions') LOOP
    v_count:=v_count+1;
    IF jsonb_typeof(v_prompt->'criteria') <> 'array' OR jsonb_array_length(v_prompt->'criteria') < 1 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_mmi_station_version_rubric_missing'; END IF;
    INSERT INTO public.candidate_mmi_station_prompt_snapshots(session_id,prompt_order,sub_question_id,prompt_text,rubric_snapshot,scoring_contract_snapshot)
    VALUES(v_session_id,(v_prompt->>'orderNum')::smallint,v_prompt->>'subQuestionId',v_prompt->>'questionText',
      jsonb_build_object('version',1,'criteria',(SELECT jsonb_agg(jsonb_build_object('criterionId',criterion.value->>'criterionId','bulletText',criterion.value->>'bulletText','domain',criterion.value->'domain') ORDER BY criterion.ordinality) FROM jsonb_array_elements(v_prompt->'criteria') WITH ORDINALITY AS criterion(value,ordinality))),
      jsonb_build_object('version','2026-09-10.1'));
  END LOOP;
  IF v_count<>5 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_prompt_snapshot_count_mismatch'; END IF;
  RETURN public.get_candidate_mmi_station_session(v_session_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_candidate_mmi_station_session(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_user_id uuid:=auth.uid(); v_now timestamptz:=clock_timestamp(); v_session public.candidate_mmi_station_sessions; v_elapsed integer; v_order smallint; v_window record; v_snapshot public.candidate_mmi_station_prompt_snapshots; v_draft public.candidate_mmi_station_response_drafts;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication required'; END IF;
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions WHERE id=p_session_id AND user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='candidate session is not owned by caller'; END IF;
  IF v_session.abandoned_at IS NOT NULL THEN RETURN jsonb_build_object('sessionId',p_session_id,'stationId',v_session.station_id,'serverNow',v_now,'phase','abandoned','phaseStartedAt',v_session.abandoned_at,'phaseEndsAt',v_session.abandoned_at); END IF;
  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id,v_now); v_elapsed:=greatest(0,floor(extract(epoch FROM v_now-v_session.started_at))::integer);
  IF v_elapsed<60 THEN
    IF v_session.scenario_text_snapshot IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_scenario_snapshot_missing'; END IF;
    RETURN jsonb_build_object('sessionId',p_session_id,'stationId',v_session.station_id,'serverNow',v_now,'phase','scenario','phaseStartedAt',v_session.started_at,'phaseEndsAt',v_session.started_at+interval '60 seconds','scenarioText',v_session.scenario_text_snapshot);
  END IF;
  IF v_elapsed>=660 THEN RETURN jsonb_build_object('sessionId',p_session_id,'stationId',v_session.station_id,'serverNow',v_now,'phase','completed','phaseStartedAt',v_session.started_at+interval '660 seconds','phaseEndsAt',NULL); END IF;
  v_order:=(((v_elapsed-60)/120)+1)::smallint; SELECT * INTO v_window FROM public.candidate_mmi_station_window(v_session.started_at,v_order); SELECT * INTO v_snapshot FROM public.candidate_mmi_station_prompt_snapshots WHERE session_id=p_session_id AND prompt_order=v_order; SELECT * INTO v_draft FROM public.candidate_mmi_station_response_drafts WHERE session_id=p_session_id AND prompt_order=v_order;
  IF NOT FOUND THEN v_draft.transcript:=''; v_draft.client_revision:=0; END IF;
  RETURN jsonb_build_object('sessionId',p_session_id,'stationId',v_session.station_id,'serverNow',v_now,'phase','response','phaseStartedAt',v_window.starts_at,'phaseEndsAt',v_window.ends_at,'promptOrder',v_order,'promptText',v_snapshot.prompt_text,'draftTranscript',v_draft.transcript,'draftRevision',v_draft.client_revision,'responseStatus','open');
END;
$function$;

CREATE OR REPLACE FUNCTION public.candidate_mmi_station_has_complete_v3_result(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $function$
  SELECT count(*)=5 AND bool_and(COALESCE(
    (response.scoring_status='scored' AND jsonb_typeof(response.public_assessment->'schemaVersion')='number' AND response.public_assessment->>'schemaVersion'='3')
    OR (response.scoring_status='no_response' AND snapshot.rubric_snapshot->>'version'='1' AND jsonb_typeof(snapshot.rubric_snapshot->'criteria')='array' AND jsonb_array_length(snapshot.rubric_snapshot->'criteria')>0),
    false
  )) FROM public.candidate_mmi_station_responses AS response
  JOIN public.candidate_mmi_station_prompt_snapshots AS snapshot ON snapshot.session_id=response.session_id AND snapshot.prompt_order=response.prompt_order
  WHERE response.session_id=p_session_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_candidate_mmi_station_result(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_user_id uuid:=auth.uid(); v_session public.candidate_mmi_station_sessions; v_complete boolean; v_feedback jsonb; v_overall numeric;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication required'; END IF;
  SELECT * INTO v_session FROM public.candidate_mmi_station_sessions WHERE id=p_session_id AND user_id=v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='candidate session is not owned by caller'; END IF;
  IF v_session.abandoned_at IS NOT NULL OR clock_timestamp()<v_session.started_at+interval '660 seconds' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='candidate_mmi_result_not_ready'; END IF;
  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id,clock_timestamp()); v_complete:=public.candidate_mmi_station_has_complete_v3_result(p_session_id); v_feedback:=public.get_candidate_mmi_station_feedback(p_session_id);
  IF v_complete THEN SELECT round(sum(CASE WHEN scoring_status='scored' THEN (public_assessment->>'questionScorePct')::numeric ELSE 0 END)/5,2) INTO v_overall FROM public.candidate_mmi_station_responses WHERE session_id=p_session_id; END IF;
  RETURN jsonb_build_object('sessionId',p_session_id,'stationId',v_session.station_id,'status',CASE WHEN v_complete THEN 'completed' ELSE 'awaiting_scoring' END,'overallPct',CASE WHEN v_complete THEN v_overall ELSE NULL END,'feedback',v_feedback);
END;
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
          SELECT criterion.value->>'domain' AS domain,count(*)::integer AS total,count(*) FILTER (WHERE COALESCE((decision.value->>'achieved')::boolean,false))::integer AS achieved
          FROM public.candidate_mmi_station_prompt_snapshots AS snapshot
          CROSS JOIN LATERAL jsonb_array_elements(snapshot.rubric_snapshot->'criteria') AS criterion(value)
          LEFT JOIN public.candidate_mmi_station_responses AS domain_response ON domain_response.session_id=snapshot.session_id AND domain_response.prompt_order=snapshot.prompt_order
          LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN domain_response.public_assessment->>'schemaVersion'='3' THEN domain_response.public_assessment->'criteria' ELSE '[]'::jsonb END) AS decision(value) ON decision.value->>'criterionId'=criterion.value->>'criterionId'
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

REVOKE ALL ON FUNCTION public.canonical_mmi_university_tag(text), public.is_complete_published_mmi_station(text), public.get_candidate_mmi_practice_options(), public.start_candidate_mmi_station_session(text), public.get_candidate_mmi_station_result(uuid), public.list_candidate_mmi_history(integer), public.candidate_mmi_station_has_complete_v3_result(uuid), public.prevent_candidate_mmi_station_session_snapshot_mutation(), public.prevent_candidate_mmi_station_prompt_snapshot_mutation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.canonical_mmi_university_tag(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_candidate_mmi_practice_options(), public.start_candidate_mmi_station_session(text), public.get_candidate_mmi_station_result(uuid), public.list_candidate_mmi_history(integer) TO authenticated;

COMMIT;
