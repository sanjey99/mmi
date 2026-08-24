import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { prepareEdgeHttpRequest } from '../_shared/http.ts';

function parseAttemptId(value: unknown) {
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
  const id = parseAttemptId(raw);
  if (!id) return http.json({ code: 'invalid_request' }, 400);

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: ownedAttempt, error: ownershipError } = await service.from('mmi_attempts')
    .select('id,status').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (ownershipError || !ownedAttempt) return http.json({ code: 'attempt_not_found' }, 404);
  if (ownedAttempt.status === 'completed') return http.json({ code: 'completed_attempt' }, 409);
  const { error } = await service.rpc('abandon_mmi_attempt', {
    p_user_id: user.id,
    p_attempt_id: id,
  });
  if (error) return http.json({ code: 'attempt_not_found' }, 404);
  return new Response(null, { status: 204, headers: http.headers });
});
