-- LOCAL-ONLY adversarial ACL proof for the cofounder preview hardening.
--
-- Run only against a disposable loopback Supabase database after setting
-- SUPABASE_LOCAL_MUTATION_TESTS=I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA. This
-- fixture deliberately leaves its synthetic proof user/profile and poisoned
-- ACLs in the local volume; never point it at hosted, shared, or production.
--
-- 1. Execute this fixture as local postgres.
-- 2. Execute ../reconciliation/20260825_cofounder_preview_security.sql.
-- 3. Execute the assertions below in the same disposable database.
-- 4. Execute migration 20260825004000_cofounder_preview_privilege_cutover.sql
--    and rerun the cutover assertions. Do not run this file through db push.

BEGIN;

DO $$
BEGIN
  IF current_setting('app.local_mmi_adversarial_proof', true)
      IS DISTINCT FROM 'I_UNDERSTAND_THIS_MUTATES_LOCAL_DATA' THEN
    RAISE EXCEPTION 'local adversarial proof guard is required';
  END IF;
END;
$$;

DO $$
DECLARE
  v_table text;
  v_column text;
  v_role text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'mmi_stations',
    'mmi_sub_questions',
    'roleplay_stations',
    'mmi_marking_criteria',
    'roleplay_end_criteria',
    'roleplay_mark_domains',
    'roleplay_response_rules'
  ]
  LOOP
    FOREACH v_role IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated', 'service_role']
    LOOP
      EXECUTE format(
        'GRANT ALL PRIVILEGES ON TABLE public.%I TO %s',
        v_table,
        CASE WHEN v_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(v_role) END
      );
    END LOOP;

    SELECT column_name INTO v_column
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_table
    ORDER BY ordinal_position
    LIMIT 1;

    IF v_column IS NULL THEN
      RAISE EXCEPTION 'local hostile fixture expected public.% to have a column', v_table;
    END IF;

    FOREACH v_role IN ARRAY ARRAY['PUBLIC', 'anon', 'authenticated', 'service_role']
    LOOP
      EXECUTE format(
        'GRANT SELECT (%I) ON TABLE public.%I TO %s',
        v_column, v_table,
        CASE WHEN v_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(v_role) END
      );
      EXECUTE format(
        'GRANT UPDATE (%I) ON TABLE public.%I TO %s',
        v_column, v_table,
        CASE WHEN v_role = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(v_role) END
      );
    END LOOP;
  END LOOP;
END;
$$;

-- The literal grants make the attack surface easy to inspect in code review;
-- the loop above performs the same poisoning across all seven tables.
GRANT ALL PRIVILEGES ON TABLE public.mmi_stations TO PUBLIC;
GRANT ALL PRIVILEGES ON TABLE public.mmi_stations TO anon;
GRANT ALL PRIVILEGES ON TABLE public.mmi_stations TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.mmi_stations TO service_role;
GRANT SELECT (id) ON TABLE public.mmi_stations TO PUBLIC;
GRANT SELECT (id) ON TABLE public.mmi_stations TO anon;
GRANT SELECT (id) ON TABLE public.mmi_stations TO authenticated;
GRANT SELECT (id) ON TABLE public.mmi_stations TO service_role;

-- Edge tables are poisoned only for service_role. Browser grants for profiles
-- are intentionally not changed at this pre-cutover stage because their
-- legacy RLS/browser surface is restored by 040, not reconciliation.
GRANT ALL PRIVILEGES ON TABLE public.profiles TO service_role;
GRANT SELECT (full_name), UPDATE (is_admin) ON TABLE public.profiles TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.app_config TO service_role;
GRANT SELECT (updated_at), UPDATE (updated_at) ON TABLE public.app_config TO service_role;

COMMIT;
