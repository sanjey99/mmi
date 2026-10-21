-- Bound new station/snapshot creation using existing private session metadata.
-- Active-session reuse is free. Abandonment cannot refund an admission.
-- No new per-account counters, answer data, global cap, or paid limit is added.
-- Apply only this exact migration after a target/schema/body/grant preflight.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
  IF to_regprocedure('public.start_candidate_mmi_station_session(text)') IS NULL
    OR to_regprocedure('public.get_candidate_mmi_station_session(uuid)') IS NULL
    OR to_regprocedure('public.canonical_mmi_university_tag(text)') IS NULL
    OR to_regprocedure('public.is_complete_published_mmi_station(text)') IS NULL
    OR to_regclass('public.mmi_station_versions') IS NULL
    OR to_regclass('public.candidate_mmi_station_prompt_snapshots') IS NULL THEN
    RAISE EXCEPTION 'Station start prerequisites missing';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.start_candidate_mmi_station_session(text)'::regprocedure) IS DISTINCT FROM '1899c95d662fcf42f079a51e0e9d2dfc'
    OR NOT (SELECT prosecdef AND pg_get_userbyid(proowner)='postgres' FROM pg_proc WHERE oid='public.start_candidate_mmi_station_session(text)'::regprocedure) THEN
    RAISE EXCEPTION 'Station start body/owner differs from reviewed baseline';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='start_candidate_mmi_station_session'
      AND p.oid<>'public.start_candidate_mmi_station_session(text)'::regprocedure) THEN
    RAISE EXCEPTION 'Unexpected station start overload; review possible bypass';
  END IF;
  IF has_function_privilege('public','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR has_function_privilege('anon','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR has_function_privilege('service_role','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.start_candidate_mmi_station_session(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Station start grants differ from reviewed boundary';
  END IF;
  -- Candidate roles must not write the admission ledger directly. Trusted
  -- postgres/service-role maintenance already has table access and remains
  -- outside this candidate-admission boundary; preserve its existing grants.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.candidate_mmi_station_sessions'::regclass)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) role_name
      WHERE has_table_privilege(role_name,'public.candidate_mmi_station_sessions','INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_any_column_privilege(role_name,'public.candidate_mmi_station_sessions','INSERT,UPDATE')) THEN
    RAISE EXCEPTION 'Private session metadata write boundary differs from reviewed grants';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_am am ON am.oid=idx.relam
    WHERE i.indrelid='public.candidate_mmi_station_sessions'::regclass
      AND i.indisvalid AND i.indisready AND i.indnkeyatts>=2 AND i.indpred IS NULL AND i.indexprs IS NULL
      AND am.amname='btree'
      AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='user_id' AND NOT attisdropped)
      AND i.indkey[1]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='started_at' AND NOT attisdropped)
  ) THEN RAISE EXCEPTION 'Station start requires existing owner/time index'; END IF;
  IF to_regclass('public.mmi_station_start_limits') IS NOT NULL THEN
    RAISE EXCEPTION 'Station start limits already exist; review instead of replacing';
  END IF;
END;
$preflight$;
CREATE TABLE public.mmi_station_start_limits (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  starts_per_utc_day integer NOT NULL DEFAULT 30 CHECK(starts_per_utc_day BETWEEN 1 AND 1000),
  starts_per_rolling_minute integer NOT NULL DEFAULT 5 CHECK(starts_per_rolling_minute BETWEEN 1 AND 100),
  creation_paused boolean NOT NULL DEFAULT false,
  CHECK(starts_per_rolling_minute<=starts_per_utc_day)
);
ALTER TABLE public.mmi_station_start_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mmi_station_start_limits FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.mmi_station_start_limits(singleton) VALUES(true);

CREATE OR REPLACE FUNCTION public.start_candidate_mmi_station_session(p_scope text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  v_user_id uuid := auth.uid(); v_session_id uuid; v_active_scope text; v_station_id text; v_target text;
  v_now timestamptz := clock_timestamp(); v_version integer; v_content jsonb; v_prompt jsonb; v_count integer := 0; v_content_valid boolean;
  v_limits public.mmi_station_start_limits; v_day_start timestamptz; v_day_end timestamptz;
  v_daily_starts bigint; v_recent_starts bigint;
BEGIN
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_user_id) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='profile required'; END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('target','all') THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_candidate_mmi_practice_scope'; END IF;
  SELECT public.canonical_mmi_university_tag(university_target) INTO v_target FROM public.profiles WHERE id=v_user_id;
  IF p_scope='target' AND v_target IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='candidate_university_target_required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));
  v_now:=clock_timestamp();
  SELECT id, practice_scope INTO v_session_id, v_active_scope FROM public.candidate_mmi_station_sessions
  WHERE user_id=v_user_id AND abandoned_at IS NULL AND v_now<started_at+interval '660 seconds'
  ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
  IF v_session_id IS NOT NULL THEN
    IF v_active_scope IS DISTINCT FROM p_scope THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_mmi_active_session_scope_mismatch';
    END IF;
    RETURN public.get_candidate_mmi_station_session(v_session_id);
  END IF;
  -- Reusing an active station above is always free, including while creation
  -- is paused. Existing session rows are the admission ledger: abandonment
  -- never removes a row or refunds a start, and no new personal data is stored.
  SELECT * INTO v_limits FROM public.mmi_station_start_limits WHERE singleton FOR SHARE;
  IF NOT FOUND OR v_limits.creation_paused THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_mmi_start_rate_limited';
  END IF;
  v_day_start:=date_trunc('day',v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_day_end:=v_day_start+interval '24 hours';
  SELECT count(*) INTO v_daily_starts FROM public.candidate_mmi_station_sessions
  WHERE user_id=v_user_id AND started_at>=v_day_start AND started_at<v_day_end;
  SELECT count(*) INTO v_recent_starts FROM public.candidate_mmi_station_sessions
  WHERE user_id=v_user_id AND started_at>v_now-interval '60 seconds' AND started_at<=v_now;
  IF v_daily_starts>=v_limits.starts_per_utc_day OR v_recent_starts>=v_limits.starts_per_rolling_minute THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_mmi_start_rate_limited';
  END IF;
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

ALTER FUNCTION public.start_candidate_mmi_station_session(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.start_candidate_mmi_station_session(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.start_candidate_mmi_station_session(text) TO authenticated;
DO $postflight$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.mmi_station_start_limits'::regclass)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role_name
      WHERE has_table_privilege(role_name,'public.mmi_station_start_limits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    OR has_function_privilege('public','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR has_function_privilege('anon','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR has_function_privilege('service_role','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.start_candidate_mmi_station_session(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Station start limits private grant boundary failed';
  END IF;
END;
$postflight$;
COMMIT;
