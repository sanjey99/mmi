-- Server-owned, reversible candidate-scoring admission controls. Apply ONLY
-- this reviewed migration after exact-target preflight, not a baseline db push.
-- These are request/response allowances, not a guarantee of provider spending.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $prerequisites$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL
    OR to_regprocedure('public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid)') IS NULL
    OR to_regprocedure('public.catch_up_candidate_mmi_station_responses(uuid,timestamp with time zone)') IS NULL
    OR to_regclass('public.mmi_paid_scoring_claim_attempts') IS NULL
    OR to_regclass('public.mmi_ai_usage_events') IS NULL
    OR to_regclass('public.candidate_mmi_station_prompt_snapshots') IS NULL
    OR to_regclass('cron.job') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Public scoring prerequisites missing';
  END IF;
  IF COALESCE(current_setting('cron.timezone',true),'GMT') NOT IN ('GMT','UTC','Etc/UTC','Etc/GMT') THEN
    RAISE EXCEPTION 'Public scoring allowance cleanup requires UTC cron';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid)'::regprocedure) <> '4c6cb56001b9579a0983826d190f6f3f' THEN
    RAISE EXCEPTION 'Existing scoring claim body differs from reviewed baseline';
  END IF;
  IF to_regclass('public.mmi_public_scoring_limits') IS NOT NULL
    OR to_regclass('public.mmi_public_scoring_daily_totals') IS NOT NULL
    OR to_regclass('public.mmi_public_scoring_account_days') IS NOT NULL
    OR to_regclass('public.mmi_public_scoring_response_admissions') IS NOT NULL
    OR to_regprocedure('public.get_candidate_mmi_scoring_allowance()') IS NOT NULL
    OR to_regprocedure('public.purge_mmi_public_scoring_counters_internal()') IS NOT NULL
    OR EXISTS(SELECT 1 FROM cron.job WHERE jobname='mmi-purge-public-scoring-counters') THEN
    RAISE EXCEPTION 'Public scoring objects already exist; review rather than replace';
  END IF;
END;
$prerequisites$;

CREATE TABLE public.mmi_public_scoring_limits (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  scoring_paused boolean NOT NULL DEFAULT false,
  responses_per_account_day integer NOT NULL DEFAULT 10 CHECK(responses_per_account_day BETWEEN 1 AND 1000),
  attempts_per_account_day integer NOT NULL DEFAULT 20 CHECK(attempts_per_account_day BETWEEN 1 AND 10000),
  claims_per_day integer NOT NULL DEFAULT 100 CHECK(claims_per_day BETWEEN 1 AND 1000000),
  concurrent_claims integer NOT NULL DEFAULT 10 CHECK(concurrent_claims BETWEEN 1 AND 1000),
  daily_known_cost_limit_usd numeric(16,8) CHECK(daily_known_cost_limit_usd IS NULL OR daily_known_cost_limit_usd>=0),
  CHECK(attempts_per_account_day>=responses_per_account_day)
);
CREATE TABLE public.mmi_public_scoring_daily_totals (
  utc_day date PRIMARY KEY,
  attempt_count integer NOT NULL CHECK(attempt_count>=0)
);
CREATE TABLE public.mmi_public_scoring_account_days (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  utc_day date NOT NULL,
  response_count integer NOT NULL CHECK(response_count>=0),
  attempt_count integer NOT NULL CHECK(attempt_count>=0),
  PRIMARY KEY(user_id,utc_day)
);
CREATE TABLE public.mmi_public_scoring_response_admissions (
  response_id uuid PRIMARY KEY REFERENCES public.candidate_mmi_station_responses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_admitted_at timestamptz NOT NULL
);
CREATE INDEX mmi_public_scoring_account_days_day_idx ON public.mmi_public_scoring_account_days(utc_day);
CREATE INDEX mmi_public_scoring_response_admissions_time_idx ON public.mmi_public_scoring_response_admissions(first_admitted_at);
ALTER TABLE public.mmi_public_scoring_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_public_scoring_daily_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_public_scoring_account_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mmi_public_scoring_response_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mmi_public_scoring_limits,public.mmi_public_scoring_daily_totals,
  public.mmi_public_scoring_account_days,public.mmi_public_scoring_response_admissions
  FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.mmi_public_scoring_limits(singleton) VALUES(true);

-- Seed known prior admissions rather than silently resetting today's usage.
-- Existing metered attempts and retained retry-attempt rows overlap by lease;
-- snapshot their union once, using metadata only. Global totals have no user FK
-- so account deletion cannot refund the shared day allowance.
CREATE TEMP TABLE mmi_public_scoring_bootstrap ON COMMIT DROP AS
SELECT DISTINCT ON(lease_token) lease_token,user_id,response_id,claimed_at
FROM (
  SELECT lease_token,user_id,response_id,created_at AS claimed_at FROM public.mmi_ai_usage_events
  WHERE created_at>=(((clock_timestamp() AT TIME ZONE 'UTC')::date-7)::timestamp AT TIME ZONE 'UTC')
  UNION ALL
  SELECT lease_token,user_id,response_id,claimed_at FROM public.mmi_paid_scoring_claim_attempts
  WHERE claimed_at>=(((clock_timestamp() AT TIME ZONE 'UTC')::date-7)::timestamp AT TIME ZONE 'UTC')
) prior ORDER BY lease_token,claimed_at;
ALTER TABLE mmi_public_scoring_bootstrap ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE mmi_public_scoring_bootstrap FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.mmi_public_scoring_response_admissions(response_id,user_id,first_admitted_at)
SELECT response_id,user_id,min(claimed_at) FROM mmi_public_scoring_bootstrap GROUP BY response_id,user_id;
INSERT INTO public.mmi_public_scoring_daily_totals(utc_day,attempt_count)
SELECT (claimed_at AT TIME ZONE 'UTC')::date,count(*)::integer FROM mmi_public_scoring_bootstrap GROUP BY 1;
INSERT INTO public.mmi_public_scoring_account_days(user_id,utc_day,response_count,attempt_count)
SELECT bootstrap.user_id,(bootstrap.claimed_at AT TIME ZONE 'UTC')::date,
  count(DISTINCT bootstrap.response_id) FILTER(WHERE (admission.first_admitted_at AT TIME ZONE 'UTC')::date=(bootstrap.claimed_at AT TIME ZONE 'UTC')::date)::integer,
  count(*)::integer
FROM mmi_public_scoring_bootstrap bootstrap
JOIN public.mmi_public_scoring_response_admissions admission ON admission.response_id=bootstrap.response_id
GROUP BY bootstrap.user_id,(bootstrap.claimed_at AT TIME ZONE 'UTC')::date;

-- The reviewed current claim body follows, with admission inserted immediately
-- before a new durable paid lease. Existing terminal, ownership, privacy,
-- snapshot, duplicate-lease, and per-response retry behavior is preserved.

CREATE OR REPLACE FUNCTION public.claim_candidate_mmi_response_scoring(
  p_user_id uuid,
  p_session_id uuid,
  p_prompt_order smallint,
  p_lease_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_session public.candidate_mmi_station_sessions;
  v_response public.candidate_mmi_station_responses;
  v_snapshot public.candidate_mmi_station_prompt_snapshots;
  v_claim public.candidate_mmi_response_scoring_claims;
  v_claim_exists boolean := false;
  v_criteria jsonb;
  v_recent_claim_count integer;
  v_earliest_claim_at timestamptz;
  v_retry_at timestamptz;
  v_retry_after_seconds integer;
  v_limits public.mmi_public_scoring_limits;
  v_day date;
  v_account_attempts integer;
  v_account_responses integer;
  v_global_attempts integer;
  v_active_claims integer;
  v_new_response boolean;
  v_known_cost numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'service role required';
  END IF;
  IF p_user_id IS NULL OR p_session_id IS NULL OR p_prompt_order IS NULL OR p_prompt_order NOT BETWEEN 1 AND 5 OR p_lease_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_candidate_mmi_scoring_claim';
  END IF;

  -- One shared lock serializes every candidate paid admission before any
  -- session/response locks. It is released before the provider HTTP request.
  PERFORM pg_advisory_xact_lock(hashtextextended('mmi-public-scoring-admission',0));
  v_now:=clock_timestamp();
  v_day:=(v_now AT TIME ZONE 'UTC')::date;

  SELECT * INTO v_session
  FROM public.candidate_mmi_station_sessions
  WHERE id = p_session_id AND user_id = p_user_id AND abandoned_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_response_not_found';
  END IF;
  IF v_now < v_session.started_at + interval '660 seconds' THEN
    RETURN jsonb_build_object('status', 'not_ready');
  END IF;

  PERFORM public.catch_up_candidate_mmi_station_responses(p_session_id, v_now);
  IF (SELECT count(*) FROM public.candidate_mmi_station_responses WHERE session_id = p_session_id) <> 5 THEN
    RETURN jsonb_build_object('status', 'not_ready');
  END IF;

  SELECT * INTO v_response
  FROM public.candidate_mmi_station_responses
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'candidate_response_not_found';
  END IF;
  IF v_response.response_state = 'no_response' THEN
    RETURN jsonb_build_object('status', 'no_response');
  END IF;
  IF v_response.scoring_status = 'scored' THEN
    RETURN jsonb_build_object('status', 'scored');
  END IF;

  SELECT * INTO v_snapshot
  FROM public.candidate_mmi_station_prompt_snapshots
  WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
  v_criteria := v_snapshot.rubric_snapshot->'criteria';
  IF NOT FOUND
    OR v_session.scenario_text_snapshot IS NULL
    OR (v_snapshot.scoring_contract_snapshot->>'version') IS DISTINCT FROM '2026-09-10.1'
    OR jsonb_typeof(v_criteria) IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_criteria) < 1 THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  SELECT * INTO v_claim
  FROM public.candidate_mmi_response_scoring_claims
  WHERE response_id = v_response.id
  FOR UPDATE;
  v_claim_exists := FOUND;

  -- The privacy cutoff outranks a live paid-scoring lease.
  IF v_response.finalized_at <= v_now - interval '23 hours 30 minutes' THEN
    IF v_response.scoring_status = 'in_progress' THEN
      UPDATE public.candidate_mmi_station_responses
      SET scoring_status = 'failed'
      WHERE id = v_response.id;
    END IF;
    IF v_claim_exists THEN
      UPDATE public.candidate_mmi_response_scoring_claims
      SET lease_expires_at = LEAST(lease_expires_at, v_now),
          last_error_code = 'retention_cutoff',
          updated_at = v_now
      WHERE response_id = v_response.id;
    END IF;
    UPDATE public.candidate_mmi_station_responses
    SET finalized_transcript = NULL,
        transcript_purged_at = v_now,
        scoring_status = 'feedback_unavailable'
    WHERE id = v_response.id
      AND scoring_status IN ('pending', 'failed');
    DELETE FROM public.candidate_mmi_station_response_drafts
    WHERE session_id = p_session_id AND prompt_order = p_prompt_order;
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  IF v_claim_exists AND v_claim.lease_expires_at > v_now AND v_response.scoring_status = 'in_progress' THEN
    RETURN jsonb_build_object('status', 'in_progress');
  END IF;
  IF v_response.finalized_transcript IS NULL THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  DELETE FROM public.mmi_paid_scoring_claim_attempts
  WHERE response_id = v_response.id
    AND user_id = p_user_id
    AND claimed_at <= v_now - interval '1 hour';

  SELECT count(*)::integer, min(claimed_at)
  INTO v_recent_claim_count, v_earliest_claim_at
  FROM public.mmi_paid_scoring_claim_attempts
  WHERE response_id = v_response.id
    AND user_id = p_user_id;

  IF v_recent_claim_count >= 3 THEN
    v_retry_at := v_earliest_claim_at + interval '1 hour';
    v_retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(epoch FROM (v_retry_at - v_now)))::integer
    );
    RETURN jsonb_build_object(
      'status', 'rate_limited',
      'retryAfterSeconds', v_retry_after_seconds,
      'retryAt', v_retry_at
    );
  END IF;

  SELECT * INTO v_limits FROM public.mmi_public_scoring_limits WHERE singleton FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','rate_limited','retryAfterSeconds',3600,'retryAt',v_now+interval '1 hour');
  END IF;
  SELECT COALESCE((SELECT attempt_count FROM public.mmi_public_scoring_daily_totals WHERE utc_day=v_day),0)
  INTO v_global_attempts;
  SELECT COALESCE((SELECT attempt_count FROM public.mmi_public_scoring_account_days WHERE user_id=p_user_id AND utc_day=v_day),0),
         COALESCE((SELECT response_count FROM public.mmi_public_scoring_account_days WHERE user_id=p_user_id AND utc_day=v_day),0)
  INTO v_account_attempts,v_account_responses;
  v_new_response:=NOT EXISTS(SELECT 1 FROM public.mmi_public_scoring_response_admissions WHERE response_id=v_response.id AND user_id=p_user_id);
  v_known_cost:=0;
  IF v_limits.daily_known_cost_limit_usd IS NOT NULL THEN
    SELECT COALESCE(sum(estimated_cost),0) INTO v_known_cost FROM public.mmi_ai_usage_events
    WHERE created_at >= v_day::timestamp AT TIME ZONE 'UTC' AND created_at<=v_now;
  END IF;
  IF v_limits.scoring_paused
    OR v_account_attempts>=v_limits.attempts_per_account_day
    OR (v_new_response AND v_account_responses>=v_limits.responses_per_account_day)
    OR v_global_attempts>=v_limits.claims_per_day
    OR (v_limits.daily_known_cost_limit_usd IS NOT NULL AND v_known_cost>=v_limits.daily_known_cost_limit_usd) THEN
    v_retry_at:=(v_day+1)::timestamp AT TIME ZONE 'UTC';
    v_retry_after_seconds:=LEAST(3600,GREATEST(1,CEIL(EXTRACT(epoch FROM v_retry_at-v_now))::integer));
    RETURN jsonb_build_object('status','rate_limited','retryAfterSeconds',v_retry_after_seconds,'retryAt',v_retry_at);
  END IF;
  SELECT count(*)::integer INTO v_active_claims
  FROM public.candidate_mmi_response_scoring_claims claim
  JOIN public.candidate_mmi_station_responses response ON response.id=claim.response_id
  WHERE claim.lease_expires_at>v_now AND response.scoring_status='in_progress';
  IF v_active_claims>=v_limits.concurrent_claims THEN
    RETURN jsonb_build_object('status','rate_limited','retryAfterSeconds',15,'retryAt',v_now+interval '15 seconds');
  END IF;

  INSERT INTO public.mmi_paid_scoring_claim_attempts(
    lease_token, user_id, response_id, claimed_at
  ) VALUES (
    p_lease_token, p_user_id, v_response.id, v_now
  );

  IF v_claim_exists THEN
    UPDATE public.candidate_mmi_response_scoring_claims
    SET lease_token = p_lease_token,
        lease_expires_at = v_now + interval '5 minutes',
        attempt_count = attempt_count + 1,
        last_error_code = NULL,
        updated_at = v_now
    WHERE response_id = v_response.id;
  ELSE
    INSERT INTO public.candidate_mmi_response_scoring_claims(
      response_id,
      lease_token,
      lease_expires_at,
      attempt_count,
      last_error_code,
      updated_at
    ) VALUES (
      v_response.id,
      p_lease_token,
      v_now + interval '5 minutes',
      1,
      NULL,
      v_now
    );
  END IF;

  -- Reservation and lease commit together. Retries of an admitted response
  -- never consume a second distinct-response slot, including across UTC dates;
  -- every newly issued paid lease still consumes account/global attempts.
  IF v_new_response THEN
    INSERT INTO public.mmi_public_scoring_response_admissions(response_id,user_id,first_admitted_at)
    VALUES(v_response.id,p_user_id,v_now);
  END IF;
  INSERT INTO public.mmi_public_scoring_daily_totals(utc_day,attempt_count) VALUES(v_day,1)
  ON CONFLICT(utc_day) DO UPDATE SET attempt_count=public.mmi_public_scoring_daily_totals.attempt_count+1;
  INSERT INTO public.mmi_public_scoring_account_days(user_id,utc_day,response_count,attempt_count)
  VALUES(p_user_id,v_day,CASE WHEN v_new_response THEN 1 ELSE 0 END,1)
  ON CONFLICT(user_id,utc_day) DO UPDATE
  SET response_count=public.mmi_public_scoring_account_days.response_count+EXCLUDED.response_count,
      attempt_count=public.mmi_public_scoring_account_days.attempt_count+1;

  UPDATE public.candidate_mmi_station_responses
  SET scoring_status = 'in_progress'
  WHERE id = v_response.id
    AND scoring_status IN ('pending', 'failed', 'feedback_unavailable');

  RETURN jsonb_build_object(
    'status', 'claimed',
    'responseId', v_response.id,
    'sessionId', p_session_id,
    'promptOrder', p_prompt_order,
    'scenarioText', v_session.scenario_text_snapshot,
    'promptText', v_snapshot.prompt_text,
    'transcript', v_response.finalized_transcript,
    'criteria', v_criteria,
    'scoringContractVersion', '2026-09-10.1'
  );
END;
$function$;

ALTER FUNCTION public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid) TO service_role;

CREATE FUNCTION public.get_candidate_mmi_scoring_allowance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE
  v_user_id uuid:=auth.uid();
  v_now timestamptz:=clock_timestamp();
  v_day date:=(v_now AT TIME ZONE 'UTC')::date;
  v_limits public.mmi_public_scoring_limits;
  v_responses integer:=0;
  v_attempts integer:=0;
  v_global integer;
  v_active integer;
  v_cost numeric:=0;
  v_available boolean:=false;
  v_paused boolean:=true;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_user_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authenticated account required';
  END IF;
  SELECT * INTO v_limits FROM public.mmi_public_scoring_limits WHERE singleton;
  IF FOUND THEN
    SELECT GREATEST(0,v_limits.responses_per_account_day-COALESCE((SELECT response_count FROM public.mmi_public_scoring_account_days WHERE user_id=v_user_id AND utc_day=v_day),0)),
      GREATEST(0,v_limits.attempts_per_account_day-COALESCE((SELECT attempt_count FROM public.mmi_public_scoring_account_days WHERE user_id=v_user_id AND utc_day=v_day),0))
    INTO v_responses,v_attempts;
    SELECT COALESCE((SELECT attempt_count FROM public.mmi_public_scoring_daily_totals WHERE utc_day=v_day),0) INTO v_global;
    SELECT count(*)::integer INTO v_active FROM public.candidate_mmi_response_scoring_claims claim
      JOIN public.candidate_mmi_station_responses response ON response.id=claim.response_id
      WHERE claim.lease_expires_at>v_now AND response.scoring_status='in_progress';
    IF v_limits.daily_known_cost_limit_usd IS NOT NULL THEN
      SELECT COALESCE(sum(estimated_cost),0) INTO v_cost FROM public.mmi_ai_usage_events
      WHERE created_at>=v_day::timestamp AT TIME ZONE 'UTC' AND created_at<=v_now;
    END IF;
    v_paused:=v_limits.scoring_paused;
    v_available:=NOT v_paused AND v_global<v_limits.claims_per_day AND v_active<v_limits.concurrent_claims
      AND (v_limits.daily_known_cost_limit_usd IS NULL OR v_cost<v_limits.daily_known_cost_limit_usd);
  END IF;
  -- Advisory snapshot only; admission is still rechecked atomically at claim.
  RETURN jsonb_build_object('checkedAt',v_now,'resetsAt',(v_day+1)::timestamp AT TIME ZONE 'UTC',
    'responsesRemaining',v_responses,'attemptsRemaining',v_attempts,
    'stationAllowanceRemaining',v_responses/5,'scoringPaused',v_paused,'globalCapacityAvailable',v_available);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_candidate_mmi_scoring_allowance() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_candidate_mmi_scoring_allowance() TO authenticated;

CREATE FUNCTION public.purge_mmi_public_scoring_counters_internal()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $function$
DECLARE v_cutoff date:=(clock_timestamp() AT TIME ZONE 'UTC')::date-7; v_count integer; v_total integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('mmi-public-scoring-admission',0));
  DELETE FROM public.mmi_public_scoring_response_admissions WHERE first_admitted_at<v_cutoff::timestamp AT TIME ZONE 'UTC';
  GET DIAGNOSTICS v_count=ROW_COUNT; v_total:=v_total+v_count;
  DELETE FROM public.mmi_public_scoring_account_days WHERE utc_day<v_cutoff;
  GET DIAGNOSTICS v_count=ROW_COUNT; v_total:=v_total+v_count;
  DELETE FROM public.mmi_public_scoring_daily_totals WHERE utc_day<v_cutoff;
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_total+v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_mmi_public_scoring_counters_internal() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('mmi-purge-public-scoring-counters','0 0 * * *','SELECT public.purge_mmi_public_scoring_counters_internal();');

DO $postconditions$
DECLARE role_ text; table_ text;
BEGIN
  FOREACH table_ IN ARRAY ARRAY['mmi_public_scoring_limits','mmi_public_scoring_daily_totals','mmi_public_scoring_account_days','mmi_public_scoring_response_admissions'] LOOP
    IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||table_)::regclass) THEN RAISE EXCEPTION 'Public scoring RLS missing'; END IF;
    FOREACH role_ IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
      IF has_table_privilege(role_,('public.'||table_)::regclass,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'Public scoring table grant widened'; END IF;
    END LOOP;
  END LOOP;
  FOREACH role_ IN ARRAY ARRAY['public','anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_,'public.purge_mmi_public_scoring_counters_internal()','EXECUTE') THEN RAISE EXCEPTION 'Public scoring cleanup exposed'; END IF;
  END LOOP;
  IF has_function_privilege('public','public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid)','EXECUTE')
    OR has_function_privilege('anon','public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.claim_candidate_mmi_response_scoring(uuid,uuid,smallint,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Scoring claim privilege boundary changed'; END IF;
  IF has_function_privilege('public','public.get_candidate_mmi_scoring_allowance()','EXECUTE')
    OR has_function_privilege('anon','public.get_candidate_mmi_scoring_allowance()','EXECUTE')
    OR has_function_privilege('service_role','public.get_candidate_mmi_scoring_allowance()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.get_candidate_mmi_scoring_allowance()','EXECUTE') THEN RAISE EXCEPTION 'Self allowance privilege boundary failed'; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='mmi-purge-public-scoring-counters' AND active AND schedule='0 0 * * *' AND command='SELECT public.purge_mmi_public_scoring_counters_internal();')<>1 THEN RAISE EXCEPTION 'Public scoring cleanup job missing'; END IF;
END;
$postconditions$;
COMMIT;
