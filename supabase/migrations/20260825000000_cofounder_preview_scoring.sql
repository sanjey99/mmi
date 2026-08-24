-- Cofounder preview: server-owned, retry-safe legacy answer scoring.
--
-- This migration is intentionally additive. It creates durable claim metadata,
-- exposes service-role-only transaction boundaries, and revokes the browser
-- mutations that those boundaries replace. It does not delete rows or objects.

CREATE TABLE public.legacy_scoring_claims (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  session_id       UUID NOT NULL REFERENCES public.mock_sessions(id) ON DELETE RESTRICT,
  question_id      UUID NOT NULL REFERENCES public.questions(id) ON DELETE RESTRICT,
  answer_hash      TEXT NOT NULL CHECK (answer_hash ~ '^[0-9a-f]{64}$'),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'succeeded', 'failed')),
  lease_token      UUID,
  lease_expires_at TIMESTAMPTZ,
  answer_id        UUID REFERENCES public.answers(id) ON DELETE RESTRICT,
  attempt_count    INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, session_id, question_id)
);

CREATE TABLE public.legacy_scoring_attempts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id     UUID NOT NULL REFERENCES public.legacy_scoring_claims(id) ON DELETE RESTRICT,
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  lease_token  UUID NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'succeeded', 'failed')),
  error_code   TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  UNIQUE (claim_id, lease_token)
);

CREATE INDEX legacy_scoring_attempts_user_started_idx
  ON public.legacy_scoring_attempts (user_id, started_at DESC);

ALTER TABLE public.legacy_scoring_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_scoring_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.legacy_scoring_claims FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.legacy_scoring_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.legacy_scoring_claims TO service_role;
GRANT ALL ON TABLE public.legacy_scoring_attempts TO service_role;

-- The Edge function now owns these legacy writes. Existing SELECT grants and
-- own-row read policies remain unchanged for progress and restoration.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.answers FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.scores FROM authenticated;
REVOKE UPDATE, DELETE ON TABLE public.mock_sessions FROM authenticated;
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, university_target, entry_year, daily_goal, onboarding_complete, updated_at)
  ON TABLE public.profiles TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_streak(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_streak(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_legacy_scoring(
  p_user_id UUID,
  p_session_id UUID,
  p_question_id UUID,
  p_answer_text TEXT,
  p_answer_hash TEXT,
  p_lease_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.legacy_scoring_claims%ROWTYPE;
  v_session public.mock_sessions%ROWTYPE;
  v_question_text TEXT;
  v_question_category public.question_category;
  v_answer_id UUID;
  v_answer_text TEXT;
  v_answer_count INTEGER;
  v_recent_attempts INTEGER;
  v_result JSONB;
BEGIN
  IF p_user_id IS NULL
    OR p_session_id IS NULL
    OR p_question_id IS NULL
    OR p_lease_token IS NULL
    OR p_answer_text IS NULL
    OR p_answer_hash IS NULL
    OR length(btrim(p_answer_text)) < 20
    OR length(p_answer_text) > 3000
    OR p_answer_text <> btrim(p_answer_text)
    OR p_answer_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_request';
  END IF;

  -- Serialise one user's short claim transaction so the hourly quota and
  -- same-session claim decision remain exact under concurrent requests.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));

  SELECT mock_sessions.*
  INTO v_session
  FROM public.mock_sessions
  WHERE mock_sessions.id = p_session_id
    AND mock_sessions.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'submission_unavailable';
  END IF;

  SELECT questions.text, questions.category
  INTO v_question_text, v_question_category
  FROM public.questions
  WHERE questions.id = p_question_id
    AND questions.is_active = TRUE;
  IF NOT FOUND
    OR (v_session.category_filter IS NOT NULL AND v_session.category_filter <> v_question_category)
  THEN
    RAISE EXCEPTION USING MESSAGE = 'submission_unavailable';
  END IF;

  SELECT *
  INTO v_claim
  FROM public.legacy_scoring_claims
  WHERE user_id = p_user_id
    AND session_id = p_session_id
    AND question_id = p_question_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_claim.answer_hash <> p_answer_hash THEN
      RAISE EXCEPTION USING MESSAGE = 'answer_conflict';
    END IF;

    IF v_claim.status = 'succeeded' AND v_claim.answer_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'structure', scores.structure,
        'ethics', scores.ethics,
        'communication', scores.communication,
        'reflection', scores.reflection,
        'nhs_awareness', scores.nhs_awareness,
        'overall_pct', scores.overall_pct,
        'ai_feedback', scores.ai_feedback,
        'improvement_tip', scores.improvement_tip
      )
      INTO v_result
      FROM public.scores
      WHERE scores.answer_id = v_claim.answer_id;

      IF v_result IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'submission_unavailable';
      END IF;
      RETURN jsonb_build_object('status', 'succeeded', 'result', v_result);
    END IF;

    IF v_claim.status = 'pending'
      AND v_claim.lease_token <> p_lease_token
      AND v_claim.lease_expires_at > clock_timestamp()
    THEN
      RETURN jsonb_build_object('status', 'in_progress');
    END IF;
  ELSE
    -- Preserve safe replay for a pre-migration answer without creating a
    -- second answer or a second paid provider call.
    SELECT count(*)
    INTO v_answer_count
    FROM public.answers
    WHERE answers.user_id = p_user_id
      AND answers.session_id = p_session_id
      AND answers.question_id = p_question_id;

    IF v_answer_count > 1 THEN
      RAISE EXCEPTION USING MESSAGE = 'submission_unavailable';
    END IF;
    IF v_answer_count = 1 THEN
      SELECT answers.id, answers.text
      INTO v_answer_id, v_answer_text
      FROM public.answers
      WHERE answers.user_id = p_user_id
        AND answers.session_id = p_session_id
        AND answers.question_id = p_question_id
      ORDER BY answers.created_at, answers.id
      LIMIT 1;
    END IF;
    IF v_answer_count = 1 AND v_answer_text <> p_answer_text THEN
      RAISE EXCEPTION USING MESSAGE = 'answer_conflict';
    END IF;

    IF v_answer_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'structure', scores.structure,
        'ethics', scores.ethics,
        'communication', scores.communication,
        'reflection', scores.reflection,
        'nhs_awareness', scores.nhs_awareness,
        'overall_pct', scores.overall_pct,
        'ai_feedback', scores.ai_feedback,
        'improvement_tip', scores.improvement_tip
      )
      INTO v_result
      FROM public.scores
      WHERE scores.answer_id = v_answer_id;

      IF v_result IS NOT NULL THEN
        INSERT INTO public.legacy_scoring_claims (
          user_id, session_id, question_id, answer_hash, status, answer_id
        ) VALUES (
          p_user_id, p_session_id, p_question_id, p_answer_hash, 'succeeded', v_answer_id
        )
        RETURNING * INTO v_claim;
        RETURN jsonb_build_object('status', 'succeeded', 'result', v_result);
      END IF;
    END IF;
  END IF;

  IF v_session.completed THEN
    RAISE EXCEPTION USING MESSAGE = 'submission_unavailable';
  END IF;

  SELECT count(*)
  INTO v_recent_attempts
  FROM public.legacy_scoring_attempts
  WHERE user_id = p_user_id
    AND started_at >= clock_timestamp() - INTERVAL '1 hour';
  IF v_recent_attempts >= 20 THEN
    RAISE EXCEPTION USING MESSAGE = 'rate_limited';
  END IF;

  IF v_claim.id IS NULL THEN
    INSERT INTO public.legacy_scoring_claims (
      user_id,
      session_id,
      question_id,
      answer_hash,
      status,
      lease_token,
      lease_expires_at,
      attempt_count
    ) VALUES (
      p_user_id,
      p_session_id,
      p_question_id,
      p_answer_hash,
      'pending',
      p_lease_token,
      clock_timestamp() + INTERVAL '3 minutes',
      1
    )
    RETURNING * INTO v_claim;
  ELSE
    UPDATE public.legacy_scoring_claims
    SET status = 'pending',
        lease_token = p_lease_token,
        lease_expires_at = clock_timestamp() + INTERVAL '3 minutes',
        attempt_count = attempt_count + 1,
        last_error_code = NULL,
        updated_at = clock_timestamp()
    WHERE id = v_claim.id
    RETURNING * INTO v_claim;
  END IF;

  INSERT INTO public.legacy_scoring_attempts (claim_id, user_id, lease_token)
  VALUES (v_claim.id, p_user_id, p_lease_token);

  RETURN jsonb_build_object(
    'status', 'acquired',
    'claim_id', v_claim.id,
    'lease_token', p_lease_token,
    'question_text', v_question_text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_legacy_scoring(
  p_user_id UUID,
  p_claim_id UUID,
  p_lease_token UUID,
  p_answer_text TEXT,
  p_answer_hash TEXT,
  p_structure SMALLINT,
  p_ethics SMALLINT,
  p_communication SMALLINT,
  p_reflection SMALLINT,
  p_nhs_awareness SMALLINT,
  p_ai_feedback TEXT,
  p_improvement_tip TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.legacy_scoring_claims%ROWTYPE;
  v_answer_id UUID;
  v_answer_text TEXT;
  v_answer_count INTEGER;
  v_overall_pct NUMERIC(5,2);
  v_last DATE;
  v_current INTEGER;
  v_longest INTEGER;
  v_result JSONB;
BEGIN
  IF p_user_id IS NULL
    OR p_claim_id IS NULL
    OR p_lease_token IS NULL
    OR p_answer_text IS NULL
    OR p_answer_hash IS NULL
    OR length(btrim(p_answer_text)) < 20
    OR length(p_answer_text) > 3000
    OR p_answer_text <> btrim(p_answer_text)
    OR p_answer_hash !~ '^[0-9a-f]{64}$'
    OR p_structure IS NULL
    OR p_structure NOT BETWEEN 1 AND 5
    OR p_ethics IS NULL
    OR p_ethics NOT BETWEEN 1 AND 5
    OR p_communication IS NULL
    OR p_communication NOT BETWEEN 1 AND 5
    OR p_reflection IS NULL
    OR p_reflection NOT BETWEEN 1 AND 5
    OR p_nhs_awareness IS NULL
    OR p_nhs_awareness NOT BETWEEN 1 AND 5
    OR p_ai_feedback IS NULL
    OR p_ai_feedback <> btrim(p_ai_feedback)
    OR length(p_ai_feedback) NOT BETWEEN 1 AND 2000
    OR p_improvement_tip IS NULL
    OR p_improvement_tip <> btrim(p_improvement_tip)
    OR length(p_improvement_tip) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_request';
  END IF;

  SELECT *
  INTO v_claim
  FROM public.legacy_scoring_claims
  WHERE id = p_claim_id
    AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'submission_unavailable';
  END IF;

  IF v_claim.answer_hash <> p_answer_hash THEN
    RAISE EXCEPTION USING MESSAGE = 'answer_conflict';
  END IF;

  IF v_claim.status = 'succeeded' AND v_claim.answer_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'structure', scores.structure,
      'ethics', scores.ethics,
      'communication', scores.communication,
      'reflection', scores.reflection,
      'nhs_awareness', scores.nhs_awareness,
      'overall_pct', scores.overall_pct,
      'ai_feedback', scores.ai_feedback,
      'improvement_tip', scores.improvement_tip
    )
    INTO v_result
    FROM public.scores
    WHERE scores.answer_id = v_claim.answer_id;
    IF v_result IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'persistence_failed';
    END IF;
    RETURN v_result;
  END IF;

  IF v_claim.status <> 'pending'
    OR v_claim.lease_token <> p_lease_token
    OR v_claim.lease_expires_at <= clock_timestamp()
  THEN
    RAISE EXCEPTION USING MESSAGE = 'in_progress';
  END IF;

  PERFORM 1
  FROM public.mock_sessions
  WHERE mock_sessions.id = v_claim.session_id
    AND mock_sessions.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'submission_unavailable';
  END IF;

  PERFORM 1
  FROM public.questions
  WHERE questions.id = v_claim.question_id
    AND questions.is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'submission_unavailable';
  END IF;

  SELECT count(*)
  INTO v_answer_count
  FROM public.answers
  WHERE answers.user_id = p_user_id
    AND answers.session_id = v_claim.session_id
    AND answers.question_id = v_claim.question_id;
  IF v_answer_count > 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'submission_unavailable';
  END IF;
  IF v_answer_count = 1 THEN
    SELECT answers.id, answers.text
    INTO v_answer_id, v_answer_text
    FROM public.answers
    WHERE answers.user_id = p_user_id
      AND answers.session_id = v_claim.session_id
      AND answers.question_id = v_claim.question_id
    ORDER BY answers.created_at, answers.id
    LIMIT 1;
  END IF;
  IF v_answer_count = 1 AND v_answer_text <> p_answer_text THEN
    RAISE EXCEPTION USING MESSAGE = 'answer_conflict';
  END IF;

  IF v_answer_id IS NULL THEN
    INSERT INTO public.answers (session_id, question_id, user_id, text)
    VALUES (v_claim.session_id, v_claim.question_id, p_user_id, p_answer_text)
    RETURNING id INTO v_answer_id;
  END IF;

  v_overall_pct := round(((p_structure + p_ethics + p_communication + p_reflection + p_nhs_awareness)::NUMERIC / 5.0) * 20.0, 2);

  INSERT INTO public.scores (
    answer_id,
    structure,
    ethics,
    communication,
    reflection,
    nhs_awareness,
    overall_pct,
    ai_feedback,
    improvement_tip
  ) VALUES (
    v_answer_id,
    p_structure,
    p_ethics,
    p_communication,
    p_reflection,
    p_nhs_awareness,
    v_overall_pct,
    p_ai_feedback,
    p_improvement_tip
  )
  ON CONFLICT (answer_id) DO NOTHING;

  SELECT jsonb_build_object(
    'structure', scores.structure,
    'ethics', scores.ethics,
    'communication', scores.communication,
    'reflection', scores.reflection,
    'nhs_awareness', scores.nhs_awareness,
    'overall_pct', scores.overall_pct,
    'ai_feedback', scores.ai_feedback,
    'improvement_tip', scores.improvement_tip
  )
  INTO v_result
  FROM public.scores
  WHERE scores.answer_id = v_answer_id;
  IF v_result IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'persistence_failed';
  END IF;

  UPDATE public.mock_sessions
  SET total_score_pct = (v_result->>'overall_pct')::NUMERIC,
      ended_at = COALESCE(ended_at, clock_timestamp()),
      completed = TRUE
  WHERE id = v_claim.session_id
    AND user_id = p_user_id;

  SELECT streak_current, streak_longest, streak_last_date
  INTO v_current, v_longest, v_last
  FROM public.profiles
  WHERE profiles.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'submission_unavailable';
  END IF;

  IF v_last IS DISTINCT FROM CURRENT_DATE THEN
    IF v_last = CURRENT_DATE - 1 THEN
      v_current := COALESCE(v_current, 0) + 1;
    ELSE
      v_current := 1;
    END IF;
    UPDATE public.profiles
    SET streak_current = v_current,
        streak_longest = GREATEST(COALESCE(v_longest, 0), v_current),
        streak_last_date = CURRENT_DATE,
        updated_at = clock_timestamp()
    WHERE id = p_user_id;
  END IF;

  UPDATE public.legacy_scoring_claims
  SET status = 'succeeded',
      answer_id = v_answer_id,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_claim.id;

  UPDATE public.legacy_scoring_attempts
  SET status = 'succeeded',
      completed_at = clock_timestamp()
  WHERE claim_id = v_claim.id
    AND lease_token = p_lease_token;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_legacy_scoring(
  p_user_id UUID,
  p_claim_id UUID,
  p_lease_token UUID,
  p_error_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_error_code IS NULL
    OR p_error_code NOT IN ('provider_failed', 'invalid_provider_response', 'persistence_failed')
  THEN
    p_error_code := 'provider_failed';
  END IF;

  UPDATE public.legacy_scoring_claims
  SET status = 'failed',
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = p_error_code,
      updated_at = clock_timestamp()
  WHERE id = p_claim_id
    AND user_id = p_user_id
    AND status = 'pending'
    AND lease_token = p_lease_token;

  UPDATE public.legacy_scoring_attempts
  SET status = 'failed',
      error_code = p_error_code,
      completed_at = clock_timestamp()
  WHERE claim_id = p_claim_id
    AND user_id = p_user_id
    AND lease_token = p_lease_token
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_legacy_scoring(UUID, UUID, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_legacy_scoring(UUID, UUID, UUID, TEXT, TEXT, SMALLINT, SMALLINT, SMALLINT, SMALLINT, SMALLINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_legacy_scoring(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_legacy_scoring(UUID, UUID, UUID, TEXT, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_legacy_scoring(UUID, UUID, UUID, TEXT, TEXT, SMALLINT, SMALLINT, SMALLINT, SMALLINT, SMALLINT, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_legacy_scoring(UUID, UUID, UUID, TEXT)
  TO service_role;
