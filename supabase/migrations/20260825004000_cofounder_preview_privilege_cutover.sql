-- Cofounder preview privilege cutover.
--
-- Apply only after the hosted-only security reconciliation, additive preview
-- migrations, reviewed Edge deployment, and object/ACL verification. This is
-- privilege-only: it performs no row DML and deletes no database object.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_table text;
  v_column text;
  v_role text;
  v_policy_count integer;
  v_rpc record;
  v_overload_count integer;
  v_owner text;
  v_security_definer boolean;
  v_language text;
  v_config text[];
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'questions',
    'answers',
    'scores',
    'mock_sessions',
    'profiles',
    'app_config',
    'legacy_scoring_claims',
    'legacy_scoring_attempts',
    'cofounder_feedback'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'required cutover table public.% is missing', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'required RLS is not enabled on public.%', v_table;
    END IF;
  END LOOP;

  -- Reconciliation must already have removed every effective runtime grant
  -- from assessor content. Do not continue a cutover that could leave private
  -- rubrics readable through service_role, including through PUBLIC or direct
  -- column grants.
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
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'required assessor-content table public.% is missing', v_table;
    END IF;
  END LOOP;

  SELECT count(*)
  INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('answers', 'scores', 'mock_sessions', 'profiles');

  IF v_policy_count <> 7 OR EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('answers', 'scores', 'mock_sessions', 'profiles')
      AND CASE tablename || '.' || policyname
        WHEN 'answers.answers_own' THEN
          cmd <> 'ALL'
          OR roles <> ARRAY['public'::name]
        WHEN 'scores.scores_insert_own' THEN
          cmd <> 'INSERT'
          OR roles <> ARRAY['public'::name]
        WHEN 'scores.scores_select_own' THEN
          cmd <> 'SELECT'
          OR roles <> ARRAY['public'::name]
        WHEN 'mock_sessions.sessions_own' THEN
          cmd <> 'ALL'
          OR roles <> ARRAY['public'::name]
        WHEN 'profiles.profiles_read_own' THEN
          cmd <> 'SELECT'
          OR roles <> ARRAY['authenticated'::name]
        WHEN 'profiles.profiles_select_own' THEN
          cmd <> 'SELECT'
          OR roles <> ARRAY['public'::name]
        WHEN 'profiles.profiles_update_own' THEN
          cmd <> 'UPDATE'
          OR roles <> ARRAY['authenticated'::name]
        ELSE TRUE
      END
  ) THEN
    RAISE EXCEPTION 'hosted RLS policy prerequisite failed';
  END IF;

  SELECT count(*)
  INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'app_config';

  IF v_policy_count <> 4
    OR NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'app_config'
        AND policyname = 'app_config_read_non_secret'
    )
    OR NOT (
      (
        EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'app_config'
            AND policyname = 'app_config_insert_admin'
        )
        AND EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'app_config'
            AND policyname = 'app_config_update_admin'
        )
        AND EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'app_config'
            AND policyname = 'app_config_delete_admin'
        )
      )
      OR
      (
        EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'app_config'
            AND policyname = 'app_config_insert_admin_non_secret'
        )
        AND EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'app_config'
            AND policyname = 'app_config_update_admin_non_secret'
        )
        AND EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'app_config'
            AND policyname = 'app_config_delete_admin_non_secret'
        )
      )
    )
    OR EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'app_config'
        AND (
          permissive <> 'PERMISSIVE'
          OR CASE policyname
            WHEN 'app_config_read_non_secret' THEN cmd <> 'SELECT'
            WHEN 'app_config_insert_admin' THEN cmd <> 'INSERT'
            WHEN 'app_config_insert_admin_non_secret' THEN cmd <> 'INSERT'
            WHEN 'app_config_update_admin' THEN cmd <> 'UPDATE'
            WHEN 'app_config_update_admin_non_secret' THEN cmd <> 'UPDATE'
            WHEN 'app_config_delete_admin' THEN cmd <> 'DELETE'
            WHEN 'app_config_delete_admin_non_secret' THEN cmd <> 'DELETE'
            ELSE TRUE
          END
        )
    )
  THEN
    RAISE EXCEPTION 'app_config policy generation prerequisite failed';
  END IF;

  IF to_regprocedure('public.claim_legacy_scoring(uuid,uuid,uuid,text,text,uuid)') IS NULL
    OR to_regprocedure('public.complete_legacy_scoring(uuid,uuid,uuid,text,text,smallint,smallint,smallint,smallint,smallint,text,text)') IS NULL
    OR to_regprocedure('public.fail_legacy_scoring(uuid,uuid,uuid,text)') IS NULL
    OR to_regprocedure('public.list_legacy_questions(public.question_category,public.question_difficulty,text,integer)') IS NULL
    OR to_regprocedure('public.get_legacy_question(uuid)') IS NULL
    OR to_regprocedure('public.get_legacy_question_counts()') IS NULL
    OR to_regprocedure('public.create_legacy_questions(jsonb)') IS NULL
    OR to_regprocedure('public.submit_cofounder_feedback(text,text,text,text,text,boolean)') IS NULL
    OR to_regprocedure('public.list_cofounder_feedback(integer)') IS NULL
    OR to_regprocedure('public.update_streak(uuid)') IS NULL
    OR to_regprocedure('public.handle_new_user()') IS NULL
    OR to_regprocedure('public.is_admin()') IS NULL
  THEN
    RAISE EXCEPTION 'one or more required cutover functions are missing';
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
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
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
        RAISE EXCEPTION 'assessor-content service-role ACL prerequisite failed for public.% role %',
          v_table,
          v_role;
      END IF;
    END LOOP;
  END LOOP;

  FOR v_rpc IN
    SELECT *
    FROM (VALUES
      ('claim_legacy_scoring', 'public.claim_legacy_scoring(uuid,uuid,uuid,text,text,uuid)'),
      ('complete_legacy_scoring', 'public.complete_legacy_scoring(uuid,uuid,uuid,text,text,smallint,smallint,smallint,smallint,smallint,text,text)'),
      ('fail_legacy_scoring', 'public.fail_legacy_scoring(uuid,uuid,uuid,text)'),
      ('list_legacy_questions', 'public.list_legacy_questions(public.question_category,public.question_difficulty,text,integer)'),
      ('get_legacy_question', 'public.get_legacy_question(uuid)'),
      ('get_legacy_question_counts', 'public.get_legacy_question_counts()'),
      ('create_legacy_questions', 'public.create_legacy_questions(jsonb)'),
      ('submit_cofounder_feedback', 'public.submit_cofounder_feedback(text,text,text,text,text,boolean)'),
      ('list_cofounder_feedback', 'public.list_cofounder_feedback(integer)')
    ) AS required(name, signature)
  LOOP
    SELECT count(*)
    INTO v_overload_count
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = v_rpc.name;

    SELECT
      pg_get_userbyid(p.proowner),
      p.prosecdef,
      l.lanname,
      p.proconfig
    INTO v_owner, v_security_definer, v_language, v_config
    FROM pg_proc AS p
    JOIN pg_language AS l ON l.oid = p.prolang
    WHERE p.oid = to_regprocedure(v_rpc.signature);

    IF v_overload_count <> 1
      OR v_owner <> 'postgres'
      OR v_security_definer IS DISTINCT FROM TRUE
      OR v_language <> 'plpgsql'
      OR NOT (COALESCE(v_config, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public'])
    THEN
      RAISE EXCEPTION 'preview RPC identity prerequisite failed for %', v_rpc.signature;
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY ARRAY[
    'id',
    'full_name',
    'avatar_url',
    'university_target',
    'entry_year',
    'daily_goal',
    'onboarding_complete',
    'updated_at',
    'is_admin',
    'streak_current',
    'streak_longest',
    'streak_last_date'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND column_name = v_column
    ) THEN
      RAISE EXCEPTION 'required profiles column public.profiles.% is missing', v_column;
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY ARRAY['key', 'value', 'updated_at']
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'app_config'
        AND column_name = v_column
    ) THEN
      RAISE EXCEPTION 'required app_config column public.app_config.% is missing', v_column;
    END IF;
  END LOOP;

  IF NOT has_function_privilege(
      'service_role',
      'public.claim_legacy_scoring(uuid,uuid,uuid,text,text,uuid)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.claim_legacy_scoring(uuid,uuid,uuid,text,text,uuid)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.claim_legacy_scoring(uuid,uuid,uuid,text,text,uuid)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.complete_legacy_scoring(uuid,uuid,uuid,text,text,smallint,smallint,smallint,smallint,smallint,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.complete_legacy_scoring(uuid,uuid,uuid,text,text,smallint,smallint,smallint,smallint,smallint,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.complete_legacy_scoring(uuid,uuid,uuid,text,text,smallint,smallint,smallint,smallint,smallint,text,text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.fail_legacy_scoring(uuid,uuid,uuid,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.fail_legacy_scoring(uuid,uuid,uuid,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.fail_legacy_scoring(uuid,uuid,uuid,text)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'scoring RPC ACL prerequisite failed';
  END IF;

  IF NOT has_function_privilege(
      'authenticated',
      'public.list_legacy_questions(public.question_category,public.question_difficulty,text,integer)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.list_legacy_questions(public.question_category,public.question_difficulty,text,integer)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.list_legacy_questions(public.question_category,public.question_difficulty,text,integer)',
      'EXECUTE'
    )
    OR NOT has_function_privilege('authenticated', 'public.get_legacy_question(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_legacy_question(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.get_legacy_question(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.get_legacy_question_counts()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_legacy_question_counts()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.get_legacy_question_counts()', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.create_legacy_questions(jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.create_legacy_questions(jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.create_legacy_questions(jsonb)', 'EXECUTE')
    OR NOT has_function_privilege(
      'authenticated',
      'public.submit_cofounder_feedback(text,text,text,text,text,boolean)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.submit_cofounder_feedback(text,text,text,text,text,boolean)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.submit_cofounder_feedback(text,text,text,text,text,boolean)',
      'EXECUTE'
    )
    OR NOT has_function_privilege('authenticated', 'public.list_cofounder_feedback(integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.list_cofounder_feedback(integer)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.list_cofounder_feedback(integer)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'authenticated preview RPC ACL prerequisite failed';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'legacy_scoring_claims',
    'legacy_scoring_attempts'
  ]
  LOOP
    IF NOT has_table_privilege('service_role', 'public.' || v_table, 'SELECT')
      OR NOT has_table_privilege('service_role', 'public.' || v_table, 'INSERT')
      OR NOT has_table_privilege('service_role', 'public.' || v_table, 'UPDATE')
      OR NOT has_table_privilege('service_role', 'public.' || v_table, 'DELETE')
      OR NOT has_table_privilege('service_role', 'public.' || v_table, 'TRUNCATE')
      OR NOT has_table_privilege('service_role', 'public.' || v_table, 'REFERENCES')
      OR NOT has_table_privilege('service_role', 'public.' || v_table, 'TRIGGER')
    THEN
      RAISE EXCEPTION 'service-only preview table ACL prerequisite failed for public.% service_role', v_table;
    END IF;

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
        RAISE EXCEPTION 'service-only preview table ACL prerequisite failed for public.% role %', v_table, v_role;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF has_table_privilege(v_role, 'public.cofounder_feedback', 'SELECT')
      OR has_table_privilege(v_role, 'public.cofounder_feedback', 'INSERT')
      OR has_table_privilege(v_role, 'public.cofounder_feedback', 'UPDATE')
      OR has_table_privilege(v_role, 'public.cofounder_feedback', 'DELETE')
      OR has_table_privilege(v_role, 'public.cofounder_feedback', 'TRUNCATE')
      OR has_table_privilege(v_role, 'public.cofounder_feedback', 'REFERENCES')
      OR has_table_privilege(v_role, 'public.cofounder_feedback', 'TRIGGER')
      OR has_any_column_privilege(v_role, 'public.cofounder_feedback', 'SELECT')
      OR has_any_column_privilege(v_role, 'public.cofounder_feedback', 'INSERT')
      OR has_any_column_privilege(v_role, 'public.cofounder_feedback', 'UPDATE')
      OR has_any_column_privilege(v_role, 'public.cofounder_feedback', 'REFERENCES')
    THEN
      RAISE EXCEPTION 'feedback table must remain RPC-only for role %', v_role;
    END IF;
  END LOOP;
END;
$$;

-- Make search-path safety deterministic even on a pristine local migration
-- chain where the hosted-only reconciliation was intentionally not applied.
ALTER FUNCTION public.handle_new_user() SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_streak(uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_admin() SET search_path = pg_catalog, public;

-- Hosted and pristine databases use two reviewed policy-name generations.
-- Normalize the hosted generation without dropping an RLS object, then force
-- the same canonical predicates in both environments.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_config'
      AND policyname = 'app_config_insert_admin'
  ) THEN
    EXECUTE 'ALTER POLICY app_config_insert_admin ON public.app_config RENAME TO app_config_insert_admin_non_secret';
    EXECUTE 'ALTER POLICY app_config_update_admin ON public.app_config RENAME TO app_config_update_admin_non_secret';
    EXECUTE 'ALTER POLICY app_config_delete_admin ON public.app_config RENAME TO app_config_delete_admin_non_secret';
  END IF;
END;
$$;

ALTER POLICY app_config_read_non_secret
  ON public.app_config
  TO authenticated
  USING (auth.role() = 'authenticated' AND key <> 'ai_api_key');

ALTER POLICY app_config_insert_admin_non_secret
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

ALTER POLICY app_config_update_admin_non_secret
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

ALTER POLICY app_config_delete_admin_non_secret
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

  IF v_policy_count <> 4 OR EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_config'
      AND (
        permissive <> 'PERMISSIVE'
        OR CASE policyname
          WHEN 'app_config_read_non_secret' THEN
            cmd <> 'SELECT'
            OR position('auth.role' IN COALESCE(qual, '')) = 0
            OR position('authenticated' IN COALESCE(qual, '')) = 0
            OR position('ai_api_key' IN COALESCE(qual, '')) = 0
            OR with_check IS NOT NULL
          WHEN 'app_config_insert_admin_non_secret' THEN
            cmd <> 'INSERT'
            OR qual IS NOT NULL
            OR position('is_admin' IN COALESCE(with_check, '')) = 0
            OR position('profiles' IN COALESCE(with_check, '')) = 0
            OR position('auth.uid' IN COALESCE(with_check, '')) = 0
            OR position('ai_api_key' IN COALESCE(with_check, '')) = 0
          WHEN 'app_config_update_admin_non_secret' THEN
            cmd <> 'UPDATE'
            OR position('is_admin' IN COALESCE(qual, '')) = 0
            OR position('profiles' IN COALESCE(qual, '')) = 0
            OR position('auth.uid' IN COALESCE(qual, '')) = 0
            OR position('ai_api_key' IN COALESCE(qual, '')) = 0
            OR position('is_admin' IN COALESCE(with_check, '')) = 0
            OR position('profiles' IN COALESCE(with_check, '')) = 0
            OR position('auth.uid' IN COALESCE(with_check, '')) = 0
            OR position('ai_api_key' IN COALESCE(with_check, '')) = 0
          WHEN 'app_config_delete_admin_non_secret' THEN
            cmd <> 'DELETE'
            OR position('is_admin' IN COALESCE(qual, '')) = 0
            OR position('profiles' IN COALESCE(qual, '')) = 0
            OR position('auth.uid' IN COALESCE(qual, '')) = 0
            OR position('ai_api_key' IN COALESCE(qual, '')) = 0
            OR with_check IS NOT NULL
          ELSE TRUE
        END
      )
  ) THEN
    RAISE EXCEPTION 'app_config policy cutover postcondition failed';
  END IF;
END;
$$;

-- Repair the exact ownership semantics before browser privileges are restored.
-- For ALL policies, define both predicates explicitly so unsafe WITH CHECK
-- drift cannot survive an otherwise valid policy object.
ALTER POLICY "answers_own"
  ON public.answers
  TO PUBLIC
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER POLICY "scores_insert_own"
  ON public.scores
  TO PUBLIC
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.answers AS owned_answer
      WHERE owned_answer.id = scores.answer_id
        AND owned_answer.user_id = auth.uid()
    )
  );

ALTER POLICY "scores_select_own"
  ON public.scores
  TO PUBLIC
  USING (
    EXISTS (
      SELECT 1
      FROM public.answers AS owned_answer
      WHERE owned_answer.id = scores.answer_id
        AND owned_answer.user_id = auth.uid()
    )
  );

ALTER POLICY "sessions_own"
  ON public.mock_sessions
  TO PUBLIC
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER POLICY "profiles_read_own"
  ON public.profiles
  TO authenticated
  USING (auth.uid() = id);

ALTER POLICY "profiles_select_own"
  ON public.profiles
  TO PUBLIC
  USING (auth.uid() = id);

ALTER POLICY "profiles_update_own"
  ON public.profiles
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- This legacy policy is the final remaining caller of is_admin(). Inline the
-- same owner-bound check before removing public helper execution altogether.
ALTER POLICY "questions_write_admin"
  ON public.questions
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.is_admin IS TRUE
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.is_admin IS TRUE
    )
  );

-- Remove both table-level and any inherited column-level browser grants.
DO $$
DECLARE
  v_table text;
  v_columns text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['questions', 'answers', 'scores', 'mock_sessions', 'profiles', 'app_config']
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
  FOREACH v_table IN ARRAY ARRAY['questions', 'answers', 'scores', 'mock_sessions', 'profiles', 'app_config']
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

REVOKE ALL ON TABLE public.questions FROM service_role;
REVOKE ALL ON TABLE public.answers FROM service_role;
REVOKE ALL ON TABLE public.scores FROM service_role;
REVOKE ALL ON TABLE public.mock_sessions FROM service_role;

REVOKE ALL ON TABLE public.profiles FROM service_role;
GRANT SELECT (id, is_admin) ON TABLE public.profiles TO service_role;

REVOKE ALL ON TABLE public.app_config FROM service_role;
GRANT SELECT (key, value), INSERT (key, value), UPDATE (key, value)
  ON TABLE public.app_config TO service_role;

REVOKE ALL ON TABLE public.questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.answers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.scores FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mock_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.app_config FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.answers TO authenticated;
GRANT SELECT ON TABLE public.scores TO authenticated;
GRANT SELECT, INSERT ON TABLE public.mock_sessions TO authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_config TO authenticated;
GRANT UPDATE (
  full_name,
  avatar_url,
  university_target,
  entry_year,
  daily_goal,
  onboarding_complete,
  updated_at
) ON TABLE public.profiles TO authenticated;

DO $$
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
    RAISE EXCEPTION 'app_config browser ACL postcondition failed';
  END IF;
END;
$$;

-- Check effective Edge privileges only after every browser table grant has
-- reached its final state in this transaction.
DO $$
DECLARE
  v_column text;
  v_privilege text;
  v_table text;
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

  FOREACH v_table IN ARRAY ARRAY['questions', 'answers', 'scores', 'mock_sessions']
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]
    LOOP
      IF has_table_privilege('service_role', 'public.' || v_table, v_privilege) THEN
        RAISE EXCEPTION 'service-role legacy table ACL postcondition failed: public.% retains %',
          v_table,
          v_privilege;
      END IF;
    END LOOP;

    IF has_any_column_privilege('service_role', 'public.' || v_table, 'SELECT')
      OR has_any_column_privilege('service_role', 'public.' || v_table, 'INSERT')
      OR has_any_column_privilege('service_role', 'public.' || v_table, 'UPDATE')
      OR has_any_column_privilege('service_role', 'public.' || v_table, 'REFERENCES')
    THEN
      RAISE EXCEPTION 'service-role legacy table ACL postcondition failed: public.% retains column grants',
        v_table;
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

REVOKE EXECUTE ON FUNCTION public.update_streak(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_admin()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  v_allowed_column text;
  v_sensitive_column text;
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['questions', 'answers', 'scores', 'mock_sessions', 'profiles']
  LOOP
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      OR has_table_privilege('anon', 'public.' || v_table, 'INSERT')
      OR has_table_privilege('anon', 'public.' || v_table, 'UPDATE')
      OR has_table_privilege('anon', 'public.' || v_table, 'DELETE')
      OR has_table_privilege('anon', 'public.' || v_table, 'TRUNCATE')
      OR has_table_privilege('anon', 'public.' || v_table, 'REFERENCES')
      OR has_table_privilege('anon', 'public.' || v_table, 'TRIGGER')
      OR has_any_column_privilege('anon', 'public.' || v_table, 'SELECT')
      OR has_any_column_privilege('anon', 'public.' || v_table, 'INSERT')
      OR has_any_column_privilege('anon', 'public.' || v_table, 'UPDATE')
      OR has_any_column_privilege('anon', 'public.' || v_table, 'REFERENCES')
    THEN
      RAISE EXCEPTION 'anonymous privilege remains after cutover on public.%', v_table;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.questions', 'SELECT')
    OR has_table_privilege('authenticated', 'public.questions', 'INSERT')
    OR has_table_privilege('authenticated', 'public.questions', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.questions', 'DELETE')
    OR has_table_privilege('authenticated', 'public.questions', 'TRUNCATE')
    OR has_table_privilege('authenticated', 'public.questions', 'REFERENCES')
    OR has_table_privilege('authenticated', 'public.questions', 'TRIGGER')
    OR has_any_column_privilege('authenticated', 'public.questions', 'SELECT')
    OR has_any_column_privilege('authenticated', 'public.questions', 'INSERT')
    OR has_any_column_privilege('authenticated', 'public.questions', 'UPDATE')
    OR has_any_column_privilege('authenticated', 'public.questions', 'REFERENCES')
    OR NOT has_table_privilege('authenticated', 'public.answers', 'SELECT')
    OR has_table_privilege('authenticated', 'public.answers', 'INSERT')
    OR has_table_privilege('authenticated', 'public.answers', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.answers', 'DELETE')
    OR has_table_privilege('authenticated', 'public.answers', 'TRUNCATE')
    OR has_table_privilege('authenticated', 'public.answers', 'REFERENCES')
    OR has_table_privilege('authenticated', 'public.answers', 'TRIGGER')
    OR has_any_column_privilege('authenticated', 'public.answers', 'INSERT')
    OR has_any_column_privilege('authenticated', 'public.answers', 'UPDATE')
    OR has_any_column_privilege('authenticated', 'public.answers', 'REFERENCES')
    OR NOT has_table_privilege('authenticated', 'public.scores', 'SELECT')
    OR has_table_privilege('authenticated', 'public.scores', 'INSERT')
    OR has_table_privilege('authenticated', 'public.scores', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.scores', 'DELETE')
    OR has_table_privilege('authenticated', 'public.scores', 'TRUNCATE')
    OR has_table_privilege('authenticated', 'public.scores', 'REFERENCES')
    OR has_table_privilege('authenticated', 'public.scores', 'TRIGGER')
    OR has_any_column_privilege('authenticated', 'public.scores', 'INSERT')
    OR has_any_column_privilege('authenticated', 'public.scores', 'UPDATE')
    OR has_any_column_privilege('authenticated', 'public.scores', 'REFERENCES')
    OR NOT has_table_privilege('authenticated', 'public.mock_sessions', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.mock_sessions', 'INSERT')
    OR has_table_privilege('authenticated', 'public.mock_sessions', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.mock_sessions', 'DELETE')
    OR has_table_privilege('authenticated', 'public.mock_sessions', 'TRUNCATE')
    OR has_table_privilege('authenticated', 'public.mock_sessions', 'REFERENCES')
    OR has_table_privilege('authenticated', 'public.mock_sessions', 'TRIGGER')
    OR has_any_column_privilege('authenticated', 'public.mock_sessions', 'UPDATE')
    OR has_any_column_privilege('authenticated', 'public.mock_sessions', 'REFERENCES')
    OR NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT')
    OR has_table_privilege('authenticated', 'public.profiles', 'INSERT')
    OR has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.profiles', 'DELETE')
    OR has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')
    OR has_table_privilege('authenticated', 'public.profiles', 'REFERENCES')
    OR has_table_privilege('authenticated', 'public.profiles', 'TRIGGER')
    OR has_any_column_privilege('authenticated', 'public.profiles', 'INSERT')
    OR has_any_column_privilege('authenticated', 'public.profiles', 'REFERENCES')
    OR has_function_privilege('authenticated', 'public.update_streak(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.update_streak(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.update_streak(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.is_admin()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.is_admin()', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'cutover helper execution postcondition failed';
  END IF;

  FOREACH v_allowed_column IN ARRAY ARRAY[
    'full_name',
    'avatar_url',
    'university_target',
    'entry_year',
    'daily_goal',
    'onboarding_complete',
    'updated_at'
  ]
  LOOP
    IF NOT has_column_privilege(
      'authenticated',
      'public.profiles',
      v_allowed_column,
      'UPDATE'
    ) THEN
      RAISE EXCEPTION 'required profile column update grant is missing for %', v_allowed_column;
    END IF;
  END LOOP;

  FOREACH v_sensitive_column IN ARRAY ARRAY[
    'id',
    'is_admin',
    'streak_current',
    'streak_longest',
    'streak_last_date',
    'created_at'
  ]
  LOOP
    IF has_column_privilege(
      'authenticated',
      'public.profiles',
      v_sensitive_column,
      'UPDATE'
    ) THEN
      RAISE EXCEPTION 'forbidden profile column update grant remains for %', v_sensitive_column;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
