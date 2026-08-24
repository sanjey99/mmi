import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { prepareEdgeHttpRequest } from '../_shared/http.ts';

type AttemptRow = {
  id: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  phase: 'preparing' | 'prompt_active' | 'awaiting_continue' | 'final_feedback';
  preparation_ends_at: string | null;
  current_prompt_order: number;
  expected_prompt_count: number;
  content_snapshot: Record<string, unknown>;
};

function parseAttemptId(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as { attemptId?: unknown };
  return Object.keys(body).length === 1 && typeof body.attemptId === 'string' && body.attemptId.trim()
    ? body.attemptId.trim() : null;
}

function safeAttempt(row: AttemptRow) {
  return {
    id: row.id,
    status: row.status,
    phase: row.phase,
    preparationEndsAt: row.preparation_ends_at,
    currentPromptOrder: row.current_prompt_order,
    expectedPromptCount: row.expected_prompt_count,
    station: row.content_snapshot,
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
  try { raw = await req.json(); } catch { return http.json({ code: 'invalid_request' }, 400); }
  const id = parseAttemptId(raw);
  if (!id) return http.json({ code: 'invalid_request' }, 400);

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await service.from('mmi_attempts')
    .select('id,status,phase,preparation_ends_at,current_prompt_order,expected_prompt_count,content_snapshot')
    .eq('id', id).eq('user_id', user.id).maybeSingle();
  if (error || !data) return http.json({ code: 'attempt_not_found' }, 404);
  const attempt = safeAttempt(data as AttemptRow);

  if (attempt.phase === 'preparing') {
    const endsAt = attempt.preparationEndsAt ? Date.parse(attempt.preparationEndsAt) : Date.now();
    return http.json({ attempt, remainingSeconds: Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) });
  }
  if (attempt.phase === 'prompt_active') {
    const { data: prompt, error: promptError } = await service.from('mmi_attempt_prompt_snapshots')
      .select('prompt_order,prompt_text,time_limit_sec')
      .eq('attempt_id', attempt.id).eq('prompt_order', attempt.currentPromptOrder).maybeSingle();
    if (promptError || !prompt) return http.json({ code: 'attempt_not_found' }, 404);
    return http.json({ attempt, prompt: {
      order: prompt.prompt_order,
      text: prompt.prompt_text,
      timeLimitSec: prompt.time_limit_sec,
    } });
  }
  if (attempt.phase === 'awaiting_continue' || attempt.phase === 'final_feedback') {
    const { data: feedback, error: feedbackError } = await service.from('mmi_prompt_attempts')
      .select('overall_pct,dimension_results,strengths,improvements,improvement_tip,free_text_purged_at')
      .eq('attempt_id', attempt.id).eq('prompt_order', attempt.currentPromptOrder).maybeSingle();
    if (feedbackError || !feedback) return http.json({ code: 'attempt_not_found' }, 404);
    return http.json({
      attempt,
      feedback: {
        overallPct: feedback.overall_pct,
        dimensionResults: feedback.dimension_results,
        strengths: feedback.strengths,
        improvements: feedback.improvements,
        improvementTip: feedback.improvement_tip,
        freeTextPurgedAt: feedback.free_text_purged_at,
      },
      ...(attempt.phase === 'final_feedback' ? { summaryAvailable: true } : {}),
    });
  }
  return http.json({ attempt });
});
