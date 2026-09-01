-- Operate candidate transcript retention through one least-privilege hourly pg_cron job.
BEGIN;

CREATE OR REPLACE FUNCTION public.purge_expired_candidate_mmi_free_text_internal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN public.purge_expired_candidate_mmi_free_text(clock_timestamp());
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_candidate_mmi_free_text_internal()
  FROM PUBLIC, anon, authenticated, service_role;

DO $schedule$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'candidate MMI transcript retention requires pg_cron';
  END IF;

  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'candidate-mmi-purge-expired-free-text'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'candidate-mmi-purge-expired-free-text',
    '23 * * * *',
    'SELECT public.purge_expired_candidate_mmi_free_text_internal();'
  );
END;
$schedule$;

DO $postconditions$
DECLARE
  v_owner text;
  v_security_definer boolean;
  v_config text[];
BEGIN
  SELECT pg_get_userbyid(proowner), prosecdef, proconfig
  INTO v_owner, v_security_definer, v_config
  FROM pg_proc
  WHERE oid = 'public.purge_expired_candidate_mmi_free_text_internal()'::regprocedure;

  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM true
    OR v_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'candidate MMI retention operator function hardening is incomplete';
  END IF;

  IF has_function_privilege('public', 'public.purge_expired_candidate_mmi_free_text_internal()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.purge_expired_candidate_mmi_free_text_internal()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.purge_expired_candidate_mmi_free_text_internal()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.purge_expired_candidate_mmi_free_text_internal()', 'EXECUTE') THEN
    RAISE EXCEPTION 'candidate MMI retention operator function exposes unexpected execution privileges';
  END IF;

  IF (
    SELECT count(*)
    FROM cron.job
    WHERE jobname = 'candidate-mmi-purge-expired-free-text'
  ) <> 1 THEN
    RAISE EXCEPTION 'candidate MMI retention schedule is missing or duplicated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'candidate-mmi-purge-expired-free-text'
      AND schedule = '23 * * * *'
      AND command = 'SELECT public.purge_expired_candidate_mmi_free_text_internal();'
      AND active
  ) THEN
    RAISE EXCEPTION 'candidate MMI retention schedule contract is incorrect';
  END IF;
END;
$postconditions$;

COMMIT;
