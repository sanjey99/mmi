-- Only the owned Unix-socket cluster created by the dedicated runner is safe.
-- The schema/content fixture is synthetic; actual start/finalize/phase/abandon
-- function bodies are extracted from the repository and checked below.
\set ON_ERROR_STOP on
\i :fixture_schema
SET TIME ZONE 'UTC';
\i :actual_lifecycle
INSERT INTO public.profiles SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Oxford' FROM generate_series(11,100)n;
CREATE SCHEMA proof_clock;
CREATE FUNCTION proof_clock.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT current_setting('app.proof_now')::timestamptz $$;
CREATE TABLE proof_clock.body_hashes AS SELECT oid,proname,md5(prosrc) AS hash FROM pg_proc WHERE oid IN (
  'public.start_candidate_mmi_station_session(text)'::regprocedure,
  'public.finalize_candidate_mmi_station_response(uuid,smallint,uuid)'::regprocedure,
  'public.finalize_candidate_mmi_station_response_internal(uuid,smallint,uuid,timestamptz)'::regprocedure,
  'public.catch_up_candidate_mmi_station_responses(uuid,timestamptz)'::regprocedure,
  'public.candidate_mmi_station_window(timestamptz,smallint)'::regprocedure,
  'public.abandon_candidate_mmi_station_session(uuid)'::regprocedure,
  'public.get_candidate_mmi_station_session(uuid)'::regprocedure);
DO $$ BEGIN
  ASSERT (SELECT hash='9cbea31c28fc4583cfbadd0946a27495' FROM proof_clock.body_hashes WHERE proname='start_candidate_mmi_station_session');
  ASSERT (SELECT hash='7c323c18185b25935c4bdf1306c659b3' FROM proof_clock.body_hashes WHERE proname='finalize_candidate_mmi_station_response');
END; $$;
-- Test-only clock dependency binding. Neither prosrc nor the OS/server clock
-- changes. The actual migration later runs with the real cutover clock.
ALTER FUNCTION public.start_candidate_mmi_station_session(text) SET search_path=proof_clock,pg_catalog,public,pg_temp;
ALTER FUNCTION public.finalize_candidate_mmi_station_response(uuid,smallint,uuid) SET search_path=proof_clock,pg_catalog,public,pg_temp;
ALTER FUNCTION public.get_candidate_mmi_station_session(uuid) SET search_path=proof_clock,pg_catalog,public,pg_temp;
ALTER FUNCTION public.abandon_candidate_mmi_station_session(uuid) SET search_path=proof_clock,pg_catalog,public,pg_temp;
SELECT set_config('app.proof_day',(date_trunc('day',pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::text,false);
SET request.jwt.claim.role='authenticated';
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
DO $$ DECLARE result_ jsonb; BEGIN
  -- The unpatched negative control makes thirty real starts, respecting 5/min.
  FOR n IN 1..30 LOOP
    PERFORM set_config('app.proof_now',(current_setting('app.proof_day')::timestamptz-interval '1 day'+((n-1)/5)*interval '1 minute')::text,false);
    result_:=public.start_candidate_mmi_station_session('all');
    IF n<30 THEN PERFORM public.abandon_candidate_mmi_station_session((result_->>'sessionId')::uuid); END IF;
  END LOOP;
  PERFORM set_config('app.negative_session',result_->>'sessionId',false);
  PERFORM set_config('app.proof_now',(current_setting('app.proof_day')::timestamptz-interval '1 day'+interval '6 minutes 1 second')::text,false);
  FOR n IN 1..5 LOOP PERFORM public.finalize_candidate_mmi_station_response((result_->>'sessionId')::uuid,n::smallint,gen_random_uuid()); END LOOP;
  ASSERT public.start_candidate_mmi_station_session('all')->>'sessionId'<>result_->>'sessionId';
END; $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*)=31 FROM public.candidate_mmi_station_sessions WHERE user_id='00000000-0000-4000-8000-000000000001');
  ASSERT (SELECT count(*)=5 FROM public.candidate_mmi_station_responses WHERE session_id=current_setting('app.negative_session')::uuid);
  ASSERT NOT EXISTS(SELECT 1 FROM proof_clock.body_hashes h JOIN pg_proc p ON p.oid=h.oid WHERE h.hash<>md5(p.prosrc));
END; $$;
-- Frozen legacy fixtures test the two sides of UTC midnight, old non-overlap,
-- recent-window uncertainty, active early submission, and distant history.
INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,abandoned_at,practice_scope)
SELECT '00000000-0000-4000-8000-000000000011','station-a',current_setting('app.proof_day')::timestamptz,pg_catalog.clock_timestamp(),'all' FROM generate_series(1,30);
INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,abandoned_at,practice_scope)
SELECT '00000000-0000-4000-8000-000000000012','station-a',current_setting('app.proof_day')::timestamptz-interval '5 minutes',pg_catalog.clock_timestamp(),'all' FROM generate_series(1,30);
INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,abandoned_at,practice_scope)
SELECT '00000000-0000-4000-8000-000000000013','station-a',current_setting('app.proof_day')::timestamptz-interval '601 seconds',pg_catalog.clock_timestamp(),'all' FROM generate_series(1,30);
INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,abandoned_at,practice_scope)
SELECT '00000000-0000-4000-8000-000000000017','station-a',current_setting('app.proof_day')::timestamptz-interval '600 seconds',pg_catalog.clock_timestamp(),'all' FROM generate_series(1,30);
INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,abandoned_at,practice_scope)
SELECT '00000000-0000-4000-8000-000000000014','station-a',pg_catalog.clock_timestamp()-interval '10 seconds',pg_catalog.clock_timestamp(),'all' FROM generate_series(1,5);
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000015';
SELECT set_config('app.proof_now',(pg_catalog.clock_timestamp()-interval '61 seconds')::text,false);
SET ROLE authenticated;
SELECT set_config('app.legacy_active',public.start_candidate_mmi_station_session('all')->>'sessionId',false);
RESET ROLE;
INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,abandoned_at,practice_scope)
VALUES('00000000-0000-4000-8000-000000000016','station-a',pg_catalog.clock_timestamp()-interval '1 year',pg_catalog.clock_timestamp()-interval '1 year','all');
CREATE TABLE proof_clock.legacy_before AS SELECT id,started_at FROM public.candidate_mmi_station_sessions;
CREATE TABLE proof_clock.private_boundary AS SELECT relacl,relowner,relrowsecurity FROM pg_class WHERE oid='public.candidate_mmi_station_sessions'::regclass;
ALTER FUNCTION public.start_candidate_mmi_station_session(text) SET search_path=public,pg_temp;
ALTER FUNCTION public.finalize_candidate_mmi_station_response(uuid,smallint,uuid) SET search_path=public,pg_temp;
ALTER FUNCTION public.get_candidate_mmi_station_session(uuid) SET search_path=public,pg_temp;
ALTER FUNCTION public.abandon_candidate_mmi_station_session(uuid) SET search_path=public,pg_temp;

-- A pre-existing non-JSON setting must be overwritten for verification and
-- restored at commit, rather than trusted or replaced by snapshot metadata.
SELECT set_config('app.mmi_admission_cutover_invariants','PRE_EXISTING_PROOF_VALUE',false);
\ir ../../supabase/migrations/20261030000000_candidate_mmi_immutable_admissions.sql

SELECT set_config('app.cutover',(SELECT max(admission_latest_at)::text FROM public.candidate_mmi_station_sessions WHERE user_id='00000000-0000-4000-8000-000000000014'),false);
DO $$ BEGIN
  ASSERT current_setting('app.mmi_admission_cutover_invariants',true)='PRE_EXISTING_PROOF_VALUE';
  ASSERT to_regclass('public.mmi_admission_cutover_invariants') IS NULL;
  ASSERT to_regclass('pg_temp.mmi_admission_cutover_invariants') IS NULL;
  ASSERT (SELECT count(*) FROM proof_clock.legacy_before)=(SELECT count(*) FROM public.candidate_mmi_station_sessions);
  ASSERT NOT EXISTS(SELECT 1 FROM proof_clock.legacy_before before_ JOIN public.candidate_mmi_station_sessions after_ USING(id)
    WHERE before_.started_at<>after_.started_at OR after_.admission_earliest_at<>before_.started_at
      OR after_.admission_latest_at<>least(current_setting('app.cutover')::timestamptz,before_.started_at+interval '600 seconds'));
  ASSERT (SELECT bool_and(admission_latest_at<=current_setting('app.cutover')::timestamptz) FROM public.candidate_mmi_station_sessions);
  ASSERT (SELECT bool_and(admission_latest_at-admission_earliest_at<=interval '600 seconds') FROM public.candidate_mmi_station_sessions);
  ASSERT (SELECT md5(prosrc)='34e2185693365a34dd669328364dcf96' FROM pg_proc WHERE oid='public.start_candidate_mmi_station_session(text)'::regprocedure);
  ASSERT NOT EXISTS(SELECT 1 FROM proof_clock.body_hashes h JOIN pg_proc p ON p.oid=h.oid WHERE h.proname<>'start_candidate_mmi_station_session' AND h.hash<>md5(p.prosrc));
  ASSERT EXISTS(SELECT 1 FROM proof_clock.private_boundary before_ JOIN pg_class after_ ON after_.oid='public.candidate_mmi_station_sessions'::regclass WHERE before_.relacl IS NOT DISTINCT FROM after_.relacl AND before_.relowner=after_.relowner AND before_.relrowsecurity=after_.relrowsecurity);
  ASSERT (SELECT starts_per_utc_day=30 AND starts_per_rolling_minute=5 AND NOT creation_paused FROM public.mmi_station_start_limits WHERE singleton);
  ASSERT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.candidate_mmi_station_sessions_owner'::regclass AND indisvalid);
  ASSERT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.candidate_mmi_station_sessions_admission_count'::regclass AND indisvalid);
END; $$;
ALTER FUNCTION public.start_candidate_mmi_station_session(text) SET search_path=proof_clock,pg_catalog,public,pg_temp;
ALTER FUNCTION public.finalize_candidate_mmi_station_response(uuid,smallint,uuid) SET search_path=proof_clock,pg_catalog,public,pg_temp;
ALTER FUNCTION public.get_candidate_mmi_station_session(uuid) SET search_path=proof_clock,pg_catalog,public,pg_temp;
ALTER FUNCTION public.abandon_candidate_mmi_station_session(uuid) SET search_path=proof_clock,pg_catalog,public,pg_temp;
CREATE FUNCTION proof_clock.expect_blocked() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'Expected station admission rejection';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'candidate_mmi_start_rate_limited' THEN RAISE; END IF; END;
END; $$;
GRANT USAGE ON SCHEMA proof_clock TO authenticated;
GRANT EXECUTE ON FUNCTION proof_clock.expect_blocked() TO authenticated;

-- Legacy current-day usage survives cutover. The uncertainty-overlap account
-- is conservatively charged on either possible day, without moving old rows.
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000011';
SELECT set_config('app.proof_now',(current_setting('app.proof_day')::timestamptz+interval '12 hours')::text,false);
SET ROLE authenticated;
SELECT proof_clock.expect_blocked();
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000012';
SELECT proof_clock.expect_blocked();
-- An inclusive latest bound exactly at midnight can be a true admission at
-- midnight, so it must count in that day; 601 seconds before does not overlap.
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000017';
SELECT proof_clock.expect_blocked();
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000012';
SELECT set_config('app.proof_now',(current_setting('app.proof_day')::timestamptz-interval '1 second')::text,false);
SELECT proof_clock.expect_blocked();
-- Once the next UTC day begins, those frozen old bounds cannot consume it.
SELECT set_config('app.proof_now',(current_setting('app.proof_day')::timestamptz+interval '1 day')::text,false);
DO $$ BEGIN ASSERT public.start_candidate_mmi_station_session('all')->>'phase'='scenario'; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000013';
SELECT set_config('app.proof_now',(current_setting('app.proof_day')::timestamptz+interval '20 minutes')::text,false);
DO $$ BEGIN ASSERT public.start_candidate_mmi_station_session('all')->>'phase'='scenario'; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000016';
DO $$ BEGIN ASSERT public.start_candidate_mmi_station_session('all')->>'phase'='scenario'; END; $$;
-- Recent legacy rows are not refunded, but their upper bound is clamped to
-- cutover and cannot charge a minute forever because of the +600 uncertainty.
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000014';
SELECT set_config('app.proof_now',(current_setting('app.cutover')::timestamptz+interval '0.1 seconds')::text,false);
SELECT proof_clock.expect_blocked();
SELECT set_config('app.proof_now',(current_setting('app.cutover')::timestamptz+interval '61 seconds')::text,false);
DO $$ BEGIN ASSERT public.start_candidate_mmi_station_session('all')->>'phase'='scenario'; END; $$;
-- Existing active early-submit behavior remains unchanged, while its frozen
-- admission window cannot move with the virtual phase clock.
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000015';
SELECT set_config('app.proof_now',(current_setting('app.cutover')::timestamptz+interval '1 second')::text,false);
DO $$ BEGIN FOR n IN 1..5 LOOP PERFORM public.finalize_candidate_mmi_station_response(current_setting('app.legacy_active')::uuid,n::smallint,gen_random_uuid()); END LOOP; END; $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT s.started_at<b.started_at AND s.admission_earliest_at=b.started_at AND s.admission_latest_at=least(current_setting('app.cutover')::timestamptz,b.started_at+interval '600 seconds') FROM public.candidate_mmi_station_sessions s JOIN proof_clock.legacy_before b USING(id) WHERE s.id=current_setting('app.legacy_active')::uuid);
END; $$;

-- The fixed counterpart makes the same thirty real starts the next day. Free
-- reuse, including while paused and at the cap, consumes no extra metadata.
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000020';
SET ROLE authenticated;
DO $$ DECLARE result_ jsonb; BEGIN
  FOR n IN 1..30 LOOP
    PERFORM set_config('app.proof_now',(current_setting('app.proof_day')::timestamptz+interval '1 day'+((n-1)/5)*interval '1 minute')::text,false);
    result_:=public.start_candidate_mmi_station_session('all');
    IF n<30 THEN PERFORM public.abandon_candidate_mmi_station_session((result_->>'sessionId')::uuid); END IF;
  END LOOP;
  PERFORM set_config('app.fixed_session',result_->>'sessionId',false);
  ASSERT public.start_candidate_mmi_station_session('all')=result_;
END; $$;
RESET ROLE;
UPDATE public.mmi_station_start_limits SET creation_paused=true;
SET ROLE authenticated;
DO $$ BEGIN ASSERT public.start_candidate_mmi_station_session('all')->>'sessionId'=current_setting('app.fixed_session'); END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000021';
SELECT proof_clock.expect_blocked();
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000020';
RESET ROLE;
UPDATE public.mmi_station_start_limits SET creation_paused=false;
SET ROLE authenticated;
SELECT set_config('app.proof_now',(current_setting('app.proof_day')::timestamptz+interval '1 day 6 minutes 1 second')::text,false);
DO $$ BEGIN FOR n IN 1..5 LOOP PERFORM public.finalize_candidate_mmi_station_response(current_setting('app.fixed_session')::uuid,n::smallint,gen_random_uuid()); END LOOP; END; $$;
SELECT proof_clock.expect_blocked();
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*)=30 AND bool_and(admission_earliest_at=admission_latest_at) FROM public.candidate_mmi_station_sessions WHERE user_id='00000000-0000-4000-8000-000000000020');
  ASSERT (SELECT started_at=current_setting('app.proof_day')::timestamptz+interval '23 hours 55 minutes 1 second'
      AND admission_earliest_at=current_setting('app.proof_day')::timestamptz+interval '1 day 5 minutes'
    FROM public.candidate_mmi_station_sessions WHERE id=current_setting('app.fixed_session')::uuid);
  ASSERT (SELECT count(*)=5 FROM public.candidate_mmi_station_responses WHERE session_id=current_setting('app.fixed_session')::uuid);
END; $$;
-- Day reset uses the immutable exact new timestamp, including in non-UTC SQL
-- sessions. Neither changing client timezone nor early skips refunds a start.
SET ROLE authenticated;
SET TIME ZONE 'Pacific/Kiritimati';
SELECT proof_clock.expect_blocked();
SET TIME ZONE 'America/Los_Angeles';
SELECT proof_clock.expect_blocked();
SET TIME ZONE 'UTC';
SELECT set_config('app.proof_now',(current_setting('app.proof_day')::timestamptz+interval '2 days')::text,false);
DO $$ DECLARE result_ jsonb; BEGIN
  result_:=public.start_candidate_mmi_station_session('all');
  ASSERT (SELECT array_agg(key ORDER BY key)=ARRAY['phase','phaseEndsAt','phaseStartedAt','scenarioText','serverNow','sessionId','stationId'] FROM jsonb_object_keys(result_)key);
END; $$;
RESET ROLE;

-- Browser roles cannot write timestamps, refund admissions, or call privileged
-- helpers. Trusted service DML on existing fields keeps working; even trusted
-- callers cannot mutate an already frozen admission window accidentally.
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN UPDATE public.candidate_mmi_station_sessions SET admission_earliest_at=now(); RAISE EXCEPTION 'Candidate wrote admission metadata'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.candidate_mmi_station_sessions; RAISE EXCEPTION 'Candidate refunded admission'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'Anonymous start allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN BEGIN PERFORM public.start_candidate_mmi_station_session('all'); RAISE EXCEPTION 'Service start allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END; $$;
UPDATE public.candidate_mmi_station_sessions SET started_at=started_at WHERE id=current_setting('app.fixed_session')::uuid;
UPDATE public.candidate_mmi_station_sessions SET admission_earliest_at=admission_earliest_at WHERE id=current_setting('app.fixed_session')::uuid;
DO $$ BEGIN
  BEGIN UPDATE public.candidate_mmi_station_sessions SET admission_earliest_at=admission_earliest_at-interval '1 second' WHERE id=current_setting('app.fixed_session')::uuid; RAISE EXCEPTION 'Lower bound mutable'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'candidate_mmi_admission_window_immutable' THEN RAISE; END IF; END;
  BEGIN UPDATE public.candidate_mmi_station_sessions SET admission_latest_at=admission_latest_at+interval '1 second' WHERE id=current_setting('app.fixed_session')::uuid; RAISE EXCEPTION 'Upper bound mutable'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'candidate_mmi_admission_window_immutable' THEN RAISE; END IF; END;
  BEGIN INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,admission_earliest_at,admission_latest_at) VALUES('00000000-0000-4000-8000-000000000099','station-a',now(),now(),now()+interval '601 seconds'); RAISE EXCEPTION 'Unbounded uncertainty accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
END; $$;
-- An old trusted INSERT shape still receives equal, finite default bounds.
INSERT INTO public.candidate_mmi_station_sessions(user_id,station_id,started_at,practice_scope) VALUES('00000000-0000-4000-8000-000000000099','station-a',pg_catalog.clock_timestamp(),'all');
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT bool_and(admission_earliest_at=admission_latest_at AND isfinite(admission_earliest_at)) FROM public.candidate_mmi_station_sessions WHERE user_id='00000000-0000-4000-8000-000000000099'); END; $$;
SELECT 'Candidate MMI immutable admissions SQL proof passed';
