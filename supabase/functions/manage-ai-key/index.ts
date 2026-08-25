import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createManageAiKeyHandler } from './handler.ts';

const serviceClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const handler = createManageAiKeyHandler({
  async authenticate(authHeader) {
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error } = await anonClient.auth.getUser();
    return { userId: user?.id, error };
  },
  async getAdminStatus(userId) {
    const { data, error } = await serviceClient
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single();
    return { isAdmin: data?.is_admin, error };
  },
  async getKeyConfigured() {
    const { data, error } = await serviceClient
      .from('app_config')
      .select('key')
      .eq('key', 'ai_api_key')
      .not('value', 'is', null)
      .maybeSingle();
    return { configured: Boolean(data), error };
  },
  async replaceKey(apiKey) {
    const { error } = await serviceClient
      .from('app_config')
      .upsert({ key: 'ai_api_key', value: apiKey }, { onConflict: 'key' });
    return { error };
  },
}, Deno.env.get('APP_ALLOWED_ORIGINS') ?? '');

Deno.serve(handler);
