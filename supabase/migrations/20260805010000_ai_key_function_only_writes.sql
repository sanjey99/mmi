-- Keep ai_api_key write-only for clients. Administrators manage it exclusively
-- through the JWT-protected manage-ai-key Edge Function, which uses service role.

DROP POLICY IF EXISTS "app_config_insert_admin" ON public.app_config;
DROP POLICY IF EXISTS "app_config_update_admin" ON public.app_config;
DROP POLICY IF EXISTS "app_config_delete_admin" ON public.app_config;

CREATE POLICY "app_config_insert_admin_non_secret"
  ON public.app_config FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND key != 'ai_api_key');

CREATE POLICY "app_config_update_admin_non_secret"
  ON public.app_config FOR UPDATE
  TO authenticated
  USING (public.is_admin() AND key != 'ai_api_key')
  WITH CHECK (public.is_admin() AND key != 'ai_api_key');

CREATE POLICY "app_config_delete_admin_non_secret"
  ON public.app_config FOR DELETE
  TO authenticated
  USING (public.is_admin() AND key != 'ai_api_key');
