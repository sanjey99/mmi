-- Run only through scripts/test-candidate-mmi-start-limits-sql.mjs, which
-- creates a fresh marked private Unix-socket cluster with TCP disabled.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database()<>'mmi_candidate_start_limits_proof' OR inet_server_addr() IS NOT NULL OR inet_client_addr() IS NOT NULL
    OR current_setting('app.mmi_candidate_start_limits_proof',true) IS DISTINCT FROM 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA'
    OR to_regclass('public.profiles') IS NOT NULL THEN RAISE EXCEPTION 'Refusing non-fresh/unmarked/non-local start proof'; END IF;
END; $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,university_target text);
CREATE TABLE public.mmi_stations(station_id text PRIMARY KEY,uni_tags text[],published boolean NOT NULL DEFAULT true);
CREATE TABLE public.mmi_station_versions(station_id text REFERENCES public.mmi_stations,version integer,content_snapshot jsonb,PRIMARY KEY(station_id,version));
CREATE TABLE public.candidate_mmi_station_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.profiles ON DELETE CASCADE,
  station_id text REFERENCES public.mmi_stations,started_at timestamptz NOT NULL,abandoned_at timestamptz,
  practice_scope text,target_university_snapshot text,scenario_text_snapshot text,station_version_snapshot integer);
CREATE INDEX candidate_mmi_station_sessions_owner ON public.candidate_mmi_station_sessions(user_id,started_at DESC);
CREATE TABLE public.candidate_mmi_station_prompt_snapshots(session_id uuid REFERENCES public.candidate_mmi_station_sessions ON DELETE CASCADE,prompt_order smallint,
  sub_question_id text,prompt_text text,rubric_snapshot jsonb,scoring_contract_snapshot jsonb,PRIMARY KEY(session_id,prompt_order));
CREATE TABLE public.candidate_mmi_station_response_drafts(session_id uuid REFERENCES public.candidate_mmi_station_sessions ON DELETE CASCADE,prompt_order smallint,transcript text);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_station_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_station_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_station_prompt_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_mmi_station_response_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,service_role;
-- Match the existing hosted/repository boundary: the trusted backend may
-- maintain history, while candidate roles cannot refund or forge admissions.
GRANT ALL ON TABLE public.candidate_mmi_station_sessions TO service_role;
CREATE FUNCTION public.canonical_mmi_university_tag(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(btrim($1)) $$;
CREATE FUNCTION public.is_complete_published_mmi_station(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.mmi_stations WHERE station_id=$1 AND published) $$;
-- The real start/abandon bodies run below; the projection dependency is modeled
-- without answers or assessor material. This fixture is not a hosted-schema proof.
CREATE FUNCTION public.get_candidate_mmi_station_session(uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE session_ public.candidate_mmi_station_sessions; BEGIN
  SELECT * INTO session_ FROM public.candidate_mmi_station_sessions WHERE id=$1 AND user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not owned'; END IF;
  RETURN jsonb_build_object('sessionId',session_.id,'stationId',session_.station_id,'scope',session_.practice_scope,
    'promptCount',(SELECT count(*) FROM public.candidate_mmi_station_prompt_snapshots WHERE session_id=$1));
END; $$;
INSERT INTO public.profiles SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Oxford' FROM generate_series(1,10) n;
INSERT INTO public.mmi_stations VALUES('station-a',ARRAY['oxford'],true);
INSERT INTO public.mmi_station_versions VALUES('station-a',1,jsonb_build_object('stationId','station-a','scenarioText','SYNTHETIC_SCENARIO','questions',
  (SELECT jsonb_agg(jsonb_build_object('orderNum',n,'subQuestionId','Q'||n,'questionText','SYNTHETIC_PROMPT_'||n,'criteria',jsonb_build_array(jsonb_build_object('criterionId','C'||n,'bulletText','SYNTHETIC_CRITERION','domain','communication')))) FROM generate_series(1,5) n)));
\i :baseline_start
ALTER FUNCTION public.start_candidate_mmi_station_session(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.start_candidate_mmi_station_session(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.start_candidate_mmi_station_session(text) TO authenticated;
REVOKE ALL ON FUNCTION public.abandon_candidate_mmi_station_session(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.abandon_candidate_mmi_station_session(uuid) TO authenticated;
\ir ../../supabase/migrations/20261021001000_candidate_mmi_station_start_limits.sql
DO $$ BEGIN
  ASSERT (SELECT starts_per_utc_day=30 AND starts_per_rolling_minute=5 AND NOT creation_paused FROM public.mmi_station_start_limits WHERE singleton);
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.mmi_station_start_limits'::regclass);
  ASSERT NOT has_table_privilege('authenticated','public.mmi_station_start_limits','SELECT,INSERT,UPDATE,DELETE');
  ASSERT NOT has_table_privilege('service_role','public.mmi_station_start_limits','SELECT,INSERT,UPDATE,DELETE');
  ASSERT has_table_privilege('service_role','public.candidate_mmi_station_sessions','INSERT');
  ASSERT has_table_privilege('service_role','public.candidate_mmi_station_sessions','UPDATE');
  ASSERT has_table_privilege('service_role','public.candidate_mmi_station_sessions','DELETE');
  ASSERT has_table_privilege('service_role','public.candidate_mmi_station_sessions','TRUNCATE');
  ASSERT NOT has_any_column_privilege('authenticated','public.candidate_mmi_station_sessions','INSERT,UPDATE');
  ASSERT NOT has_any_column_privilege('anon','public.candidate_mmi_station_sessions','INSERT,UPDATE');
END; $$;
SET ROLE authenticated;
SET request.jwt.claim.role='authenticated';
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
DO $$ DECLARE value_ jsonb; same_ jsonb; BEGIN
  FOR n IN 1..5 LOOP
    value_:=public.start_candidate_mmi_station_session('all');
    ASSERT value_->>'scope'='all' AND value_->>'stationId'='station-a' AND value_->>'promptCount'='5';
    IF n<5 THEN PERFORM public.abandon_candidate_mmi_station_session((value_->>'sessionId')::uuid); END IF;
  END LOOP;
  -- A duplicate start reopens the fifth active station even at the minute cap.
  same_:=public.start_candidate_mmi_station_session(); ASSERT same_=value_;
  BEGIN PERFORM public.start_candidate_mmi_station_session('target'); RAISE EXCEPTION 'scope mismatch accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'candidate_mmi_active_session_scope_mismatch' THEN RAISE; END IF; END;
END; $$;
RESET ROLE;
UPDATE public.mmi_station_start_limits SET creation_paused=true;
SET ROLE authenticated;
DO $$ BEGIN ASSERT public.start_candidate_mmi_station_session('all')->>'promptCount'='5'; END; $$;
SELECT public.abandon_candidate_mmi_station_session((public.start_candidate_mmi_station_session('all')->>'sessionId')::uuid);
DO $$ BEGIN
  BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'paused start accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'candidate_mmi_start_rate_limited' THEN RAISE; END IF; END;
END; $$;
RESET ROLE;
UPDATE public.mmi_station_start_limits SET creation_paused=false;
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.start_candidate_mmi_station_session(); RAISE EXCEPTION 'sixth rolling-minute start accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'candidate_mmi_start_rate_limited' THEN RAISE; END IF; END;
END; $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*)=5 AND bool_and(abandoned_at IS NOT NULL) FROM public.candidate_mmi_station_sessions WHERE user_id='00000000-0000-4000-8000-000000000001');
  ASSERT (SELECT count(*)=25 FROM public.candidate_mmi_station_prompt_snapshots);
  ASSERT NOT EXISTS(SELECT 1 FROM public.candidate_mmi_station_prompt_snapshots WHERE rubric_snapshot->'criteria'->0->>'bulletText'<>'SYNTHETIC_CRITERION' OR scoring_contract_snapshot->>'version'<>'2026-09-10.1');
END; $$;
-- Passage beyond a rolling minute frees only that window; abandoned rows stay.
UPDATE public.candidate_mmi_station_sessions SET started_at=clock_timestamp()-interval '61 seconds' WHERE user_id='00000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
DO $$ BEGIN ASSERT public.start_candidate_mmi_station_session('all')->>'promptCount'='5'; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
DO $$ BEGIN ASSERT public.start_candidate_mmi_station_session('target')->>'scope'='target'; END; $$;
DO $$ BEGIN
  BEGIN PERFORM public.abandon_candidate_mmi_station_session((SELECT public.start_candidate_mmi_station_session('target')->>'sessionId')::uuid); EXCEPTION WHEN OTHERS THEN RAISE; END;
END; $$;
RESET ROLE;
-- Current-day starts (including abandoned) are charged independently of caller timezone.
INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,abandoned_at,practice_scope)
SELECT '00000000-0000-4000-8000-000000000003','station-a',date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',clock_timestamp(),'all' FROM generate_series(1,30);
UPDATE public.candidate_mmi_station_sessions SET started_at=clock_timestamp(),abandoned_at=NULL
WHERE id=(SELECT id FROM public.candidate_mmi_station_sessions WHERE user_id='00000000-0000-4000-8000-000000000003' LIMIT 1);
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
DO $$ DECLARE value_ jsonb; BEGIN
  value_:=public.start_candidate_mmi_station_session('all');
  ASSERT value_->>'stationId'='station-a';
  PERFORM public.abandon_candidate_mmi_station_session((value_->>'sessionId')::uuid);
END; $$;
SET TIME ZONE 'America/Los_Angeles';
DO $$ BEGIN BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'daily cap bypassed in LA'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'candidate_mmi_start_rate_limited' THEN RAISE; END IF; END; END; $$;
SET TIME ZONE 'Pacific/Kiritimati';
DO $$ BEGIN BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'daily cap bypassed in Kiritimati'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'candidate_mmi_start_rate_limited' THEN RAISE; END IF; END; END; $$;
RESET ROLE;
SET TIME ZONE 'UTC';
-- Yesterday does not consume today's allowance, even in a non-UTC timezone.
INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,abandoned_at,practice_scope)
SELECT '00000000-0000-4000-8000-000000000004','station-a',(date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 hour',clock_timestamp(),'all' FROM generate_series(1,30);
SET ROLE authenticated;
SET TIME ZONE 'Pacific/Kiritimati';
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';
DO $$ BEGIN ASSERT public.start_candidate_mmi_station_session('all')->>'promptCount'='5'; END; $$;
RESET ROLE;
SET TIME ZONE 'UTC';
-- A failed content/snapshot transaction allocates no session or admission.
UPDATE public.mmi_station_versions SET content_snapshot=jsonb_set(content_snapshot,'{questions}','[]'::jsonb);
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000005';
DO $$ BEGIN BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'invalid snapshot accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'candidate_mmi_station_version_unavailable' THEN RAISE; END IF; END; END; $$;
RESET ROLE;
DO $$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.candidate_mmi_station_sessions WHERE user_id='00000000-0000-4000-8000-000000000005'); END; $$;
UPDATE public.mmi_station_versions SET content_snapshot=jsonb_set(content_snapshot,'{questions}',(SELECT jsonb_agg(jsonb_build_object('orderNum',n,'subQuestionId','Q'||n,'questionText','SYNTHETIC_PROMPT_'||n,'criteria',jsonb_build_array(jsonb_build_object('criterionId','C'||n,'bulletText','SYNTHETIC_CRITERION','domain','communication')))) FROM generate_series(1,5)n));
SELECT set_config('app.other_session',(SELECT id::text FROM public.candidate_mmi_station_sessions WHERE user_id='00000000-0000-4000-8000-000000000002' LIMIT 1),false);
SET ROLE authenticated;
SET request.jwt.claim.sub='';
DO $$ BEGIN BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'missing identity accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000099';
DO $$ BEGIN BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'missing profile accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  BEGIN PERFORM * FROM public.mmi_station_start_limits; RAISE EXCEPTION 'private limits readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.candidate_mmi_station_sessions; RAISE EXCEPTION 'candidate can refund starts'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.abandon_candidate_mmi_station_session(current_setting('app.other_session')::uuid); RAISE EXCEPTION 'cross-account abandon accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'anon execute accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.candidate_mmi_station_sessions; RAISE EXCEPTION 'anonymous candidate can refund starts'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'service execute accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
-- Permission checks still allow trusted maintenance; change no fixture rows.
UPDATE public.candidate_mmi_station_sessions SET abandoned_at=abandoned_at WHERE false;
DELETE FROM public.candidate_mmi_station_sessions WHERE false;
RESET ROLE;
SELECT 'Candidate MMI station start limits SQL proof passed';
