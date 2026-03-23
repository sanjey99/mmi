-- Security hardening: RLS policies for app_config and questions
-- Run this in Supabase Dashboard → SQL Editor, or via `supabase db push`
--
-- REVISION 8 from security-revisions.md
-- Ensures admin checks are enforced server-side, not just client-side.

-- ── Helper: reusable admin check ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND is_admin = true
  );
$$;

-- ── app_config table ──────────────────────────────────────────────────────────

-- Enable RLS (idempotent)
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts on re-run
DROP POLICY IF EXISTS "app_config_read_non_secret" ON app_config;
DROP POLICY IF EXISTS "app_config_read_admin"      ON app_config;
DROP POLICY IF EXISTS "app_config_write_admin"     ON app_config;

-- Authenticated users can read non-sensitive config keys only
CREATE POLICY "app_config_read_non_secret"
  ON app_config FOR SELECT
  TO authenticated
  USING (key != 'ai_api_key');

-- Admins can read all keys (including ai_api_key) — needed for admin UI display
CREATE POLICY "app_config_read_admin"
  ON app_config FOR SELECT
  TO authenticated
  USING (is_admin());

-- Only admins can insert/update/delete config
CREATE POLICY "app_config_write_admin"
  ON app_config FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── questions table ───────────────────────────────────────────────────────────

ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "questions_read_authenticated" ON questions;
DROP POLICY IF EXISTS "questions_write_admin"        ON questions;

-- Any authenticated user can read questions
CREATE POLICY "questions_read_authenticated"
  ON questions FOR SELECT
  TO authenticated
  USING (true);

-- Only admins can create/edit/delete questions
CREATE POLICY "questions_write_admin"
  ON questions FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── profiles table ────────────────────────────────────────────────────────────

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_read_own"   ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

-- Users can only read their own profile
CREATE POLICY "profiles_read_own"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Users can only update their own profile (and cannot elevate is_admin themselves)
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Prevent self-promotion to admin
    AND is_admin = (SELECT is_admin FROM profiles WHERE id = auth.uid())
  );
