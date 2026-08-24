import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { EdgeRequestError, prepareEdgeHttpRequest, readBoundedJson } from '../_shared/http.ts';

type StartMmiAttemptRequest = {
  stationKind?: unknown;
  stationId?: unknown;
  privacyNoticeVersion?: unknown;
};

function errorCode(message: string | undefined) {
  if (message?.includes('privacy_notice_not_current')) return 'privacy_notice_not_current';
  if (message?.includes('station_not_found')) return 'station_not_found';
  if (message?.includes('active_rubric_required')) return 'station_unavailable';
  return 'request_failed';
}

function parseRequest(value: unknown): { stationKind: 'standard' | 'roleplay'; stationId: string; privacyNoticeVersion: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as StartMmiAttemptRequest;
  if (Object.keys(body).length !== 3 || body.stationKind !== 'standard' && body.stationKind !== 'roleplay'
    || typeof body.stationId !== 'string' || typeof body.privacyNoticeVersion !== 'string'
    || !body.stationId.trim() || !body.privacyNoticeVersion.trim()
    || body.stationId.length > 256 || body.privacyNoticeVersion.length > 256) return null;
  return {
    stationKind: body.stationKind,
    stationId: body.stationId.trim(),
    privacyNoticeVersion: body.privacyNoticeVersion.trim(),
  };
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
  try { raw = await readBoundedJson(req); } catch (error) { return http.json({ code: 'invalid_request' }, error instanceof EdgeRequestError ? error.status : 400); }
  const body = parseRequest(raw);
  if (!body) return http.json({ code: 'invalid_request' }, 400);

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await service.rpc('create_mmi_attempt', {
    p_user_id: user.id,
    p_station_kind: body.stationKind,
    p_station_id: body.stationId,
    p_privacy_notice_version: body.privacyNoticeVersion,
  });
  if (error || !data) {
    const code = errorCode(error?.message);
    const status = code === 'privacy_notice_not_current' ? 409 : code === 'station_not_found' ? 404 : 409;
    return http.json({ code }, status);
  }
  return http.json({ attempt: data as Record<string, unknown> });
});
