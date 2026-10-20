-- Run ONLY in a fresh disposable PostgreSQL cluster, over its private Unix
-- socket, in database mmi_operations_monitoring_proof. The database must have
-- app.mmi_operations_proof=I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA set by its creator.
-- This fixture models the reviewed hosted columns and cron catalog/API; it does
-- not reset/apply the diverged baseline or exercise pg_cron's actual scheduler.
\set ON_ERROR_STOP on
DO $safety$
BEGIN
  IF current_database()<>'mmi_operations_monitoring_proof'
    OR inet_server_addr() IS NOT NULL OR inet_client_addr() IS NOT NULL
    OR current_setting('app.mmi_operations_proof',true) IS DISTINCT FROM 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA'
    OR to_regclass('public.profiles') IS NOT NULL OR to_regnamespace('auth') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing operations proof: a fresh marked disposable Unix-socket database is required';
  END IF;
END;
$safety$;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA cron;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,is_admin boolean,created_at timestamptz NOT NULL);
CREATE TABLE public.app_config(key text PRIMARY KEY,value text);
CREATE FUNCTION public.require_mmi_admin() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_admin IS TRUE) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='admin access required';
  END IF;
  RETURN auth.uid();
END; $$;
CREATE TABLE public.candidate_mmi_station_sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES public.profiles,started_at timestamptz NOT NULL,abandoned_at timestamptz);
CREATE TABLE public.candidate_mmi_station_responses(id uuid PRIMARY KEY,session_id uuid REFERENCES public.candidate_mmi_station_sessions,prompt_order smallint CHECK(prompt_order BETWEEN 1 AND 5),finalized_at timestamptz NOT NULL,scoring_status text NOT NULL,finalized_transcript text,UNIQUE(session_id,prompt_order));
CREATE TABLE public.candidate_mmi_station_response_drafts(accepted_at timestamptz NOT NULL);
CREATE TABLE public.candidate_mmi_response_scoring_claims(response_id uuid PRIMARY KEY REFERENCES public.candidate_mmi_station_responses,lease_expires_at timestamptz NOT NULL);
CREATE TABLE public.mmi_ai_usage_events(user_id uuid REFERENCES public.profiles,created_at timestamptz NOT NULL,outcome text NOT NULL,estimated_cost numeric(16,8),latency_ms integer NOT NULL);
CREATE TABLE public.cofounder_feedback(user_id uuid REFERENCES public.profiles,created_at timestamptz NOT NULL);
CREATE TABLE public.mmi_retention_job_health(singleton boolean PRIMARY KEY,last_completed_at timestamptz);
CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid $$;
INSERT INTO cron.job(jobname,schedule,command) VALUES('candidate-mmi-purge-expired-free-text','*/5 * * * *','SELECT public.purge_expired_candidate_mmi_free_text_internal();');
REVOKE ALL ON ALL TABLES IN SCHEMA public,cron FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.profiles VALUES
 ('00000000-0000-4000-8000-000000000001',false,clock_timestamp()-interval '1 hour'),
 ('00000000-0000-4000-8000-000000000002',false,clock_timestamp()-interval '1 hour'),
 ('00000000-0000-4000-8000-000000000003',true,clock_timestamp()-interval '1 hour'),
 ('00000000-0000-4000-8000-000000000004',false,clock_timestamp()-interval '1 hour');

\ir ../../supabase/migrations/20261020000000_operations_monitoring.sql

-- Empty/no-call result and the narrow service-role access path.
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
DO $$ DECLARE dashboard jsonb; BEGIN
  dashboard:=public.get_mmi_operations_dashboard();
  ASSERT dashboard->'scoring'->'averageLatencyMs'='null'::jsonb;
  ASSERT dashboard->'scoring'->'isConfigured'='false'::jsonb;
  ASSERT dashboard->'scoring'->'p95LatencyMs'='null'::jsonb;
  ASSERT jsonb_array_length(dashboard->'daily')=7;
  ASSERT jsonb_array_length(dashboard->'runtime'->'byKind')=3;
  ASSERT jsonb_array_length(dashboard->'runtime'->'byArea')=9;
  ASSERT dashboard->'retention'->'heartbeatAgeSeconds'='null'::jsonb;
  BEGIN PERFORM public.record_app_runtime_event('runtime_error','practice'); RAISE EXCEPTION 'service_role unexpectedly recorded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM count(*) FROM public.app_runtime_hourly_counters; RAISE EXCEPTION 'service_role read counters'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
-- Configuration boolean never exposes keys/rates, and needs all three rates.
INSERT INTO public.app_config VALUES('ai_api_key','synthetic key never returned'),('ai_input_rate_per_million','0'),('ai_cached_input_rate_per_million','1.123456'),('ai_output_rate_per_million','99999999.999999');
SET request.jwt.claim.role='service_role';
DO $$ BEGIN
  ASSERT (public.get_mmi_operations_dashboard()->'scoring'->>'isConfigured')::boolean;
END; $$;
INSERT INTO public.app_config VALUES('ai_provider','unsupported');
DO $$ BEGIN ASSERT NOT (public.get_mmi_operations_dashboard()->'scoring'->>'isConfigured')::boolean; END; $$;
UPDATE public.app_config SET value='openai' WHERE key='ai_provider';
INSERT INTO public.app_config VALUES('ai_model','  ');
DO $$ BEGIN ASSERT NOT (public.get_mmi_operations_dashboard()->'scoring'->>'isConfigured')::boolean; END; $$;
UPDATE public.app_config SET value='' WHERE key='ai_model';
DO $$ DECLARE invalid_ text; BEGIN
  ASSERT (public.get_mmi_operations_dashboard()->'scoring'->>'isConfigured')::boolean;
  FOREACH invalid_ IN ARRAY ARRAY['-1','1e2','100000000','0.1234567','01','NaN','1 ',''] LOOP
    UPDATE public.app_config SET value=invalid_ WHERE key='ai_input_rate_per_million';
    ASSERT NOT (public.get_mmi_operations_dashboard()->'scoring'->>'isConfigured')::boolean;
  END LOOP;
END; $$;
UPDATE public.app_config SET value='0' WHERE key='ai_input_rate_per_million';
UPDATE public.app_config SET value='  ' WHERE key='ai_api_key';
DO $$ BEGIN ASSERT NOT (public.get_mmi_operations_dashboard()->'scoring'->>'isConfigured')::boolean; END; $$;
UPDATE public.app_config SET value='synthetic key never returned' WHERE key='ai_api_key';
SET ROLE anon;
SET request.jwt.claim.role='anon';
DO $$ BEGIN
  BEGIN PERFORM public.record_app_runtime_event('runtime_error','practice'); RAISE EXCEPTION 'anon unexpectedly recorded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_mmi_operations_dashboard(); RAISE EXCEPTION 'anon unexpectedly read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.role='authenticated';
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
DO $$ DECLARE kind_ text; area_ text; n integer; BEGIN
  BEGIN PERFORM public.get_mmi_operations_dashboard(); RAISE EXCEPTION 'tester read dashboard'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM count(*) FROM public.app_runtime_hourly_counters; RAISE EXCEPTION 'tester read counters'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.purge_app_runtime_counters_internal(); RAISE EXCEPTION 'tester purged counters'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.record_app_runtime_event('private answer','practice'); RAISE EXCEPTION 'freeform kind accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.record_app_runtime_event('runtime_error','https://private.example/#token'); RAISE EXCEPTION 'freeform area accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.record_app_runtime_event(NULL,'practice'); RAISE EXCEPTION 'NULL accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  FOREACH kind_ IN ARRAY ARRAY['runtime_error','unhandled_rejection','render_error'] LOOP
    FOREACH area_ IN ARRAY ARRAY['login','account_link','onboarding','practice','feedback','progress','profile','admin','other'] LOOP
      PERFORM public.record_app_runtime_event(kind_,area_);
    END LOOP;
  END LOOP;
  FOR n IN 1..110 LOOP PERFORM public.record_app_runtime_event('runtime_error','practice'); END LOOP;
END; $$;
-- Changing timezone must not open a second cap bucket or change its lock key.
SET TIME ZONE 'Pacific/Auckland';
DO $$ BEGIN PERFORM public.record_app_runtime_event('runtime_error','practice'); END; $$;
SET TIME ZONE 'UTC';
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
DO $$ BEGIN FOR n IN 1..3 LOOP PERFORM public.record_app_runtime_event('render_error','feedback'); END LOOP; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
DO $$ BEGIN FOR n IN 1..2 LOOP PERFORM public.record_app_runtime_event('unhandled_rejection','admin'); END LOOP; END; $$;
SET request.jwt.claim.sub='';
DO $$ BEGIN
  BEGIN PERFORM public.record_app_runtime_event('runtime_error','practice'); RAISE EXCEPTION 'missing uid accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT sum(event_count) FROM public.app_runtime_hourly_counters WHERE user_id='00000000-0000-4000-8000-000000000001')=100;
  ASSERT (SELECT count(*) FROM public.app_runtime_hourly_counters WHERE user_id='00000000-0000-4000-8000-000000000001')=27;
END; $$;

-- Finished is evidenced by all five finalizations, never an elapsed session.
INSERT INTO public.candidate_mmi_station_sessions VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',clock_timestamp()-interval '30 minutes',NULL),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002',clock_timestamp()-interval '8 days',NULL),
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003',clock_timestamp()-interval '30 minutes',NULL),
 ('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour');
INSERT INTO public.candidate_mmi_station_responses
 SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001',n,clock_timestamp()-interval '5 minutes',CASE WHEN n=5 THEN 'no_response' ELSE 'scored' END,NULL FROM generate_series(1,5) n;
INSERT INTO public.candidate_mmi_station_responses
 SELECT ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000003',n,clock_timestamp()-interval '5 minutes','scored',NULL FROM generate_series(1,5) n;
INSERT INTO public.candidate_mmi_station_responses VALUES
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',1,clock_timestamp()-interval '24 hours','failed','synthetic private answer'),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',2,clock_timestamp()-interval '10 minutes','in_progress','synthetic private answer'),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',3,clock_timestamp()-interval '10 minutes','in_progress','synthetic private answer'),
 ('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002',4,clock_timestamp()-interval '10 minutes','feedback_unavailable',NULL);
INSERT INTO public.candidate_mmi_response_scoring_claims VALUES
 ('40000000-0000-4000-8000-000000000002',clock_timestamp()-interval '5 minutes'),
 ('40000000-0000-4000-8000-000000000003',clock_timestamp()-interval '1 minute');
INSERT INTO public.candidate_mmi_station_response_drafts VALUES(clock_timestamp()-interval '23 hours 31 minutes'),(clock_timestamp()-interval '23 hours 29 minutes');
INSERT INTO public.mmi_retention_job_health VALUES(true,clock_timestamp()-interval '2 minutes');
INSERT INTO public.mmi_ai_usage_events VALUES
 ('00000000-0000-4000-8000-000000000001',clock_timestamp()-interval '5 minutes','scored',0.1,100),
 ('00000000-0000-4000-8000-000000000001',clock_timestamp()-interval '5 minutes','provider_failed',NULL,200),
 ('00000000-0000-4000-8000-000000000002',clock_timestamp()-interval '5 minutes','invalid_response',0.2,300),
 ('00000000-0000-4000-8000-000000000002',clock_timestamp()-interval '5 minutes','persistence_failed',0.3,400),
 ('00000000-0000-4000-8000-000000000003',clock_timestamp()-interval '5 minutes','scored',1,1000),
 ('00000000-0000-4000-8000-000000000001',clock_timestamp()-interval '8 days','scored',99,100);
INSERT INTO public.cofounder_feedback VALUES('00000000-0000-4000-8000-000000000001',clock_timestamp()),('00000000-0000-4000-8000-000000000003',clock_timestamp());

SET ROLE authenticated;
SET request.jwt.claim.role='authenticated';
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
SET TIME ZONE 'America/Los_Angeles';
DO $$ DECLARE dashboard jsonb; all_ jsonb; day_ jsonb; previous_ date; BEGIN
  dashboard:=public.get_mmi_operations_dashboard();
  all_:=public.get_mmi_operations_dashboard(false);
  ASSERT (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(dashboard) key)=ARRAY['activity','checkedAt','cohort','daily','periodEnd','periodStart','retention','runtime','scoring'];
  ASSERT dashboard->>'cohort'='testers' AND all_->>'cohort'='all';
  ASSERT dashboard->>'periodEnd'=dashboard->>'checkedAt';
  ASSERT (dashboard->>'periodStart')::timestamptz=((clock_timestamp() AT TIME ZONE 'UTC')::date-6)::timestamp AT TIME ZONE 'UTC';
  ASSERT (dashboard->'activity'->>'stationsFinished')::integer=1;
  ASSERT (all_->'activity'->>'stationsFinished')::integer=2;
  ASSERT (dashboard->'activity'->>'reportsSubmitted')::integer=1;
  ASSERT (all_->'activity'->>'reportsSubmitted')::integer=2;
  ASSERT (dashboard->'scoring'->>'pendingResponses')::integer=2;
  ASSERT (dashboard->'scoring'->>'isConfigured')::boolean;
  ASSERT (dashboard->'scoring'->>'failedResponses')::integer=1;
  ASSERT (dashboard->'scoring'->>'expiredResponses')::integer=1;
  ASSERT (dashboard->'scoring'->>'stalledClaims')::integer=1;
  ASSERT (dashboard->'scoring'->>'providerCalls')::integer=4;
  ASSERT (dashboard->'scoring'->>'recentCalls')::integer=4;
  ASSERT (dashboard->'scoring'->>'recentFailures')::integer=3;
  ASSERT (dashboard->'scoring'->>'providerFailures')::integer=1;
  ASSERT (dashboard->'scoring'->>'invalidResponses')::integer=1;
  ASSERT (dashboard->'scoring'->>'persistenceFailures')::integer=1;
  ASSERT dashboard->'scoring'->>'knownCostUsd'='0.60000000';
  ASSERT (dashboard->'scoring'->>'unknownCostCalls')::integer=1;
  ASSERT (dashboard->'scoring'->>'averageLatencyMs')::numeric=250;
  ASSERT (dashboard->'scoring'->>'p95LatencyMs')::numeric=385;
  ASSERT (dashboard->'runtime'->>'recordedErrors')::integer=103;
  ASSERT (all_->'runtime'->>'recordedErrors')::integer=105;
  ASSERT (dashboard->'runtime'->>'affectedAccounts')::integer=2;
  ASSERT (dashboard->'runtime'->>'limitedAccounts')::integer=1;
  ASSERT (dashboard->'runtime'->>'recentAffectedAccounts')::integer=2;
  ASSERT (SELECT sum((value->>'count')::integer) FROM jsonb_array_elements(dashboard->'runtime'->'byKind'))=103;
  ASSERT (SELECT sum((value->>'count')::integer) FROM jsonb_array_elements(dashboard->'runtime'->'byArea'))=103;
  ASSERT (dashboard->'retention'->>'overdueResponses')::integer=1;
  ASSERT (dashboard->'retention'->>'overdueDrafts')::integer=1;
  ASSERT (dashboard->'retention'->>'jobActive')::boolean;
  ASSERT dashboard->'retention'=all_->'retention' OR abs((dashboard->'retention'->>'heartbeatAgeSeconds')::bigint-(all_->'retention'->>'heartbeatAgeSeconds')::bigint)<=1;
  ASSERT (dashboard->'retention'->>'heartbeatAgeSeconds')::integer BETWEEN 120 AND 125;
  ASSERT dashboard::text !~ '(synthetic private answer|synthetic key|ai_api_key|99999999|00000000-0000|10000000-0000|user_id|full_name|transcript)';
  ASSERT jsonb_array_length(dashboard->'daily')=7;
  FOR day_ IN SELECT value FROM jsonb_array_elements(dashboard->'daily') LOOP
    IF previous_ IS NOT NULL THEN ASSERT (day_->>'date')::date=previous_+1; END IF;
    previous_:=(day_->>'date')::date;
  END LOOP;
  ASSERT previous_=(clock_timestamp() AT TIME ZONE 'UTC')::date;
  ASSERT (SELECT sum((value->>'providerCalls')::integer) FROM jsonb_array_elements(dashboard->'daily'))=4;
  ASSERT (SELECT sum((value->>'runtimeErrors')::integer) FROM jsonb_array_elements(dashboard->'daily'))=103;
  BEGIN PERFORM public.get_mmi_operations_dashboard(NULL); RAISE EXCEPTION 'NULL cohort accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END; $$;
RESET ROLE;
SET TIME ZONE 'UTC';

-- Recent accounts use last accepted event time, not the containing hour alone.
UPDATE public.app_runtime_hourly_counters
SET bucket_start=date_trunc('hour',clock_timestamp()-interval '16 minutes'),
    last_recorded_at=clock_timestamp()-interval '16 minutes'
WHERE user_id='00000000-0000-4000-8000-000000000002';
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
DO $$ DECLARE dashboard jsonb; BEGIN
  dashboard:=public.get_mmi_operations_dashboard();
  ASSERT (dashboard->'runtime'->>'affectedAccounts')::integer=2;
  ASSERT (dashboard->'runtime'->>'recentAffectedAccounts')::integer=1;
  BEGIN PERFORM count(*) FROM public.mmi_retention_job_health; RAISE EXCEPTION 'retention private grants changed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
INSERT INTO public.mmi_ai_usage_events VALUES('00000000-0000-4000-8000-000000000001',clock_timestamp()-interval '30 minutes','provider_failed',NULL,500);
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
DO $$ DECLARE dashboard jsonb; BEGIN
  dashboard:=public.get_mmi_operations_dashboard();
  ASSERT (dashboard->'scoring'->>'providerCalls')::integer=5;
  ASSERT (dashboard->'scoring'->>'recentCalls')::integer=4;
  ASSERT (dashboard->'scoring'->>'recentFailures')::integer=3;
END; $$;
RESET ROLE;

-- Retain seven full UTC days + today; purge the older boundary only.
INSERT INTO public.app_runtime_hourly_counters
 SELECT '00000000-0000-4000-8000-000000000001',date_trunc('day',clock_timestamp())-n*interval '1 day','runtime_error','other',1,date_trunc('day',clock_timestamp())-n*interval '1 day' FROM generate_series(7,8) n;
DO $$ BEGIN
  ASSERT public.purge_app_runtime_counters_internal()=1;
  ASSERT EXISTS(SELECT 1 FROM public.app_runtime_hourly_counters WHERE bucket_start=date_trunc('day',clock_timestamp())-interval '7 days');
  ASSERT NOT EXISTS(SELECT 1 FROM public.app_runtime_hourly_counters WHERE bucket_start<date_trunc('day',clock_timestamp())-interval '7 days');
  ASSERT (SELECT count(*) FROM cron.job)=2;
  ASSERT EXISTS(SELECT 1 FROM cron.job WHERE jobname='candidate-mmi-purge-expired-free-text' AND schedule='*/5 * * * *' AND command='SELECT public.purge_expired_candidate_mmi_free_text_internal();' AND active);
  ASSERT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='app_runtime_hourly_counters')=6;
END; $$;
SELECT 'Operations monitoring local SQL proof passed' AS result;
