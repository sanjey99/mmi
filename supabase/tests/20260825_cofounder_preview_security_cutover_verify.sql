-- LOCAL-ONLY final hostile verification. Run only after migration 040.
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
  v_policy_qual text;
  v_policy_check text;
BEGIN
  SELECT qual, with_check
  INTO v_policy_qual, v_policy_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'questions'
    AND policyname = 'questions_write_admin';

  IF v_policy_qual IS NULL
    OR v_policy_check IS NULL
    OR v_policy_qual ~ 'is_admin[[:space:]]*\('
    OR v_policy_check ~ 'is_admin[[:space:]]*\('
    OR position('p.is_admin' IN v_policy_qual) = 0
    OR position('p.is_admin' IN v_policy_check) = 0
  THEN
    RAISE EXCEPTION 'hostile cutover policy proof failed: questions_write_admin still calls is_admin()';
  END IF;
END;
$$;

DO $$
DECLARE
  v_rpc record;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
BEGIN
  FOR v_rpc IN
    SELECT * FROM (VALUES
      ('public.claim_legacy_scoring(uuid,uuid,uuid,text,text,uuid)'),
      ('public.complete_legacy_scoring(uuid,uuid,uuid,text,text,smallint,smallint,smallint,smallint,smallint,text,text)'),
      ('public.fail_legacy_scoring(uuid,uuid,uuid,text)')
    ) AS required(signature)
  LOOP
    SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_owner, v_security_definer, v_config
    FROM pg_proc AS p WHERE p.oid = to_regprocedure(v_rpc.signature);
    IF v_owner <> 'postgres'
      OR v_security_definer IS DISTINCT FROM TRUE
      OR NOT (COALESCE(v_config, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public'])
      OR NOT has_function_privilege('service_role', v_rpc.signature, 'EXECUTE')
      OR has_function_privilege('anon', v_rpc.signature, 'EXECUTE')
      OR has_function_privilege('authenticated', v_rpc.signature, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'hostile scoring RPC proof failed for %', v_rpc.signature;
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF has_function_privilege(v_role, 'public.handle_new_user()', 'EXECUTE')
      OR has_function_privilege(v_role, 'public.update_streak(uuid)', 'EXECUTE')
      OR has_function_privilege(v_role, 'public.is_admin()', 'EXECUTE')
    THEN
      RAISE EXCEPTION 'hostile helper ACL proof failed after 040 for %', v_role;
    END IF;
  END LOOP;
END;
$$;
