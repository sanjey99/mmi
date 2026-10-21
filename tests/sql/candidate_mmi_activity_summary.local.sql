-- Run only through scripts/test-candidate-mmi-activity-sql.mjs. It creates a
-- fresh marked database on a private Unix socket, with TCP disabled.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database()<>'mmi_candidate_activity_proof' OR inet_server_addr() IS NOT NULL OR inet_client_addr() IS NOT NULL
    OR current_setting('app.mmi_candidate_activity_proof',true) IS DISTINCT FROM 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA'
    OR to_regclass('public.profiles') IS NOT NULL THEN RAISE EXCEPTION 'Refusing unmarked/non-fresh/non-local activity proof'; END IF;
END; $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.candidate_mmi_station_sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,started_at timestamptz NOT NULL,abandoned_at timestamptz);
CREATE TABLE public.candidate_mmi_station_responses(id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES public.candidate_mmi_station_sessions ON DELETE CASCADE,prompt_order smallint NOT NULL CHECK(prompt_order BETWEEN 1 AND 5),finalized_at timestamptz NOT NULL,response_state text NOT NULL CHECK(response_state IN('response','no_response')),scoring_status text NOT NULL,finalized_transcript text,UNIQUE(session_id,prompt_order));
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_station_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_station_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.profiles SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,6) n;
CREATE FUNCTION pg_temp.seed_station(p_user integer,p_number integer,p_completed timestamptz,p_count integer DEFAULT 5,p_abandoned boolean DEFAULT false,p_status text DEFAULT 'pending') RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  session_ uuid:=('10000000-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid;
  status_ text;
BEGIN
  INSERT INTO public.candidate_mmi_station_sessions VALUES(session_,('00000000-0000-4000-8000-'||lpad(p_user::text,12,'0'))::uuid,p_completed-interval '90 days',CASE WHEN p_abandoned THEN p_completed ELSE NULL END);
  FOR n IN 1..p_count LOOP
    status_:=CASE WHEN p_status='mixed' THEN (ARRAY['pending','failed','no_response','feedback_unavailable','in_progress'])[n] ELSE p_status END;
    INSERT INTO public.candidate_mmi_station_responses VALUES(('20000000-0000-4000-8000-'||lpad((p_number*10+n)::text,12,'0'))::uuid,session_,n,p_completed-(5-n)*interval '1 second',CASE WHEN status_='no_response' THEN 'no_response' ELSE 'response' END,status_,CASE WHEN status_='no_response' THEN NULL ELSE 'PRIVATE_SYNTHETIC_ANSWER' END);
  END LOOP;
END; $$;
DO $$ DECLARE today_ timestamptz:=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'; BEGIN
  -- First account: two finishes today, a current three-day run, a gap, and an
  -- older five-day run. Session starts are deliberately 90 days earlier.
  PERFORM pg_temp.seed_station(1,1,today_+interval '1 microsecond',5,false,'mixed');
  PERFORM pg_temp.seed_station(1,2,today_+interval '2 microseconds',5,false,'no_response');
  PERFORM pg_temp.seed_station(1,3,today_-interval '12 hours');
  PERFORM pg_temp.seed_station(1,4,today_-interval '36 hours');
  PERFORM pg_temp.seed_station(1,5,today_-interval '84 hours');
  FOR n IN 20..24 LOOP PERFORM pg_temp.seed_station(1,100+n,today_-n*interval '1 day'+interval '12 hours'); END LOOP;
  -- Neither abandoned, not-yet-five, nor future finalizations are completed.
  PERFORM pg_temp.seed_station(1,6,today_+interval '1 microsecond',5,true);
  PERFORM pg_temp.seed_station(1,7,today_+interval '1 microsecond',4);
  PERFORM pg_temp.seed_station(1,8,today_+interval '1 day');
  PERFORM pg_temp.seed_station(2,9,today_-interval '12 hours');
  PERFORM pg_temp.seed_station(2,10,today_-interval '36 hours');
  PERFORM pg_temp.seed_station(3,11,today_-interval '36 hours');
  -- More than the history API's largest page; no summary can be capped at100.
  FOR n IN 0..129 LOOP PERFORM pg_temp.seed_station(5,1000+n,today_-n*interval '1 day'+interval '1 microsecond'); END LOOP;
  PERFORM pg_temp.seed_station(6,12,today_+interval '1 microsecond',5,false,'failed');
END; $$;
\ir ../../supabase/migrations/20261021000000_candidate_mmi_activity_summary.sql
DO $$ DECLARE config_ text[]; BEGIN
  SELECT proconfig INTO config_ FROM pg_proc WHERE oid='public.get_candidate_mmi_activity_summary()'::regprocedure;
  ASSERT (SELECT prosecdef AND pronargs=0 AND pg_get_userbyid(proowner)='postgres' FROM pg_proc WHERE oid='public.get_candidate_mmi_activity_summary()'::regprocedure);
  ASSERT config_ @> ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC'];
  ASSERT NOT has_function_privilege('anon','public.get_candidate_mmi_activity_summary()','EXECUTE');
  ASSERT NOT has_function_privilege('service_role','public.get_candidate_mmi_activity_summary()','EXECUTE');
  ASSERT NOT has_function_privilege('public','public.get_candidate_mmi_activity_summary()','EXECUTE');
  ASSERT has_function_privilege('authenticated','public.get_candidate_mmi_activity_summary()','EXECUTE');
END; $$;
SET ROLE authenticated;
SET request.jwt.claim.role='authenticated';
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
DO $$ DECLARE value_ jsonb; latest_ timestamptz; BEGIN
  value_:=public.get_candidate_mmi_activity_summary();
  ASSERT (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(value_) key)=ARRAY['completedToday','completedTotal','latestCompletedAt','streakCurrent','streakLongest'];
  ASSERT value_->>'completedToday'='2' AND value_->>'completedTotal'='10' AND value_->>'streakCurrent'='3' AND value_->>'streakLongest'='5';
  latest_:=(value_->>'latestCompletedAt')::timestamptz;
  ASSERT latest_=((clock_timestamp() AT TIME ZONE 'UTC')::date::timestamp AT TIME ZONE 'UTC')+interval '2 microseconds';
  ASSERT value_::text !~ 'PRIVATE|10000000|20000000|user|transcript|scoring';
  BEGIN PERFORM * FROM public.candidate_mmi_station_sessions; RAISE EXCEPTION 'private sessions readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.candidate_mmi_station_responses; RAISE EXCEPTION 'private responses readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
-- Caller timezone and search path cannot move completion into another day.
SET TIME ZONE 'America/Los_Angeles';
SET search_path=pg_temp;
DO $$ DECLARE value_ jsonb; BEGIN
  value_:=public.get_candidate_mmi_activity_summary();
  ASSERT value_->>'completedToday'='2' AND value_->>'streakCurrent'='3';
  ASSERT right(value_->>'latestCompletedAt',6)='+00:00';
END; $$;
SET TIME ZONE 'Pacific/Kiritimati';
DO $$ BEGIN ASSERT public.get_candidate_mmi_activity_summary()->>'completedToday'='2'; END; $$;
SET search_path=public;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
DO $$ DECLARE value_ jsonb; BEGIN value_:=public.get_candidate_mmi_activity_summary(); ASSERT value_->>'completedToday'='0' AND value_->>'completedTotal'='2' AND value_->>'streakCurrent'='2' AND value_->>'streakLongest'='2'; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
DO $$ DECLARE value_ jsonb; BEGIN value_:=public.get_candidate_mmi_activity_summary(); ASSERT value_->>'completedToday'='0' AND value_->>'completedTotal'='1' AND value_->>'streakCurrent'='0' AND value_->>'streakLongest'='1'; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';
DO $$ BEGIN ASSERT public.get_candidate_mmi_activity_summary()='{"completedToday":0,"completedTotal":0,"streakCurrent":0,"streakLongest":0,"latestCompletedAt":null}'::jsonb; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000005';
DO $$ DECLARE value_ jsonb; BEGIN value_:=public.get_candidate_mmi_activity_summary(); ASSERT value_->>'completedToday'='1' AND value_->>'completedTotal'='130' AND value_->>'streakCurrent'='130' AND value_->>'streakLongest'='130'; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000006';
DO $$ BEGIN ASSERT public.get_candidate_mmi_activity_summary()->>'completedTotal'='1'; END; $$;
SET request.jwt.claim.sub='';
DO $$ BEGIN BEGIN PERFORM public.get_candidate_mmi_activity_summary(); RAISE EXCEPTION 'missing identity accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';
DO $$ BEGIN BEGIN PERFORM public.get_candidate_mmi_activity_summary(); RAISE EXCEPTION 'missing profile accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SET request.jwt.claim.role='service_role';
DO $$ BEGIN BEGIN PERFORM public.get_candidate_mmi_activity_summary(); RAISE EXCEPTION 'wrong JWT role accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.get_candidate_mmi_activity_summary(); RAISE EXCEPTION 'anon execute accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
RESET ROLE;
SET ROLE service_role;
SET request.jwt.claim.role='authenticated';
DO $$ BEGIN BEGIN PERFORM public.get_candidate_mmi_activity_summary(); RAISE EXCEPTION 'service role execute accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
RESET ROLE;
-- A provider-status transition or transcript purge cannot alter activity.
UPDATE public.candidate_mmi_station_responses SET scoring_status='scored',finalized_transcript=NULL;
SET ROLE authenticated;
SET request.jwt.claim.role='authenticated';
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
DO $$ BEGIN ASSERT public.get_candidate_mmi_activity_summary()->>'completedTotal'='10'; END; $$;
RESET ROLE;
-- Account deletion removes only its own activity; no copied counter survives.
DELETE FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000002';
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000005';
DO $$ BEGIN ASSERT public.get_candidate_mmi_activity_summary()->>'completedTotal'='130'; END; $$;
RESET ROLE;
SELECT 'Candidate MMI activity summary SQL proof passed';
