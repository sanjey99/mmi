-- LOCAL-ONLY hostile verification. Run this only after the fixture and the
-- hosted-only reconciliation, then rerun its final block after migration 040.
-- This intentionally creates and retains one synthetic auth user/profile.

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
  v_role text;
  v_privilege text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'mmi_stations', 'mmi_sub_questions', 'roleplay_stations',
    'mmi_marking_criteria', 'roleplay_end_criteria',
    'roleplay_mark_domains', 'roleplay_response_rules'
  ]
  LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
      FOREACH v_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ]
      LOOP
        IF has_table_privilege(v_role, 'public.' || v_table, v_privilege) THEN
          RAISE EXCEPTION 'hostile ACL proof failed: public.% retains table % for %',
            v_table, v_privilege, v_role;
        END IF;
      END LOOP;
      IF has_any_column_privilege(v_role, 'public.' || v_table, 'SELECT')
        OR has_any_column_privilege(v_role, 'public.' || v_table, 'INSERT')
        OR has_any_column_privilege(v_role, 'public.' || v_table, 'UPDATE')
        OR has_any_column_privilege(v_role, 'public.' || v_table, 'REFERENCES')
      THEN
        RAISE EXCEPTION 'hostile ACL proof failed: public.% retains a column grant for %', v_table, v_role;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

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
      RAISE EXCEPTION 'hostile Edge proof failed: table privilege % remains', v_privilege;
    END IF;
  END LOOP;
  IF NOT has_column_privilege('service_role', 'public.profiles', 'id', 'SELECT')
    OR NOT has_column_privilege('service_role', 'public.profiles', 'is_admin', 'SELECT')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'key', 'SELECT')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'value', 'SELECT')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'key', 'INSERT')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'value', 'INSERT')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'key', 'UPDATE')
    OR NOT has_column_privilege('service_role', 'public.app_config', 'value', 'UPDATE')
  THEN
    RAISE EXCEPTION 'hostile Edge proof failed: expected eight column grants differ';
  END IF;
  FOR v_column IN SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    LOOP
      IF has_column_privilege('service_role', 'public.profiles', v_column, v_privilege)
        AND NOT (v_privilege = 'SELECT' AND v_column IN ('id', 'is_admin'))
      THEN
        RAISE EXCEPTION 'hostile Edge proof failed: extra profiles % on %', v_privilege, v_column;
      END IF;
    END LOOP;
  END LOOP;
  FOR v_column IN SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_config'
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    LOOP
      IF has_column_privilege('service_role', 'public.app_config', v_column, v_privilege)
        AND NOT (v_column IN ('key', 'value') AND v_privilege IN ('SELECT', 'INSERT', 'UPDATE'))
      THEN
        RAISE EXCEPTION 'hostile Edge proof failed: extra app_config % on %', v_privilege, v_column;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.handle_new_user()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.update_streak(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.update_streak(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.update_streak(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'hostile helper ACL proof failed after reconciliation';
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data,
  raw_user_meta_data
)
VALUES (
  '00000000-0000-0000-0000-000000000403',
  '00000000-0000-0000-0000-000000000403',
  'authenticated', 'authenticated', 'acl-proof-403@example.test', 'not-a-login-secret',
  '{"provider":"email","providers":["email"]}', '{"full_name":"ACL proof"}'
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000403'
  ) THEN
    RAISE EXCEPTION 'hostile trigger proof failed: auth.users insert did not create profile';
  END IF;
END;
$$;
