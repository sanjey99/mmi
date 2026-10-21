-- Read-only, self-scoped practice activity. A station is finished once all five
-- responses are finalized, including no-response outcomes. Provider success is
-- deliberately irrelevant to practice completion. Completion time is the last
-- response's finalized_at, rather than the session's start or scoring time.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.profiles') IS NULL
    OR to_regclass('public.candidate_mmi_station_sessions') IS NULL
    OR to_regclass('public.candidate_mmi_station_responses') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'Candidate MMI activity summary dependencies are missing';
  END IF;
  IF to_regprocedure('public.get_candidate_mmi_activity_summary()') IS NOT NULL THEN
    RAISE EXCEPTION 'Candidate MMI activity summary already exists';
  END IF;
END; $$;

CREATE FUNCTION public.get_candidate_mmi_activity_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
SET timezone='UTC'
AS $function$
DECLARE
  v_user_id uuid:=auth.uid();
  v_now timestamptz:=clock_timestamp();
  v_today date:=(v_now AT TIME ZONE 'UTC')::date;
  v_summary jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_user_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authenticated account required';
  END IF;
  WITH completed AS (
    SELECT session.id,max(response.finalized_at) AS completed_at
    FROM public.candidate_mmi_station_sessions AS session
    JOIN public.candidate_mmi_station_responses AS response ON response.session_id=session.id
    WHERE session.user_id=v_user_id AND session.abandoned_at IS NULL
    GROUP BY session.id
    HAVING count(*)=5 AND count(response.finalized_at)=5
      AND count(DISTINCT response.prompt_order)=5
      AND min(response.prompt_order)=1 AND max(response.prompt_order)=5
      AND max(response.finalized_at)<=v_now
  ), completion_days AS (
    SELECT DISTINCT (completed_at AT TIME ZONE 'UTC')::date AS completed_day FROM completed
  ), ordered_days AS (
    SELECT completed_day,row_number() OVER(ORDER BY completed_day DESC) AS ordinal,
      max(completed_day) OVER() AS anchor FROM completion_days
  ), streak_groups AS (
    SELECT count(*) AS days FROM ordered_days GROUP BY completed_day+ordinal::integer
  )
  SELECT jsonb_build_object(
    'completedToday',count(*) FILTER(WHERE (completed_at AT TIME ZONE 'UTC')::date=v_today),
    'completedTotal',count(*),
    -- A run of days remains current before today's first practice if its last
    -- completion was yesterday. A missing full UTC day breaks the streak.
    'streakCurrent',(SELECT count(*) FROM ordered_days
      WHERE anchor IN(v_today,v_today-1) AND completed_day=anchor-(ordinal-1)::integer),
    'streakLongest',COALESCE((SELECT max(days) FROM streak_groups),0),
    'latestCompletedAt',max(completed_at)
  ) INTO v_summary FROM completed;
  RETURN v_summary;
END;
$function$;
ALTER FUNCTION public.get_candidate_mmi_activity_summary() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_candidate_mmi_activity_summary() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_candidate_mmi_activity_summary() TO authenticated;

DO $$ BEGIN
  IF has_function_privilege('public','public.get_candidate_mmi_activity_summary()','EXECUTE')
    OR has_function_privilege('anon','public.get_candidate_mmi_activity_summary()','EXECUTE')
    OR has_function_privilege('service_role','public.get_candidate_mmi_activity_summary()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.get_candidate_mmi_activity_summary()','EXECUTE') THEN
    RAISE EXCEPTION 'Candidate MMI activity summary privilege boundary failed';
  END IF;
END; $$;
COMMIT;
