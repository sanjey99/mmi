-- HOSTED-ONLY cofounder preview security reconciliation.
--
-- Do not run supabase db push for this file. It is deliberately outside the
-- migration chain so the exact hosted catalog must be checked and this exact
-- transaction separately approved before execution. It changes no rows and
-- deletes no database object.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_table text;
  v_column text;
  v_policy_count integer;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'app_config',
    'profiles',
    'mmi_stations',
    'mmi_sub_questions',
    'roleplay_stations',
    'mmi_marking_criteria',
    'roleplay_end_criteria',
    'roleplay_mark_domains',
    'roleplay_response_rules'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'required hosted table public.% is missing', v_table;
    END IF;
  END LOOP;

  FOR v_table, v_column IN
    SELECT required.table_name, required.column_name
    FROM (VALUES
      ('profiles', 'id'),
      ('profiles', 'is_admin'),
      ('app_config', 'key'),
      ('app_config', 'value'),
      ('app_config', 'updated_at')
    ) AS required(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table
        AND column_name = v_column
    ) THEN
      RAISE EXCEPTION 'required hosted column public.%.% is missing', v_table, v_column;
    END IF;
  END LOOP;

  SELECT count(*)
  INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'app_config';

  IF v_policy_count <> 4 OR EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_config'
      AND (
        policyname NOT IN (
          'app_config_read_non_secret',
          'app_config_insert_admin',
          'app_config_update_admin',
          'app_config_delete_admin'
        )
        OR cmd <> CASE policyname
          WHEN 'app_config_read_non_secret' THEN 'SELECT'
          WHEN 'app_config_insert_admin' THEN 'INSERT'
          WHEN 'app_config_update_admin' THEN 'UPDATE'
          WHEN 'app_config_delete_admin' THEN 'DELETE'
        END
      )
  ) THEN
    RAISE EXCEPTION 'app_config policy set differs from the reviewed hosted snapshot';
  END IF;
END;
$$;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

ALTER POLICY app_config_read_non_secret
  ON public.app_config
  TO authenticated
  USING (auth.role() = 'authenticated' AND key <> 'ai_api_key');

ALTER POLICY app_config_insert_admin
  ON public.app_config
  TO authenticated
  WITH CHECK (
    key <> 'ai_api_key'
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.is_admin IS TRUE
    )
  );

ALTER POLICY app_config_update_admin
  ON public.app_config
  TO authenticated
  USING (
    key <> 'ai_api_key'
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.is_admin IS TRUE
    )
  )
  WITH CHECK (
    key <> 'ai_api_key'
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.is_admin IS TRUE
    )
  );

ALTER POLICY app_config_delete_admin
  ON public.app_config
  TO authenticated
  USING (
    key <> 'ai_api_key'
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.is_admin IS TRUE
    )
  );

DO $$
DECLARE
  v_policy_count integer;
BEGIN
  SELECT count(*)
  INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'app_config'
    AND roles = ARRAY['authenticated'::name];

  IF v_policy_count <> 4
    OR NOT EXISTS (
      SELECT 1
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'app_config'
        AND c.relrowsecurity
    )
    OR EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'app_config'
        AND CASE policyname
          WHEN 'app_config_read_non_secret' THEN
            cmd <> 'SELECT'
            OR position('ai_api_key' IN COALESCE(qual, '')) = 0
            OR with_check IS NOT NULL
          WHEN 'app_config_insert_admin' THEN
            cmd <> 'INSERT'
            OR qual IS NOT NULL
            OR position('is_admin' IN COALESCE(with_check, '')) = 0
            OR position('profiles' IN COALESCE(with_check, '')) = 0
            OR position('auth.uid' IN COALESCE(with_check, '')) = 0
            OR position('ai_api_key' IN COALESCE(with_check, '')) = 0
          WHEN 'app_config_update_admin' THEN
            cmd <> 'UPDATE'
            OR position('is_admin' IN COALESCE(qual, '')) = 0
            OR position('profiles' IN COALESCE(qual, '')) = 0
            OR position('auth.uid' IN COALESCE(qual, '')) = 0
            OR position('ai_api_key' IN COALESCE(qual, '')) = 0
            OR position('is_admin' IN COALESCE(with_check, '')) = 0
            OR position('profiles' IN COALESCE(with_check, '')) = 0
            OR position('auth.uid' IN COALESCE(with_check, '')) = 0
            OR position('ai_api_key' IN COALESCE(with_check, '')) = 0
          WHEN 'app_config_delete_admin' THEN
            cmd <> 'DELETE'
            OR position('is_admin' IN COALESCE(qual, '')) = 0
            OR position('profiles' IN COALESCE(qual, '')) = 0
            OR position('auth.uid' IN COALESCE(qual, '')) = 0
            OR position('ai_api_key' IN COALESCE(qual, '')) = 0
            OR with_check IS NOT NULL
          ELSE TRUE
        END
    )
  THEN
    RAISE EXCEPTION 'app_config policy reconciliation postcondition failed';
  END IF;
END;
$$;

-- Remove table-level and independently granted column privileges before
-- restoring the exact browser surface required by the hardened policies.
DO $$
DECLARE
  v_table text;
  v_columns text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'app_config',
    'mmi_stations',
    'mmi_sub_questions',
    'roleplay_stations',
    'mmi_marking_criteria',
    'roleplay_end_criteria',
    'roleplay_mark_domains',
    'roleplay_response_rules'
  ]
  LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_table;

    EXECUTE format(
      'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
      v_columns,
      v_table
    );
  END LOOP;
END;
$$;

-- Normalize the privileged Edge surface separately from browser ACLs. Column
-- revokes are explicit because REVOKE ALL ON TABLE does not remove grants made
-- directly on individual columns.
DO $$
DECLARE
  v_table text;
  v_columns text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['profiles', 'app_config']
  LOOP
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_table;

    EXECUTE format(
      'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE public.%2$I FROM service_role',
      v_columns,
      v_table
    );
  END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.profiles FROM service_role;
GRANT SELECT (id, is_admin) ON TABLE public.profiles TO service_role;

REVOKE ALL ON TABLE public.app_config FROM service_role;
GRANT SELECT (key, value), INSERT (key, value), UPDATE (key, value)
  ON TABLE public.app_config TO service_role;

REVOKE ALL ON TABLE public.app_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_config TO authenticated;

REVOKE ALL ON TABLE public.mmi_stations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mmi_sub_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.roleplay_stations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mmi_marking_criteria FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.roleplay_end_criteria FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.roleplay_mark_domains FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.roleplay_response_rules FROM PUBLIC, anon, authenticated;

-- Check effective Edge privileges only after every browser table grant has
-- reached its final state in this transaction.
DO $$
DECLARE
  v_column text;
  v_privilege text;
BEGIN
  FOREACH v_privilege IN ARRAY ARRAY[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ]
  LOOP
    IF has_table_privilege('service_role', 'public.profiles', v_privilege)
      OR has_table_privilege('service_role', 'public.app_config', v_privilege)
    THEN
      RAISE EXCEPTION 'service-role Edge ACL postcondition failed: table privilege % remains', v_privilege;
    END IF;
  END LOOP;

  IF NOT has_column_privilege('service_role', 'public.profiles', 'id', 'SELECT')
    OR NOT has_column_privilege('service_role', 'public.profiles', 'is_admin', 'SELECT')
    OR has_any_column_privilege('service_role', 'public.profiles', 'INSERT')
    OR has_any_column_privilege('service_role', 'public.profiles', 'UPDATE')
    OR has_any_column_privilege('service_role', 'public.profiles', 'REFERENCES')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'key', 'SELECT')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'value', 'SELECT')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'key', 'INSERT')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'value', 'INSERT')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'key', 'UPDATE')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'value', 'UPDATE')
    OR has_any_column_privilege('service_role', 'public.app_config', 'REFERENCES')
  THEN
    RAISE EXCEPTION 'service-role Edge ACL postcondition failed: required column privilege differs';
  END IF;

  FOR v_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name NOT IN ('id', 'is_admin')
  LOOP
    IF has_column_privilege('service_role', 'public.profiles', v_column, 'SELECT') THEN
      RAISE EXCEPTION 'service-role Edge ACL postcondition failed: unexpected profiles SELECT on %', v_column;
    END IF;
  END LOOP;

  FOR v_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'app_config'
      AND column_name NOT IN ('key', 'value')
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    LOOP
      IF has_column_privilege('service_role', 'public.app_config', v_column, v_privilege) THEN
        RAISE EXCEPTION 'service-role Edge ACL postcondition failed: unexpected app_config % on %', v_privilege, v_column;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_table text;
  v_role text;
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.app_config', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.app_config', 'INSERT')
    OR NOT has_table_privilege('authenticated', 'public.app_config', 'UPDATE')
    OR NOT has_table_privilege('authenticated', 'public.app_config', 'DELETE')
    OR has_table_privilege('authenticated', 'public.app_config', 'TRUNCATE')
    OR has_table_privilege('authenticated', 'public.app_config', 'REFERENCES')
    OR has_table_privilege('authenticated', 'public.app_config', 'TRIGGER')
    OR has_table_privilege('anon', 'public.app_config', 'SELECT')
    OR has_table_privilege('anon', 'public.app_config', 'INSERT')
    OR has_table_privilege('anon', 'public.app_config', 'UPDATE')
    OR has_table_privilege('anon', 'public.app_config', 'DELETE')
    OR has_table_privilege('anon', 'public.app_config', 'TRUNCATE')
    OR has_table_privilege('anon', 'public.app_config', 'REFERENCES')
    OR has_table_privilege('anon', 'public.app_config', 'TRIGGER')
    OR has_any_column_privilege('anon', 'public.app_config', 'SELECT')
    OR has_any_column_privilege('anon', 'public.app_config', 'INSERT')
    OR has_any_column_privilege('anon', 'public.app_config', 'UPDATE')
    OR has_any_column_privilege('anon', 'public.app_config', 'REFERENCES')
  THEN
    RAISE EXCEPTION 'app_config ACL postcondition failed';
  END IF;

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
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF has_table_privilege(v_role, 'public.' || v_table, 'SELECT')
        OR has_table_privilege(v_role, 'public.' || v_table, 'INSERT')
        OR has_table_privilege(v_role, 'public.' || v_table, 'UPDATE')
        OR has_table_privilege(v_role, 'public.' || v_table, 'DELETE')
        OR has_table_privilege(v_role, 'public.' || v_table, 'TRUNCATE')
        OR has_table_privilege(v_role, 'public.' || v_table, 'REFERENCES')
        OR has_table_privilege(v_role, 'public.' || v_table, 'TRIGGER')
        OR has_any_column_privilege(v_role, 'public.' || v_table, 'SELECT')
        OR has_any_column_privilege(v_role, 'public.' || v_table, 'INSERT')
        OR has_any_column_privilege(v_role, 'public.' || v_table, 'UPDATE')
        OR has_any_column_privilege(v_role, 'public.' || v_table, 'REFERENCES')
      THEN
        RAISE EXCEPTION 'assessor table ACL postcondition failed for public.% role %', v_table, v_role;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

COMMIT;
