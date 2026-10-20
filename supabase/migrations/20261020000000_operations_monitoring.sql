-- Aggregate-only operations monitoring. Apply this exact migration after a
-- reviewed hosted preflight; the repository's older migration history diverges.
-- Runtime counters retain seven full UTC days plus the current day (up to eight
-- days while the daily UTC cleanup is healthy). No message, URL or metadata is
-- accepted or stored. Existing transcript-purge functions/jobs are unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $prerequisites$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(required.table_name || '.' || required.column_name, ', ')
  INTO v_missing
  FROM (VALUES
    ('profiles','id'), ('profiles','is_admin'), ('profiles','created_at'),
    ('app_config','key'), ('app_config','value'),
    ('candidate_mmi_station_sessions','id'), ('candidate_mmi_station_sessions','user_id'),
    ('candidate_mmi_station_sessions','started_at'), ('candidate_mmi_station_sessions','abandoned_at'),
    ('candidate_mmi_station_responses','id'), ('candidate_mmi_station_responses','session_id'),
    ('candidate_mmi_station_responses','prompt_order'), ('candidate_mmi_station_responses','finalized_at'),
    ('candidate_mmi_station_responses','scoring_status'), ('candidate_mmi_station_responses','finalized_transcript'),
    ('candidate_mmi_station_response_drafts','accepted_at'),
    ('candidate_mmi_response_scoring_claims','response_id'), ('candidate_mmi_response_scoring_claims','lease_expires_at'),
    ('mmi_ai_usage_events','user_id'), ('mmi_ai_usage_events','created_at'),
    ('mmi_ai_usage_events','outcome'), ('mmi_ai_usage_events','estimated_cost'), ('mmi_ai_usage_events','latency_ms'),
    ('cofounder_feedback','user_id'), ('cofounder_feedback','created_at'),
    ('mmi_retention_job_health','singleton'), ('mmi_retention_job_health','last_completed_at')
  ) AS required(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute attribute
    WHERE attribute.attrelid = to_regclass('public.' || required.table_name)
      AND attribute.attname = required.column_name AND NOT attribute.attisdropped
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Operations prerequisites missing: %', v_missing;
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL
    OR to_regprocedure('public.require_mmi_admin()') IS NULL
    OR to_regclass('cron.job') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Operations requires Auth, the existing admin boundary, and pg_cron';
  END IF;
  IF COALESCE(current_setting('cron.timezone', true), 'GMT') NOT IN ('GMT','UTC','Etc/UTC','Etc/GMT') THEN
    RAISE EXCEPTION 'Runtime-counter daily retention requires a UTC pg_cron timezone';
  END IF;
  IF to_regclass('public.app_runtime_hourly_counters') IS NOT NULL
    OR to_regprocedure('public.record_app_runtime_event(text,text)') IS NOT NULL
    OR to_regprocedure('public.get_mmi_operations_dashboard(boolean)') IS NOT NULL
    OR to_regprocedure('public.purge_app_runtime_counters_internal()') IS NOT NULL THEN
    RAISE EXCEPTION 'Operations objects already exist; review the target rather than replacing them';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mmi-purge-runtime-counters') THEN
    RAISE EXCEPTION 'Runtime-counter cleanup job already exists';
  END IF;
END;
$prerequisites$;

CREATE TABLE public.app_runtime_hourly_counters (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket_start timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('runtime_error','unhandled_rejection','render_error')),
  area text NOT NULL CHECK (area IN ('login','account_link','onboarding','practice','feedback','progress','profile','admin','other')),
  event_count integer NOT NULL CHECK (event_count BETWEEN 1 AND 100),
  last_recorded_at timestamptz NOT NULL,
  PRIMARY KEY (user_id,bucket_start,kind,area),
  CHECK (bucket_start = (date_trunc('hour', bucket_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')),
  CHECK (last_recorded_at >= bucket_start AND last_recorded_at < bucket_start + interval '1 hour')
);
ALTER TABLE public.app_runtime_hourly_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_runtime_hourly_counters FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX app_runtime_hourly_counters_bucket_idx
  ON public.app_runtime_hourly_counters (bucket_start);
CREATE INDEX mmi_operations_sessions_started_idx
  ON public.candidate_mmi_station_sessions (started_at,user_id);
CREATE INDEX mmi_operations_usage_created_idx
  ON public.mmi_ai_usage_events (created_at,user_id);
CREATE INDEX mmi_operations_responses_status_idx
  ON public.candidate_mmi_station_responses (scoring_status,session_id);

CREATE FUNCTION public.record_app_runtime_event(p_kind text,p_area text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_bucket timestamptz := date_trunc('hour',v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_user_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authenticated account required';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('runtime_error','unhandled_rejection','render_error')
    OR p_area IS NULL OR p_area NOT IN ('login','account_link','onboarding','practice','feedback','progress','profile','admin','other') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_runtime_event';
  END IF;
  -- One lock covers all 27 permitted keys for this user/hour. Epoch seconds
  -- keep the lock identity independent of the caller's session timezone.
  PERFORM pg_advisory_xact_lock(hashtextextended('mmi-runtime:' || v_user_id::text || ':' || extract(epoch FROM v_bucket)::bigint::text,0));
  SELECT COALESCE(sum(event_count),0)::integer INTO v_count
  FROM public.app_runtime_hourly_counters WHERE user_id=v_user_id AND bucket_start=v_bucket;
  IF v_count >= 100 THEN RETURN; END IF;
  INSERT INTO public.app_runtime_hourly_counters(user_id,bucket_start,kind,area,event_count,last_recorded_at)
  VALUES(v_user_id,v_bucket,p_kind,p_area,1,v_now)
  ON CONFLICT(user_id,bucket_start,kind,area) DO UPDATE
  SET event_count=public.app_runtime_hourly_counters.event_count+1,
      last_recorded_at=GREATEST(public.app_runtime_hourly_counters.last_recorded_at,EXCLUDED.last_recorded_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_app_runtime_event(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_app_runtime_event(text,text) TO authenticated;

CREATE FUNCTION public.get_mmi_operations_dashboard(p_testers_only boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_start_date date := (v_now AT TIME ZONE 'UTC')::date - 6;
  v_start timestamptz := v_start_date::timestamp AT TIME ZONE 'UTC';
  v_result jsonb;
  v_is_configured boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    PERFORM public.require_mmi_admin();
  END IF;
  IF p_testers_only IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_operations_cohort';
  END IF;
  -- Mirror the default scoring entrypoint's missing/empty provider and model
  -- fallbacks and exact NUMERIC(14,6) rate admission. This confirms settings,
  -- never credentials, model availability, DNS, or a successful paid AI call.
  WITH config AS MATERIALIZED (
    SELECT key,value FROM public.app_config WHERE key IN (
      'ai_api_key','ai_provider','ai_model','ai_input_rate_per_million',
      'ai_cached_input_rate_per_million','ai_output_rate_per_million'
    )
  )
  SELECT COALESCE((SELECT NULLIF(btrim(value),'') IS NOT NULL FROM config WHERE key='ai_api_key'),false)
    AND COALESCE((SELECT NULLIF(value,'') FROM config WHERE key='ai_provider'),'anthropic') IN ('anthropic','openai','openai_compatible')
    AND btrim(COALESCE((SELECT NULLIF(value,'') FROM config WHERE key='ai_model'),'claude-3-5-haiku-20241022'))<>''
    AND (SELECT count(*)=3 AND COALESCE(bool_and(CASE
      WHEN value ~ '^(0|[1-9][0-9]{0,7})([.][0-9]{1,6})?$'
      THEN value::numeric BETWEEN 0 AND 99999999.999999 ELSE false END),false)
      FROM config WHERE key IN ('ai_input_rate_per_million','ai_cached_input_rate_per_million','ai_output_rate_per_million'))
  INTO v_is_configured;
  WITH cohort_profiles AS MATERIALIZED (
    SELECT id,created_at FROM public.profiles WHERE NOT p_testers_only OR is_admin IS NOT TRUE
  ), sessions AS MATERIALIZED (
    SELECT session.id,session.user_id,session.started_at,session.abandoned_at
    FROM public.candidate_mmi_station_sessions session JOIN cohort_profiles profile ON profile.id=session.user_id
  ), responses AS MATERIALIZED (
    SELECT response.id,response.session_id,response.prompt_order,response.finalized_at,response.scoring_status
    FROM public.candidate_mmi_station_responses response JOIN sessions session ON session.id=response.session_id
  ), finished AS MATERIALIZED (
    -- Five distinct ordered, finalized responses, including normal no_response,
    -- are evidence of completion; the 11-minute clock alone is not.
    SELECT session_id,max(finalized_at) AS finished_at FROM responses
    WHERE finalized_at <= v_now AND prompt_order BETWEEN 1 AND 5
    GROUP BY session_id HAVING count(DISTINCT prompt_order)=5
  ), usage AS MATERIALIZED (
    SELECT event.created_at,event.outcome,event.estimated_cost,event.latency_ms
    FROM public.mmi_ai_usage_events event JOIN cohort_profiles profile ON profile.id=event.user_id
    WHERE event.created_at >= v_start AND event.created_at <= v_now
  ), runtime AS MATERIALIZED (
    SELECT counter.* FROM public.app_runtime_hourly_counters counter
    JOIN cohort_profiles profile ON profile.id=counter.user_id
    WHERE counter.bucket_start >= v_start AND counter.bucket_start <= v_now
  ), capped AS (
    SELECT user_id FROM runtime GROUP BY user_id,bucket_start HAVING sum(event_count)>=100
  ), days AS (
    SELECT v_start_date+offset_ AS day FROM generate_series(0,6) offset_
  )
  SELECT jsonb_build_object(
    'checkedAt',v_now,'periodStart',v_start,'periodEnd',v_now,
    'cohort',CASE WHEN p_testers_only THEN 'testers' ELSE 'all' END,
    'activity',jsonb_build_object(
      'accountsCreated',(SELECT count(*) FROM cohort_profiles WHERE created_at>=v_start AND created_at<=v_now),
      'practisingUsers',(SELECT count(DISTINCT user_id) FROM sessions WHERE started_at>=v_start AND started_at<=v_now),
      'stationsStarted',(SELECT count(*) FROM sessions WHERE started_at>=v_start AND started_at<=v_now),
      'stationsFinished',(SELECT count(*) FROM finished WHERE finished_at>=v_start AND finished_at<=v_now),
      'stationsAbandoned',(SELECT count(*) FROM sessions WHERE abandoned_at>=v_start AND abandoned_at<=v_now),
      'reportsSubmitted',(SELECT count(*) FROM public.cofounder_feedback report
        WHERE report.created_at>=v_start AND report.created_at<=v_now
          AND (NOT p_testers_only OR EXISTS(SELECT 1 FROM cohort_profiles profile WHERE profile.id=report.user_id)))
    ),
    'scoring',jsonb_build_object(
      'isConfigured',v_is_configured,
      'pendingResponses',(SELECT count(*) FROM responses WHERE scoring_status IN ('pending','in_progress')),
      'failedResponses',(SELECT count(*) FROM responses WHERE scoring_status='failed'),
      'expiredResponses',(SELECT count(*) FROM responses WHERE scoring_status='feedback_unavailable'),
      'stalledClaims',(SELECT count(*) FROM public.candidate_mmi_response_scoring_claims claim
        JOIN responses response ON response.id=claim.response_id
        WHERE response.scoring_status='in_progress' AND claim.lease_expires_at < v_now-interval '2 minutes'),
      'providerCalls',(SELECT count(*) FROM usage),
      'providerFailures',(SELECT count(*) FROM usage WHERE outcome='provider_failed'),
      'invalidResponses',(SELECT count(*) FROM usage WHERE outcome='invalid_response'),
      'persistenceFailures',(SELECT count(*) FROM usage WHERE outcome='persistence_failed'),
      'recentCalls',(SELECT count(*) FROM usage WHERE created_at>=v_now-interval '15 minutes'),
      'recentFailures',(SELECT count(*) FROM usage WHERE created_at>=v_now-interval '15 minutes' AND outcome<>'scored'),
      'knownCostUsd',(SELECT to_char(COALESCE(sum(estimated_cost),0),'FM999999999999999999990.00000000') FROM usage),
      'unknownCostCalls',(SELECT count(*) FROM usage WHERE estimated_cost IS NULL),
      'averageLatencyMs',(SELECT round(avg(latency_ms),2) FROM usage),
      'p95LatencyMs',(SELECT round((percentile_cont(0.95) WITHIN GROUP(ORDER BY latency_ms))::numeric,2) FROM usage)
    ),
    'runtime',jsonb_build_object(
      'recordedErrors',(SELECT COALESCE(sum(event_count),0) FROM runtime),
      'affectedAccounts',(SELECT count(DISTINCT user_id) FROM runtime),
      'limitedAccounts',(SELECT count(DISTINCT user_id) FROM capped),
      'recentAffectedAccounts',(SELECT count(DISTINCT user_id) FROM runtime WHERE last_recorded_at>=v_now-interval '15 minutes'),
      'byKind',(SELECT jsonb_agg(jsonb_build_object('kind',kind_,'count',(SELECT COALESCE(sum(event_count),0) FROM runtime WHERE kind=kind_)) ORDER BY ordinal_)
        FROM unnest(ARRAY['runtime_error','unhandled_rejection','render_error']) WITH ORDINALITY kinds(kind_,ordinal_)),
      'byArea',(SELECT jsonb_agg(jsonb_build_object('area',area_,'count',(SELECT COALESCE(sum(event_count),0) FROM runtime WHERE area=area_)) ORDER BY ordinal_)
        FROM unnest(ARRAY['login','account_link','onboarding','practice','feedback','progress','profile','admin','other']) WITH ORDINALITY areas(area_,ordinal_))
    ),
    'retention',jsonb_build_object(
      'jobActive',EXISTS(SELECT 1 FROM cron.job WHERE jobname='candidate-mmi-purge-expired-free-text' AND active),
      'lastCompletedAt',(SELECT last_completed_at FROM public.mmi_retention_job_health WHERE singleton),
      'heartbeatAgeSeconds',(SELECT GREATEST(0,floor(extract(epoch FROM v_now-last_completed_at)))::bigint FROM public.mmi_retention_job_health WHERE singleton AND last_completed_at IS NOT NULL),
      -- Match the existing purge's 23h30m boundary, including drafts. These
      -- global safety counts intentionally ignore the selected user cohort.
      'overdueResponses',(SELECT count(*) FROM public.candidate_mmi_station_responses WHERE finalized_transcript IS NOT NULL AND finalized_at<=v_now-interval '23 hours 30 minutes'),
      'overdueDrafts',(SELECT count(*) FROM public.candidate_mmi_station_response_drafts WHERE accepted_at<=v_now-interval '23 hours 30 minutes')
    ),
    'daily',(SELECT jsonb_agg(jsonb_build_object(
      'date',to_char(day,'YYYY-MM-DD'),
      'practisingUsers',(SELECT count(DISTINCT user_id) FROM sessions WHERE (started_at AT TIME ZONE 'UTC')::date=day AND started_at<=v_now),
      'stationsStarted',(SELECT count(*) FROM sessions WHERE (started_at AT TIME ZONE 'UTC')::date=day AND started_at<=v_now),
      'stationsFinished',(SELECT count(*) FROM finished WHERE (finished_at AT TIME ZONE 'UTC')::date=day AND finished_at<=v_now),
      'providerCalls',(SELECT count(*) FROM usage WHERE (created_at AT TIME ZONE 'UTC')::date=day),
      'providerFailures',(SELECT count(*) FROM usage WHERE (created_at AT TIME ZONE 'UTC')::date=day AND outcome='provider_failed'),
      'knownCostUsd',(SELECT to_char(COALESCE(sum(estimated_cost),0),'FM999999999999999999990.00000000') FROM usage WHERE (created_at AT TIME ZONE 'UTC')::date=day),
      'unknownCostCalls',(SELECT count(*) FROM usage WHERE (created_at AT TIME ZONE 'UTC')::date=day AND estimated_cost IS NULL),
      'runtimeErrors',(SELECT COALESCE(sum(event_count),0) FROM runtime WHERE (bucket_start AT TIME ZONE 'UTC')::date=day)
    ) ORDER BY day) FROM days)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_mmi_operations_dashboard(boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_mmi_operations_dashboard(boolean) TO authenticated, service_role;

CREATE FUNCTION public.purge_app_runtime_counters_internal()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.app_runtime_hourly_counters
  WHERE bucket_start < (((clock_timestamp() AT TIME ZONE 'UTC')::date-7)::timestamp AT TIME ZONE 'UTC');
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_app_runtime_counters_internal() FROM PUBLIC, anon, authenticated, service_role;
SELECT cron.schedule('mmi-purge-runtime-counters','0 0 * * *','SELECT public.purge_app_runtime_counters_internal();');

DO $postconditions$
DECLARE v_role text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.app_runtime_hourly_counters'::regclass) THEN
    RAISE EXCEPTION 'Runtime-counter RLS is required';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
    IF has_table_privilege(v_role,'public.app_runtime_hourly_counters','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_function_privilege(v_role,'public.purge_app_runtime_counters_internal()','EXECUTE') THEN
      RAISE EXCEPTION 'Runtime-counter private boundary failed for %',v_role;
    END IF;
  END LOOP;
  IF has_function_privilege('public','public.record_app_runtime_event(text,text)','EXECUTE')
    OR has_function_privilege('anon','public.record_app_runtime_event(text,text)','EXECUTE')
    OR has_function_privilege('service_role','public.record_app_runtime_event(text,text)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.record_app_runtime_event(text,text)','EXECUTE')
    OR has_function_privilege('public','public.get_mmi_operations_dashboard(boolean)','EXECUTE')
    OR has_function_privilege('anon','public.get_mmi_operations_dashboard(boolean)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.get_mmi_operations_dashboard(boolean)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.get_mmi_operations_dashboard(boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Operations function grants failed';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='mmi-purge-runtime-counters' AND active
      AND schedule='0 0 * * *' AND command='SELECT public.purge_app_runtime_counters_internal();') <> 1 THEN
    RAISE EXCEPTION 'Runtime-counter cleanup schedule failed';
  END IF;
END;
$postconditions$;
COMMIT;
