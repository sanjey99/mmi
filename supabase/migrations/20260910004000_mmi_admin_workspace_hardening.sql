BEGIN;

-- Published content is immutable at the administrative save boundary.  Do not
-- use a table trigger: importer and snapshot integrity tests legitimately edit
-- source rows while they prove a candidate still receives the old snapshot.
DROP TRIGGER IF EXISTS reject_published_mmi_station_content_write ON public.mmi_stations;
DROP FUNCTION IF EXISTS public.reject_published_mmi_station_content_write();

DO $block$
DECLARE
  v_definition text;
  v_anchor text := '  v_new_version := CASE WHEN v_current_exists THEN v_current.content_version + 1 ELSE 1 END;';
  v_guard text := E'  IF v_current_exists AND v_current.status = ''published'' THEN\n    RAISE EXCEPTION USING ERRCODE = ''22023'', MESSAGE = ''mmi_published_station_must_be_unpublished_before_editing'';\n  END IF;\n  v_new_version := CASE WHEN v_current_exists THEN v_current.content_version + 1 ELSE 1 END;';
BEGIN
  SELECT pg_get_functiondef('public.save_admin_mmi_station(jsonb,integer)'::regprocedure) INTO v_definition;
  IF position(v_guard IN v_definition) = 0 THEN
    IF position(v_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION 'save_admin_mmi_station guard anchor not found';
    END IF;
    EXECUTE replace(v_definition, v_anchor, v_guard);
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.get_admin_mmi_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_provider text;
  v_model text;
  v_configured boolean;
  v_period_start timestamptz := date_trunc('month', timezone('UTC', clock_timestamp())) AT TIME ZONE 'UTC';
  v_period_end timestamptz := (date_trunc('month', timezone('UTC', clock_timestamp())) + interval '1 month') AT TIME ZONE 'UTC';
BEGIN
  PERFORM public.require_mmi_admin();
  SELECT max(value) FILTER (WHERE key = 'ai_provider'), max(value) FILTER (WHERE key = 'ai_model'),
    COALESCE(bool_or(key = 'ai_api_key' AND NULLIF(btrim(value), '') IS NOT NULL), false)
  INTO v_provider, v_model, v_configured
  FROM public.app_config WHERE key IN ('ai_provider', 'ai_model', 'ai_api_key');
  RETURN jsonb_build_object(
    'stationCounts', jsonb_build_object('draft',(SELECT count(*) FROM public.mmi_stations WHERE status='draft'),'published',(SELECT count(*) FROM public.mmi_stations WHERE status='published'),'archived',(SELECT count(*) FROM public.mmi_stations WHERE status='archived')),
    'universityCounts', COALESCE((SELECT jsonb_agg(jsonb_build_object('tag', grouped.tag, 'count', grouped.station_count) ORDER BY grouped.tag) FROM (SELECT tag,count(DISTINCT station.station_id)::integer AS station_count FROM public.mmi_stations AS station CROSS JOIN LATERAL unnest(COALESCE(station.uni_tags,'{}'::text[])) AS tag WHERE public.is_complete_published_mmi_station(station.station_id) GROUP BY tag) AS grouped),'[]'::jsonb),
    'contentHealth', jsonb_build_object('stationCount',(SELECT count(*) FROM public.mmi_stations),'questionCount',(SELECT count(*) FROM public.mmi_sub_questions),'criterionCount',(SELECT count(*) FROM public.mmi_marking_criteria),'invalidStationCount',(SELECT count(*) FROM public.mmi_stations AS station WHERE station.status='published' AND NOT public.is_complete_published_mmi_station(station.station_id))),
    'ai', jsonb_build_object('provider',COALESCE(v_provider,'anthropic'),'model',COALESCE(v_model,'unconfigured'),'isConfigured',v_configured),
    'usage', jsonb_build_object(
      'periodStart', to_char(v_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'periodEnd', to_char(v_period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'callCount',(SELECT count(*) FROM public.mmi_ai_usage_events WHERE created_at>=v_period_start AND created_at<v_period_end),
      'knownCost',to_char(COALESCE((SELECT sum(estimated_cost) FROM public.mmi_ai_usage_events WHERE estimated_cost IS NOT NULL AND created_at>=v_period_start AND created_at<v_period_end),0),'FM99999999.00000000'),
      'unknownCostCount',(SELECT count(*) FROM public.mmi_ai_usage_events WHERE estimated_cost IS NULL AND created_at>=v_period_start AND created_at<v_period_end),
      'failureCount',(SELECT count(*) FROM public.mmi_ai_usage_events WHERE outcome<>'scored' AND created_at>=v_period_start AND created_at<v_period_end)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_admin_mmi_stations_v2(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_query text; v_status text; v_university text; v_category text; v_topic text; v_difficulty text;
  v_limit integer; v_offset integer;
BEGIN
  PERFORM public.require_mmi_admin();
  IF jsonb_typeof(p_filters) <> 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_filters) AS key WHERE key <> ALL(ARRAY['query','status','university','category','topic','difficulty','limit','offset']))
    OR COALESCE(p_filters->>'limit','20') !~ '^[0-9]+$' OR COALESCE(p_filters->>'offset','0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_admin_station_filters';
  END IF;
  v_limit:=COALESCE((p_filters->>'limit')::integer,20); v_offset:=COALESCE((p_filters->>'offset')::integer,0);
  v_query:=NULLIF(btrim(p_filters->>'query'),''); v_status:=NULLIF(btrim(p_filters->>'status'),'');
  v_university:=public.canonical_mmi_university_tag(NULLIF(btrim(p_filters->>'university'),''));
  v_category:=NULLIF(btrim(p_filters->>'category'),''); v_topic:=NULLIF(btrim(p_filters->>'topic'),''); v_difficulty:=NULLIF(btrim(p_filters->>'difficulty'),'');
  IF v_limit NOT BETWEEN 1 AND 100 OR v_offset NOT BETWEEN 0 AND 1000000
    OR char_length(COALESCE(v_query,''))>200 OR char_length(COALESCE(v_category,''))>100 OR char_length(COALESCE(v_topic,''))>100
    OR (v_status IS NOT NULL AND v_status NOT IN ('draft','published','archived'))
    OR (NULLIF(btrim(p_filters->>'university'),'') IS NOT NULL AND v_university IS NULL)
    OR (v_difficulty IS NOT NULL AND v_difficulty NOT IN ('foundation','intermediate','advanced')) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_admin_station_filters';
  END IF;
  RETURN (WITH filtered AS (
    SELECT station.* FROM public.mmi_stations AS station
    WHERE (v_status IS NULL OR station.status=v_status) AND (v_university IS NULL OR v_university=ANY(COALESCE(station.uni_tags,'{}'::text[])))
      AND (v_category IS NULL OR station.category ILIKE '%'||v_category||'%') AND (v_topic IS NULL OR station.topic ILIKE '%'||v_topic||'%')
      AND (v_difficulty IS NULL OR station.difficulty::text=v_difficulty)
      AND (v_query IS NULL OR station.station_id ILIKE '%'||v_query||'%' OR station.category ILIKE '%'||v_query||'%' OR station.topic ILIKE '%'||v_query||'%')
  ) SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object('stationId',page.station_id,'category',page.category,'topic',page.topic,'difficulty',page.difficulty::text,'universityTags',to_jsonb(COALESCE(page.uni_tags,'{}'::text[])),'prepTimeSec',page.prep_time_sec,'status',page.status,'contentVersion',page.content_version,'questionCount',(SELECT count(*) FROM public.mmi_sub_questions q WHERE q.station_id=page.station_id),'criterionCount',(SELECT count(*) FROM public.mmi_marking_criteria c JOIN public.mmi_sub_questions q ON q.sub_q_id=c.sub_q_id WHERE q.station_id=page.station_id),'isComplete',public.is_complete_published_mmi_station(page.station_id),'updatedAt',page.updated_at) ORDER BY page.updated_at DESC,page.station_id) FROM (SELECT * FROM filtered ORDER BY updated_at DESC,station_id LIMIT v_limit OFFSET v_offset) AS page),'[]'::jsonb),'total',(SELECT count(*) FROM filtered)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mutate_admin_mmi_key_from_edge(p_admin_user_id uuid, p_action text, p_api_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_is_admin boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='service_role_required'; END IF;
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id=p_admin_user_id;
  IF COALESCE(v_is_admin,false) IS NOT TRUE OR p_action NOT IN ('ai_key_replaced','ai_key_cleared')
    OR (p_action='ai_key_replaced' AND (p_api_key IS NULL OR char_length(btrim(p_api_key)) NOT BETWEEN 1 AND 1000))
    OR (p_action='ai_key_cleared' AND p_api_key IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_admin_key_mutation';
  END IF;
  INSERT INTO public.app_config(key,value,updated_at) VALUES ('ai_api_key',CASE WHEN p_action='ai_key_cleared' THEN NULL ELSE btrim(p_api_key) END,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at;
  INSERT INTO public.mmi_admin_change_audit(admin_user_id,action,target_type,target_id,metadata)
  VALUES (p_admin_user_id,p_action,'ai_config','ai_api_key',jsonb_build_object('configured',p_action='ai_key_replaced'));
  RETURN jsonb_build_object('configured',p_action='ai_key_replaced');
END;
$function$;

REVOKE ALL ON FUNCTION public.list_admin_mmi_stations_v2(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mutate_admin_mmi_key_from_edge(uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_admin_mmi_stations_v2(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_admin_mmi_key_from_edge(uuid,text,text) TO service_role;

COMMIT;
