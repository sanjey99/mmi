-- Disposable private-socket proof only. The runner creates this marked, fresh
-- database and supplies baseline_claim as a local file extracted verbatim from
-- the reviewed claim migration. No hosted URL or existing database is accepted.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database()<>'mmi_public_scoring_proof' OR inet_server_addr() IS NOT NULL OR inet_client_addr() IS NOT NULL
    OR current_setting('app.mmi_public_scoring_proof',true) IS DISTINCT FROM 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA'
    OR to_regclass('public.profiles') IS NOT NULL THEN RAISE EXCEPTION 'Refusing unmarked/non-fresh/non-local allowance proof'; END IF;
END; $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA cron;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.candidate_mmi_station_sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES public.profiles ON DELETE CASCADE,started_at timestamptz,abandoned_at timestamptz,scenario_text_snapshot text);
CREATE TABLE public.candidate_mmi_station_responses(id uuid PRIMARY KEY,session_id uuid REFERENCES public.candidate_mmi_station_sessions ON DELETE CASCADE,prompt_order smallint,finalized_at timestamptz,response_state text,finalized_transcript text,scoring_status text,transcript_purged_at timestamptz,UNIQUE(session_id,prompt_order));
CREATE TABLE public.candidate_mmi_station_prompt_snapshots(session_id uuid REFERENCES public.candidate_mmi_station_sessions ON DELETE CASCADE,prompt_order smallint,prompt_text text,rubric_snapshot jsonb,scoring_contract_snapshot jsonb,PRIMARY KEY(session_id,prompt_order));
CREATE TABLE public.candidate_mmi_response_scoring_claims(response_id uuid PRIMARY KEY REFERENCES public.candidate_mmi_station_responses ON DELETE CASCADE,lease_token uuid UNIQUE,lease_expires_at timestamptz,attempt_count integer,last_error_code text,created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.candidate_mmi_station_response_drafts(session_id uuid,prompt_order smallint);
CREATE TABLE public.mmi_paid_scoring_claim_attempts(lease_token uuid PRIMARY KEY,user_id uuid REFERENCES public.profiles ON DELETE CASCADE,response_id uuid REFERENCES public.candidate_mmi_station_responses ON DELETE CASCADE,claimed_at timestamptz);
CREATE TABLE public.mmi_ai_usage_events(lease_token uuid UNIQUE,user_id uuid REFERENCES public.profiles ON DELETE CASCADE,response_id uuid REFERENCES public.candidate_mmi_station_responses ON DELETE CASCADE,created_at timestamptz,estimated_cost numeric(16,8));
CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,jobname text UNIQUE,schedule text,command text,active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid $$;
CREATE FUNCTION public.catch_up_candidate_mmi_station_responses(uuid,timestamptz) RETURNS void LANGUAGE sql AS $$ SELECT $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public,cron FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.profiles SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,4) n;
CREATE FUNCTION pg_temp.seed_station(p_user integer,p_number integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE session_ uuid:=('10000000-0000-4000-8000-'||lpad(p_number::text,12,'0'))::uuid;
BEGIN
  INSERT INTO public.candidate_mmi_station_sessions VALUES(session_,('00000000-0000-4000-8000-'||lpad(p_user::text,12,'0'))::uuid,clock_timestamp()-interval '12 minutes',NULL,'synthetic scenario');
  FOR n IN 1..5 LOOP
    INSERT INTO public.candidate_mmi_station_responses VALUES(('20000000-0000-4000-8000-'||lpad((p_number*10+n)::text,12,'0'))::uuid,session_,n,clock_timestamp()-interval '2 minutes','response','synthetic answer kept private','pending',NULL);
    INSERT INTO public.candidate_mmi_station_prompt_snapshots VALUES(session_,n,'synthetic prompt','{"criteria":[{"criterionId":"x","bulletText":"synthetic criterion","domain":null}]}','{"version":"2026-09-10.1"}');
  END LOOP;
END; $$;
SELECT pg_temp.seed_station(1,1),pg_temp.seed_station(1,2),pg_temp.seed_station(1,3),pg_temp.seed_station(2,4),pg_temp.seed_station(3,5);
SELECT pg_temp.seed_station(1,n) FROM generate_series(100,105) n;
-- An older metered/attempt lease overlaps and must seed once, not twice.
INSERT INTO public.mmi_ai_usage_events VALUES('90000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000051',clock_timestamp()-interval '10 minutes',0.1);
INSERT INTO public.mmi_paid_scoring_claim_attempts SELECT lease_token,user_id,response_id,created_at FROM public.mmi_ai_usage_events;
\i :baseline_claim
\ir ../../supabase/migrations/20261020001000_public_scoring_allowances.sql
SET request.jwt.claim.role='service_role';
DO $$ BEGIN
  ASSERT (SELECT attempt_count FROM public.mmi_public_scoring_daily_totals WHERE utc_day=(clock_timestamp() AT TIME ZONE 'UTC')::date)=1;
  ASSERT (SELECT response_count FROM public.mmi_public_scoring_account_days WHERE user_id='00000000-0000-4000-8000-000000000003')=1;
  ASSERT (SELECT scoring_paused=false AND responses_per_account_day=10 AND attempts_per_account_day=20 AND claims_per_day=100 AND concurrent_claims=10 AND daily_known_cost_limit_usd IS NULL FROM public.mmi_public_scoring_limits);
END; $$;
CREATE FUNCTION pg_temp.claim(p_user integer,p_station integer,p_order integer,p_lease integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.claim_candidate_mmi_response_scoring(('00000000-0000-4000-8000-'||lpad(p_user::text,12,'0'))::uuid,('10000000-0000-4000-8000-'||lpad(p_station::text,12,'0'))::uuid,p_order::smallint,('30000000-0000-4000-8000-'||lpad(p_lease::text,12,'0'))::uuid)
$$;
CREATE FUNCTION pg_temp.release(p_station integer,p_order integer) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 UPDATE public.candidate_mmi_response_scoring_claims SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE response_id=('20000000-0000-4000-8000-'||lpad((p_station*10+p_order)::text,12,'0'))::uuid;
 UPDATE public.candidate_mmi_station_responses SET scoring_status='failed' WHERE session_id=('10000000-0000-4000-8000-'||lpad(p_station::text,12,'0'))::uuid AND prompt_order=p_order;
END; $$;
DO $$ DECLARE result_ jsonb; lease_ integer:=10; BEGIN
  FOR station_ IN 1..2 LOOP FOR order_ IN 1..5 LOOP
    lease_:=lease_+1; result_:=pg_temp.claim(1,station_,order_,lease_);
    ASSERT result_->>'status'='claimed'; PERFORM pg_temp.release(station_,order_);
  END LOOP; END LOOP;
  result_:=pg_temp.claim(1,3,1,30); ASSERT result_->>'status'='rate_limited';
  ASSERT (result_->>'retryAfterSeconds')::integer BETWEEN 1 AND 3600;
  ASSERT (SELECT scoring_status='pending' AND finalized_transcript='synthetic answer kept private' FROM public.candidate_mmi_station_responses WHERE id='20000000-0000-4000-8000-000000000031');
  -- An already admitted response still retries at the response cap.
  ASSERT pg_temp.claim(1,1,1,31)->>'status'='claimed';
  ASSERT pg_temp.claim(1,1,1,31)->>'status'='in_progress';
  ASSERT (SELECT response_count=10 AND attempt_count=11 FROM public.mmi_public_scoring_account_days WHERE user_id='00000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.release(1,1);
  FOR station_ IN 1..2 LOOP FOR order_ IN 1..5 LOOP
    IF station_=1 AND order_=1 THEN CONTINUE; END IF;
    lease_:=lease_+1; ASSERT pg_temp.claim(1,station_,order_,lease_+100)->>'status'='claimed'; PERFORM pg_temp.release(station_,order_);
  END LOOP; END LOOP;
  ASSERT pg_temp.claim(1,1,2,200)->>'status'='rate_limited';
  ASSERT (SELECT attempt_count=20 FROM public.mmi_public_scoring_account_days WHERE user_id='00000000-0000-4000-8000-000000000001');
  -- Another verified owner has an independent account allowance.
  ASSERT pg_temp.claim(2,4,1,201)->>'status'='claimed'; PERFORM pg_temp.release(4,1);
  BEGIN PERFORM pg_temp.claim(1,4,1,202); RAISE EXCEPTION 'cross-account ownership accepted'; EXCEPTION WHEN no_data_found THEN NULL; END;
END; $$;
-- Timezone changes cannot reset today's counters.
SET TIME ZONE 'Pacific/Kiritimati';
DO $$ BEGIN ASSERT pg_temp.claim(1,3,2,203)->>'status'='rate_limited'; END; $$;
SET TIME ZONE 'UTC';
-- A prior-day accepted response remains admitted after the distinct cap.
UPDATE public.mmi_public_scoring_response_admissions SET first_admitted_at=clock_timestamp()-interval '1 day' WHERE response_id='20000000-0000-4000-8000-000000000041';
UPDATE public.mmi_public_scoring_account_days SET response_count=10 WHERE user_id='00000000-0000-4000-8000-000000000002';
DO $$ BEGIN ASSERT pg_temp.claim(2,4,1,204)->>'status'='claimed'; PERFORM pg_temp.release(4,1); END; $$;
-- Preserve the older three-paid-attempts/response/rolling-hour bound too.
UPDATE public.mmi_public_scoring_limits SET attempts_per_account_day=100;
DO $$ BEGIN
  ASSERT pg_temp.claim(1,1,2,205)->>'status'='claimed'; PERFORM pg_temp.release(1,2);
  ASSERT pg_temp.claim(1,1,2,206)->>'status'='rate_limited';
END; $$;
-- Terminal results are reusable even with the pause switch on.
UPDATE public.mmi_public_scoring_limits SET scoring_paused=true;
UPDATE public.candidate_mmi_station_responses SET scoring_status='scored',finalized_transcript=NULL WHERE id='20000000-0000-4000-8000-000000000011';
UPDATE public.candidate_mmi_station_responses SET response_state='no_response',scoring_status='no_response',finalized_transcript=NULL WHERE id='20000000-0000-4000-8000-000000000012';
DO $$ BEGIN
  ASSERT pg_temp.claim(1,1,1,207)->>'status'='scored';
  ASSERT pg_temp.claim(1,1,2,208)->>'status'='no_response';
  ASSERT pg_temp.claim(2,4,2,209)->>'status'='rate_limited';
END; $$;
-- Configured known-cost cutoff blocks new leases; NULL means no dollar budget.
UPDATE public.mmi_public_scoring_limits SET scoring_paused=false,daily_known_cost_limit_usd=0;
DO $$ BEGIN ASSERT pg_temp.claim(2,4,2,210)->>'status'='rate_limited'; END; $$;
UPDATE public.mmi_public_scoring_limits SET daily_known_cost_limit_usd=NULL;
-- Privacy expiry still outranks a live lease and preserves existing purge rules.
DO $$ BEGIN ASSERT pg_temp.claim(2,4,1,211)->>'status'='claimed'; END; $$;
INSERT INTO public.candidate_mmi_station_response_drafts VALUES('10000000-0000-4000-8000-000000000004',1);
UPDATE public.candidate_mmi_station_responses SET finalized_at=clock_timestamp()-interval '24 hours' WHERE id='20000000-0000-4000-8000-000000000041';
DO $$ BEGIN
 ASSERT (SELECT scoring_status='in_progress' FROM public.candidate_mmi_station_responses WHERE id='20000000-0000-4000-8000-000000000041');
 ASSERT (SELECT lease_expires_at>clock_timestamp() FROM public.candidate_mmi_response_scoring_claims WHERE response_id='20000000-0000-4000-8000-000000000041');
 ASSERT pg_temp.claim(2,4,1,212)->>'status'='unavailable';
 ASSERT (SELECT finalized_transcript IS NULL AND scoring_status='feedback_unavailable' FROM public.candidate_mmi_station_responses WHERE id='20000000-0000-4000-8000-000000000041');
 ASSERT (SELECT lease_expires_at<=clock_timestamp() AND last_error_code='retention_cutoff' FROM public.candidate_mmi_response_scoring_claims WHERE response_id='20000000-0000-4000-8000-000000000041');
 ASSERT NOT EXISTS(SELECT 1 FROM public.candidate_mmi_station_response_drafts WHERE session_id='10000000-0000-4000-8000-000000000004' AND prompt_order=1);
END; $$;
-- SQL privileges are real even for service_role's RLS bypass.
UPDATE public.mmi_public_scoring_limits SET attempts_per_account_day=20;
SET ROLE authenticated;
SET request.jwt.claim.role='authenticated';
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
DO $$ DECLARE allowance_ jsonb; BEGIN
 allowance_:=public.get_candidate_mmi_scoring_allowance();
 ASSERT (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(allowance_) key)=ARRAY['attemptsRemaining','checkedAt','globalCapacityAvailable','resetsAt','responsesRemaining','scoringPaused','stationAllowanceRemaining'];
 ASSERT (allowance_->>'responsesRemaining')::integer=0;
 ASSERT (allowance_->>'attemptsRemaining')::integer=0;
 ASSERT (allowance_->>'stationAllowanceRemaining')::integer=0;
 ASSERT (allowance_->>'resetsAt')::timestamptz=(((clock_timestamp() AT TIME ZONE 'UTC')::date+1)::timestamp AT TIME ZONE 'UTC');
 ASSERT allowance_::text !~ '(00000000-0000|synthetic|cost|user_id|response_id|attempt_count)';
END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
DO $$ BEGIN ASSERT (public.get_candidate_mmi_scoring_allowance()->>'attemptsRemaining')::integer=17; END; $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000004';
DO $$ DECLARE allowance_ jsonb; BEGIN
 allowance_:=public.get_candidate_mmi_scoring_allowance();
 ASSERT (allowance_->>'responsesRemaining')::integer=10;
 ASSERT (allowance_->>'attemptsRemaining')::integer=20;
 ASSERT (allowance_->>'stationAllowanceRemaining')::integer=2;
 ASSERT NOT (allowance_->>'scoringPaused')::boolean;
 ASSERT (allowance_->>'globalCapacityAvailable')::boolean;
END; $$;
SET request.jwt.claim.sub='';
DO $$ BEGIN
 BEGIN PERFORM public.get_candidate_mmi_scoring_allowance(); RAISE EXCEPTION 'self allowance missing uid accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.claim_candidate_mmi_response_scoring('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1::smallint,'30000000-0000-4000-8000-000000000212'); RAISE EXCEPTION 'tester claimed paid work'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM count(*) FROM public.mmi_public_scoring_limits; RAISE EXCEPTION 'tester read private limits'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET ROLE service_role;
SET request.jwt.claim.role='service_role';
DO $$ BEGIN
 BEGIN PERFORM public.get_candidate_mmi_scoring_allowance(); RAISE EXCEPTION 'service read self allowance'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 ASSERT public.claim_candidate_mmi_response_scoring('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1::smallint,'30000000-0000-4000-8000-000000000213')->>'status'='scored';
 BEGIN PERFORM count(*) FROM public.mmi_public_scoring_daily_totals; RAISE EXCEPTION 'service read global counters'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.purge_mmi_public_scoring_counters_internal(); RAISE EXCEPTION 'service ran cleanup'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
-- A real profile deletion cascades its private counters/admissions and source
-- attempt/session data, but cannot refund the shared daily total.
SELECT pg_temp.seed_station(4,6);
DO $$ DECLARE before_ integer; BEGIN
 ASSERT pg_temp.claim(4,6,1,220)->>'status'='claimed';
 SELECT attempt_count INTO before_ FROM public.mmi_public_scoring_daily_totals WHERE utc_day=(clock_timestamp() AT TIME ZONE 'UTC')::date;
 DELETE FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000004';
 ASSERT (SELECT attempt_count FROM public.mmi_public_scoring_daily_totals WHERE utc_day=(clock_timestamp() AT TIME ZONE 'UTC')::date)=before_;
 ASSERT NOT EXISTS(SELECT 1 FROM public.mmi_public_scoring_account_days WHERE user_id='00000000-0000-4000-8000-000000000004');
 ASSERT NOT EXISTS(SELECT 1 FROM public.mmi_public_scoring_response_admissions WHERE user_id='00000000-0000-4000-8000-000000000004');
END; $$;
-- Retention keeps seven full UTC days + today.
INSERT INTO public.mmi_public_scoring_daily_totals VALUES((clock_timestamp() AT TIME ZONE 'UTC')::date-8,1),((clock_timestamp() AT TIME ZONE 'UTC')::date-7,1);
DO $$ BEGIN
 ASSERT public.purge_mmi_public_scoring_counters_internal()=1;
 ASSERT EXISTS(SELECT 1 FROM public.mmi_public_scoring_daily_totals WHERE utc_day=(clock_timestamp() AT TIME ZONE 'UTC')::date-7);
END; $$;
-- Leave a clean set of six contender stations for the runner's parallel tests.
DELETE FROM public.mmi_public_scoring_response_admissions;
DELETE FROM public.mmi_public_scoring_account_days;
DELETE FROM public.mmi_public_scoring_daily_totals;
DELETE FROM public.mmi_paid_scoring_claim_attempts;
DELETE FROM public.candidate_mmi_response_scoring_claims;
UPDATE public.mmi_public_scoring_limits SET attempts_per_account_day=20;
SELECT 'Public scoring allowance SQL proof passed' AS result;
