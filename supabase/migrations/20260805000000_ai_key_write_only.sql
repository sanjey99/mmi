-- AI API keys are write-only client secrets. Only Edge Functions with the
-- service-role key may read their values.

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "config_read_public" ON public.app_config;
DROP POLICY IF EXISTS "config_admin_all" ON public.app_config;
DROP POLICY IF EXISTS "app_config_read_non_secret" ON public.app_config;
DROP POLICY IF EXISTS "app_config_read_admin" ON public.app_config;
DROP POLICY IF EXISTS "app_config_write_admin" ON public.app_config;

CREATE POLICY "app_config_read_non_secret"
  ON public.app_config FOR SELECT
  TO authenticated
  USING (key != 'ai_api_key');

CREATE POLICY "app_config_insert_admin"
  ON public.app_config FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "app_config_update_admin"
  ON public.app_config FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "app_config_delete_admin"
  ON public.app_config FOR DELETE
  TO authenticated
  USING (public.is_admin());
