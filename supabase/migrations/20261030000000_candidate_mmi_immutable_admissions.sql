-- Keep admission accounting independent of the mutable MMI phase clock.
-- Legacy original admission times are unknown: freeze the possible range,
-- charge overlapping windows conservatively, and never reset history to now.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog,public,pg_temp;

LOCK TABLE public.candidate_mmi_station_sessions IN ACCESS EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF to_regprocedure('public.start_candidate_mmi_station_session(text)') IS NULL
    OR to_regprocedure('public.finalize_candidate_mmi_station_response(uuid,smallint,uuid)') IS NULL
    OR to_regclass('public.mmi_station_start_limits') IS NULL THEN
    RAISE EXCEPTION 'Immutable admission prerequisites missing';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.start_candidate_mmi_station_session(text)'::regprocedure) IS DISTINCT FROM '9cbea31c28fc4583cfbadd0946a27495'
    OR NOT (SELECT prosecdef AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid='public.start_candidate_mmi_station_session(text)'::regprocedure) THEN
    RAISE EXCEPTION 'Station start body, owner, or settings differ from reviewed baseline';
  END IF;
  -- The <=600-second uncertainty follows from five responses, each with at
  -- most 120 unused seconds. Refuse an unreviewed finalization/window body.
  -- The second exact hash is the independently reviewed hosted copy: only
  -- line indentation/trailing whitespace differs from the repository body.
  IF NOT COALESCE((SELECT md5(prosrc) IN ('7c323c18185b25935c4bdf1306c659b3','8952bff189261603079dcbda42014c7f')
      FROM pg_proc WHERE oid='public.finalize_candidate_mmi_station_response(uuid,smallint,uuid)'::regprocedure),false)
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.candidate_mmi_station_window(timestamptz,smallint)'::regprocedure) IS DISTINCT FROM '6870c6ead534eb4f2d87ac11f190d14f' THEN
    RAISE EXCEPTION 'Phase rewind boundary differs from reviewed baseline';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='start_candidate_mmi_station_session'
      AND p.oid<>'public.start_candidate_mmi_station_session(text)'::regprocedure) THEN
    RAISE EXCEPTION 'Unexpected station start overload';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.candidate_mmi_station_sessions'::regclass
      AND attname IN ('admission_earliest_at','admission_latest_at') AND NOT attisdropped)
    OR to_regclass('public.candidate_mmi_station_sessions_admission_count') IS NOT NULL
    OR to_regprocedure('public.prevent_candidate_mmi_admission_window_mutation()') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.candidate_mmi_station_sessions'::regclass AND tgname='candidate_mmi_admission_window_immutable')
    OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.candidate_mmi_station_sessions'::regclass AND conname='candidate_mmi_admission_window_valid') THEN
    RAISE EXCEPTION 'Admission metadata already exists; review instead of replacing';
  END IF;
  IF NOT (SELECT relrowsecurity AND pg_get_userbyid(relowner)='postgres' FROM pg_class WHERE oid='public.candidate_mmi_station_sessions'::regclass)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) role_name
      WHERE has_table_privilege(role_name,'public.candidate_mmi_station_sessions','INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_any_column_privilege(role_name,'public.candidate_mmi_station_sessions','INSERT,UPDATE'))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role_name
      WHERE has_table_privilege(role_name,'public.mmi_station_start_limits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    OR has_function_privilege('public','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR has_function_privilege('anon','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR has_function_privilege('service_role','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.start_candidate_mmi_station_session(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Admission private role boundary differs from reviewed grants';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_am am ON am.oid=idx.relam
    WHERE i.indrelid='public.candidate_mmi_station_sessions'::regclass
      AND i.indisvalid AND i.indisready AND i.indnkeyatts>=2 AND i.indpred IS NULL AND i.indexprs IS NULL AND am.amname='btree'
      AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='user_id' AND NOT attisdropped)
      AND i.indkey[1]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='started_at' AND NOT attisdropped)) THEN
    RAISE EXCEPTION 'Existing phase clock index is unavailable';
  END IF;
END;
$preflight$;

-- Keep the invariant snapshot transaction-local without creating a relation.
-- It contains only private role/index/config metadata, no answers or account
-- identifiers. COMMIT/ROLLBACK discards this local value (or restores the
-- caller's prior setting); the postflight never trusts a prior value.
DO $invariants$
DECLARE v_snapshot jsonb;
BEGIN
  SELECT jsonb_build_object('tableAcl',to_jsonb(relacl),'ownerId',relowner,'rowSecurity',relrowsecurity,
    'limits',(SELECT row_to_json(limits.*)::jsonb FROM public.mmi_station_start_limits limits WHERE singleton),
    'existingIndexes',(SELECT jsonb_agg(jsonb_build_object('oid',i.indexrelid,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid)
      FROM pg_index i WHERE i.indrelid='public.candidate_mmi_station_sessions'::regclass))
  INTO v_snapshot FROM pg_class WHERE oid='public.candidate_mmi_station_sessions'::regclass;
  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'Admission invariant snapshot unavailable'; END IF;
  PERFORM set_config('app.mmi_admission_cutover_invariants',v_snapshot::text,true);
END;
$invariants$;

ALTER TABLE public.candidate_mmi_station_sessions
  ADD COLUMN admission_earliest_at timestamptz,
  ADD COLUMN admission_latest_at timestamptz;
DO $cutover$
DECLARE v_cutover timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  -- This clock is captured only after the table lock. Existing active sessions
  -- cannot be rewound concurrently while their admission bounds are frozen.
  IF EXISTS(SELECT 1 FROM public.candidate_mmi_station_sessions
    WHERE NOT isfinite(started_at) OR started_at>v_cutover) THEN
    RAISE EXCEPTION 'Existing phase timestamp is outside the reviewed cutover range';
  END IF;
  UPDATE public.candidate_mmi_station_sessions
  SET admission_earliest_at=started_at,
      admission_latest_at=least(v_cutover,started_at+interval '600 seconds')
  WHERE admission_earliest_at IS NULL AND admission_latest_at IS NULL;
END;
$cutover$;
ALTER TABLE public.candidate_mmi_station_sessions
  ALTER COLUMN admission_earliest_at SET NOT NULL,
  ALTER COLUMN admission_latest_at SET NOT NULL,
  ALTER COLUMN admission_earliest_at SET DEFAULT statement_timestamp(),
  ALTER COLUMN admission_latest_at SET DEFAULT statement_timestamp(),
  ADD CONSTRAINT candidate_mmi_admission_window_valid CHECK(
    isfinite(admission_earliest_at) AND isfinite(admission_latest_at)
    AND admission_earliest_at<=admission_latest_at
    AND admission_latest_at-admission_earliest_at<=interval '600 seconds');

CREATE FUNCTION public.prevent_candidate_mmi_admission_window_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $function$
BEGIN
  IF NEW.admission_earliest_at IS DISTINCT FROM OLD.admission_earliest_at
    OR NEW.admission_latest_at IS DISTINCT FROM OLD.admission_latest_at THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='candidate_mmi_admission_window_immutable';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.prevent_candidate_mmi_admission_window_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_candidate_mmi_admission_window_mutation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER candidate_mmi_admission_window_immutable
BEFORE UPDATE OF admission_earliest_at,admission_latest_at ON public.candidate_mmi_station_sessions
FOR EACH ROW EXECUTE FUNCTION public.prevent_candidate_mmi_admission_window_mutation();
CREATE INDEX candidate_mmi_station_sessions_admission_count
ON public.candidate_mmi_station_sessions(user_id,admission_latest_at,admission_earliest_at);

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
  -- Reuse remains free, including during a pause. Admission bounds are private,
  -- immutable accounting metadata; started_at remains the mutable phase clock.
  -- Legacy uncertainty is charged to each window that it could overlap.
  SELECT * INTO v_limits FROM public.mmi_station_start_limits WHERE singleton FOR SHARE;
  IF NOT FOUND OR v_limits.creation_paused THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='candidate_mmi_start_rate_limited';
  END IF;
  v_day_start:=date_trunc('day',v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_day_end:=v_day_start+interval '24 hours';
  SELECT count(*) INTO v_daily_starts FROM public.candidate_mmi_station_sessions
  WHERE user_id=v_user_id AND admission_earliest_at<v_day_end AND admission_latest_at>=v_day_start;
  SELECT count(*) INTO v_recent_starts FROM public.candidate_mmi_station_sessions
  WHERE user_id=v_user_id AND admission_latest_at>v_now-interval '60 seconds' AND admission_earliest_at<=v_now;
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
  INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,admission_earliest_at,admission_latest_at,practice_scope,target_university_snapshot,scenario_text_snapshot,station_version_snapshot)
  VALUES(v_user_id,v_station_id,v_now,v_now,v_now,p_scope,CASE WHEN p_scope='target' THEN v_target END,v_content->>'scenarioText',v_version)
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
COMMENT ON COLUMN public.candidate_mmi_station_sessions.admission_earliest_at IS
  'Private immutable admission lower bound. Equals upper bound for new RPC admissions; legacy time is uncertain by at most 600 seconds.';
COMMENT ON COLUMN public.candidate_mmi_station_sessions.admission_latest_at IS
  'Private immutable admission upper bound. Legacy value is clamped to cutover time; overlapping windows are charged conservatively.';

DO $postflight$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  v_before:=nullif(current_setting('app.mmi_admission_cutover_invariants',true),'')::jsonb;
  IF jsonb_typeof(v_before) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Admission invariant snapshot missing'; END IF;
  SELECT jsonb_build_object('tableAcl',to_jsonb(relacl),'ownerId',relowner,'rowSecurity',relrowsecurity,
    'limits',(SELECT row_to_json(limits.*)::jsonb FROM public.mmi_station_start_limits limits WHERE singleton),
    'existingIndexes',(SELECT jsonb_agg(jsonb_build_object('oid',i.indexrelid,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid)
      FROM pg_index i WHERE i.indrelid='public.candidate_mmi_station_sessions'::regclass AND i.indexrelid<>'public.candidate_mmi_station_sessions_admission_count'::regclass))
  INTO v_after FROM pg_class WHERE oid='public.candidate_mmi_station_sessions'::regclass;
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'Existing session/config/index boundary changed during admission cutover';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.candidate_mmi_station_sessions'::regclass
      AND attname IN ('admission_earliest_at','admission_latest_at') AND atttypid='timestamptz'::regtype AND attnotnull AND NOT attisdropped)<>2
    OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.candidate_mmi_station_sessions'::regclass AND conname='candidate_mmi_admission_window_valid' AND convalidated)
    OR NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid='public.candidate_mmi_station_sessions_admission_count'::regclass AND i.indisvalid AND i.indisready)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.candidate_mmi_station_sessions'::regclass AND tgname='candidate_mmi_admission_window_immutable'
      AND tgfoid='public.prevent_candidate_mmi_admission_window_mutation()'::regprocedure AND tgenabled='O' AND NOT tgisinternal)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) role_name
      WHERE has_table_privilege(role_name,'public.candidate_mmi_station_sessions','INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_any_column_privilege(role_name,'public.candidate_mmi_station_sessions','INSERT,UPDATE'))
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role_name
      WHERE has_function_privilege(role_name,'public.prevent_candidate_mmi_admission_window_mutation()','EXECUTE'))
    OR has_function_privilege('public','public.prevent_candidate_mmi_admission_window_mutation()','EXECUTE')
    OR has_function_privilege('public','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR has_function_privilege('anon','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR has_function_privilege('service_role','public.start_candidate_mmi_station_session(text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.start_candidate_mmi_station_session(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Immutable admission metadata or private grant boundary failed';
  END IF;
END;
$postflight$;
COMMIT;
