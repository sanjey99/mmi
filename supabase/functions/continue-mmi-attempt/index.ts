import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { EdgeRequestError, prepareEdgeHttpRequest, readBoundedJson } from '../_shared/http.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const http = prepareEdgeHttpRequest(req, Deno.env.get('APP_ALLOWED_ORIGINS') ?? '');
  if (http.response) return http.response;
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return http.json({ code: 'unauthorized' }, 401);
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await anon.auth.getUser();
  if (authError || !user) return http.json({ code: 'unauthorized' }, 401);
  let body: unknown;
  try { body = await readBoundedJson(req); } catch (error) { return http.json({ code: 'invalid_request' }, error instanceof EdgeRequestError ? error.status : 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof (body as { attemptId?: unknown }).attemptId !== 'string' || !UUID.test((body as { attemptId: string }).attemptId)) return http.json({ code: 'invalid_request' }, 400);
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await service.rpc('advance_mmi_attempt_after_feedback', { p_user_id: user.id, p_attempt_id: (body as { attemptId: string }).attemptId });
  if (error || !data) return http.json({ code: error?.message === 'attempt_not_found' ? 'attempt_not_found' : 'invalid_continue_attempt' }, error?.message === 'attempt_not_found' ? 404 : 409);
  return http.json(data as Record<string, unknown>);
});
