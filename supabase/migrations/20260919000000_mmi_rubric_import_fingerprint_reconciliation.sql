BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The reviewed v2 artifact SHA-256 values remain unchanged. Reconcile only
-- the PostgreSQL jsonb::text fingerprints used by the import RPC and its
-- finalization ledger checks. Fail closed if either installed definition is
-- not the exact predecessor this migration was written for.
DO $reconcile$
DECLARE
  v_import_signature constant text :=
    'public.import_normalized_mmi_station_batch(text,text,text,jsonb)';
  v_finalize_signature constant text :=
    'public.finalize_normalized_mmi_station_import(text,text,text)';
  v_old_part_1 constant text :=
    '950e52261c043a819dab92183b423a15e43be1ac20e02c4e47927a7b10a0424e';
  v_old_part_2 constant text :=
    '31ba173facd961ef14a9258a41f101c3cebe087b581c481133db88ff9602832c';
  v_new_part_1 constant text :=
    'b94d0f3b9784062b9167551c80a7735d16ebbdc5b62ee57af9dedf650c477fe9';
  v_new_part_2 constant text :=
    '9d97563e31ec023e5e9255169830bf69a67159d8aafab179b1601c8b94700ee6';
  v_signature text;
  v_expected_body_sha256 text;
  v_expected_result text;
  v_definition text;
  v_body_sha256 text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
  v_language text;
  v_result text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[v_import_signature, v_finalize_signature]
  LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'required rubric import function is missing: %', v_signature;
    END IF;

    IF v_signature = v_import_signature THEN
      v_expected_body_sha256 :=
        '91b9f15e67d132540398a6fc5d4e16753f3defaa89091db8ba7bd26784c4a211';
      v_expected_result := 'void';
    ELSE
      v_expected_body_sha256 :=
        '8cfb3048ba77c838d542650d6443a0e2529053a9843b32759c02216e9e8d099a';
      v_expected_result := 'jsonb';
    END IF;

    SELECT
      pg_get_functiondef(proc.oid),
      encode(sha256(convert_to(proc.prosrc, 'UTF8')), 'hex'),
      pg_get_userbyid(proc.proowner),
      proc.prosecdef,
      proc.proconfig,
      language.lanname,
      pg_get_function_result(proc.oid)
    INTO
      v_definition,
      v_body_sha256,
      v_owner,
      v_security_definer,
      v_config,
      v_language,
      v_result
    FROM pg_proc AS proc
    JOIN pg_language AS language ON language.oid = proc.prolang
    WHERE proc.oid = to_regprocedure(v_signature);

    IF v_body_sha256 IS DISTINCT FROM v_expected_body_sha256
      OR v_owner <> 'postgres'
      OR v_security_definer IS NOT TRUE
      OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
      OR v_language <> 'plpgsql'
      OR v_result <> v_expected_result
      OR has_function_privilege('public', v_signature, 'EXECUTE')
      OR has_function_privilege('anon', v_signature, 'EXECUTE')
      OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE')
      OR (length(v_definition) - length(replace(v_definition, v_old_part_1, '')))
         / length(v_old_part_1) <> 1
      OR (length(v_definition) - length(replace(v_definition, v_old_part_2, '')))
         / length(v_old_part_2) <> 1
      OR position(v_new_part_1 IN v_definition) > 0
      OR position(v_new_part_2 IN v_definition) > 0 THEN
      RAISE EXCEPTION 'unexpected predecessor definition for %', v_signature;
    END IF;

    v_definition := replace(v_definition, v_old_part_1, v_new_part_1);
    v_definition := replace(v_definition, v_old_part_2, v_new_part_2);
    EXECUTE v_definition;
  END LOOP;
END;
$reconcile$;

DO $verify$
DECLARE
  v_signature text;
  v_definition text;
  v_owner text;
  v_security_definer boolean;
  v_config text[];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.import_normalized_mmi_station_batch(text,text,text,jsonb)',
    'public.finalize_normalized_mmi_station_import(text,text,text)'
  ]
  LOOP
    SELECT
      pg_get_functiondef(proc.oid),
      pg_get_userbyid(proc.proowner),
      proc.prosecdef,
      proc.proconfig
    INTO v_definition, v_owner, v_security_definer, v_config
    FROM pg_proc AS proc
    WHERE proc.oid = to_regprocedure(v_signature);

    IF position('950e52261c043a819dab92183b423a15e43be1ac20e02c4e47927a7b10a0424e' IN v_definition) > 0
      OR position('31ba173facd961ef14a9258a41f101c3cebe087b581c481133db88ff9602832c' IN v_definition) > 0
      OR position('b94d0f3b9784062b9167551c80a7735d16ebbdc5b62ee57af9dedf650c477fe9' IN v_definition) = 0
      OR position('9d97563e31ec023e5e9255169830bf69a67159d8aafab179b1601c8b94700ee6' IN v_definition) = 0
      OR v_owner <> 'postgres'
      OR v_security_definer IS NOT TRUE
      OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
      OR has_function_privilege('public', v_signature, 'EXECUTE')
      OR has_function_privilege('anon', v_signature, 'EXECUTE')
      OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'rubric import fingerprint reconciliation failed for %', v_signature;
    END IF;
  END LOOP;
END;
$verify$;

COMMIT;
