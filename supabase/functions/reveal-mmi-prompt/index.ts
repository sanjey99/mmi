import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { prepareEdgeHttpRequest } from '../_shared/http.ts';

function attemptId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as { attemptId?: unknown };
  return Object.keys(body).length === 1 && typeof body.attemptId === 'string' && body.attemptId.trim()
    ? body.attemptId.trim() : null;
}

Deno.serve(async (req) => {
  const http = prepareEdgeHttpRequest(req, Deno.env.get('APP_ALLOWED_ORIGINS') ?? '');
  if (http.response) return http.response;
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return http.json({ code: 'unauthorized' }, 401);
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: authError } = await anon.auth.getUser();
  if (authError || !user) return http.json({ code: 'unauthorized' }, 401);
  let raw: unknown;
  try { raw = await req.json(); } catch { return http.json({ code: 'invalid_request' }, 400); }
  const id = attemptId(raw);
  if (!id) return http.json({ code: 'invalid_request' }, 400);

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await service.rpc('reveal_mmi_first_prompt', {
    p_user_id: user.id,
    p_attempt_id: id,
  });
  if (error || !data) return http.json({ code: 'attempt_not_found' }, 404);
  const result = data as { code?: string; remainingSeconds?: number } & Record<string, unknown>;
  if (result.code === 'preparation_in_progress') {
    return http.json({ code: result.code, remainingSeconds: result.remainingSeconds ?? 0 }, 409);
  }
  return http.json(result);
});
