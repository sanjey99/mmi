import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authorizeKeyReplacement } from '../_shared/aiConfig.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (profileError) return json({ error: 'Unable to verify administrator access' }, 500);

  let body: { action?: unknown; apiKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.action === 'status') {
    if (!profile?.is_admin) return json({ error: 'Administrator access is required' }, 403);

    const { data, error } = await serviceClient
      .from('app_config')
      .select('key')
      .eq('key', 'ai_api_key')
      .not('value', 'is', null)
      .maybeSingle();
    if (error) return json({ error: 'Unable to load AI key status' }, 500);
    return json({ configured: Boolean(data) });
  }

  const authorization = authorizeKeyReplacement(body, Boolean(profile?.is_admin));
  if (!authorization.allowed) return json({ error: authorization.error }, authorization.status);

  const apiKey = (body.apiKey as string).trim();
  const { error: writeError } = await serviceClient
    .from('app_config')
    .upsert({ key: 'ai_api_key', value: apiKey }, { onConflict: 'key' });
  if (writeError) return json({ error: 'Unable to save the AI key' }, 500);

  return json({ configured: true });
});
