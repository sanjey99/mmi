-- Privacy-minimal feedback persistence for the invite-only cofounder preview.
-- Additive migration: no rows or database objects are deleted.
-- This migration is committed for review and must not be applied without approval.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('extensions.uuid_generate_v4()') IS NULL THEN
    RAISE EXCEPTION 'required UUID function extensions.uuid_generate_v4() is missing';
  END IF;

  IF to_regclass('public.cofounder_feedback') IS NOT NULL
    OR to_regprocedure('public.submit_cofounder_feedback(text,text,text,text,text,boolean)') IS NOT NULL
    OR to_regprocedure('public.list_cofounder_feedback(integer)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'cofounder preview feedback migration must be applied exactly once';
  END IF;
END;
$$;

CREATE TABLE public.cofounder_feedback (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('bug', 'usability', 'content', 'scoring', 'idea', 'other')),
  severity text NOT NULL CHECK (severity IN ('blocking', 'major', 'minor', 'suggestion')),
  screen text NOT NULL CHECK (screen IN (
    'orientation',
    'practice',
    'feedback',
    'progress',
    'profile',
    'question_desk',
    'ai_config',
    'other'
  )),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 10 AND 2000),
  app_version text NOT NULL CHECK (
    length(app_version) BETWEEN 1 AND 32
    AND app_version ~ '^[0-9A-Za-z][0-9A-Za-z._+-]*$'
  ),
  allow_reply boolean NOT NULL DEFAULT FALSE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cofounder_feedback_user_created_idx
  ON public.cofounder_feedback (user_id, created_at DESC);

ALTER TABLE public.cofounder_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cofounder_feedback FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.submit_cofounder_feedback(
  p_category text,
  p_severity text,
  p_screen text,
  p_message text,
  p_app_version text,
  p_allow_reply boolean DEFAULT FALSE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_category text := lower(btrim(p_category));
  v_severity text := lower(btrim(p_severity));
  v_screen text := lower(btrim(p_screen));
  v_message text := btrim(p_message);
  v_app_version text := btrim(p_app_version);
  v_recent_count integer;
  v_feedback_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.id = v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'profile required';
  END IF;
  IF p_category IS NULL
    OR p_severity IS NULL
    OR p_screen IS NULL
    OR p_message IS NULL
    OR p_app_version IS NULL
    OR v_category NOT IN ('bug', 'usability', 'content', 'scoring', 'idea', 'other')
    OR v_severity NOT IN ('blocking', 'major', 'minor', 'suggestion')
    OR v_screen NOT IN (
      'orientation',
      'practice',
      'feedback',
      'progress',
      'profile',
      'question_desk',
      'ai_config',
      'other'
    )
    OR length(v_message) NOT BETWEEN 10 AND 2000
    OR length(v_app_version) NOT BETWEEN 1 AND 32
    OR v_app_version !~ '^[0-9A-Za-z][0-9A-Za-z._+-]*$'
    OR p_allow_reply IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid feedback';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 271828)
  );
  SELECT count(*)::integer
  INTO v_recent_count
  FROM public.cofounder_feedback AS f
  WHERE f.user_id = v_user_id
    AND f.created_at >= now() - interval '1 hour';
  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'feedback rate limit reached';
  END IF;

  INSERT INTO public.cofounder_feedback AS inserted_feedback (
    user_id,
    category,
    severity,
    screen,
    message,
    app_version,
    allow_reply
  ) VALUES (
    v_user_id,
    v_category,
    v_severity,
    v_screen,
    v_message,
    v_app_version,
    p_allow_reply
  )
  RETURNING inserted_feedback.id INTO v_feedback_id;

  RETURN v_feedback_id;
END;
$$;

CREATE FUNCTION public.list_cofounder_feedback(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  category text,
  severity text,
  screen text,
  message text,
  app_version text,
  allow_reply boolean,
  author_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_limit integer := COALESCE(p_limit, 100);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = v_user_id
      AND p.is_admin IS TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'admin access required';
  END IF;
  IF v_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid feedback limit';
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.category,
    f.severity,
    f.screen,
    f.message,
    f.app_version,
    f.allow_reply,
    CASE WHEN f.allow_reply THEN f.user_id ELSE NULL END,
    f.created_at
  FROM public.cofounder_feedback AS f
  ORDER BY f.created_at DESC, f.id
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_cofounder_feedback(
  text,
  text,
  text,
  text,
  text,
  boolean
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.list_cofounder_feedback(integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.submit_cofounder_feedback(
  text,
  text,
  text,
  text,
  text,
  boolean
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_cofounder_feedback(integer) TO authenticated;

COMMIT;
