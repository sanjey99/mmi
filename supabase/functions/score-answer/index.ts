/**
 * score-answer — Supabase Edge Function
 *
 * Proxies AI scoring so the API key never touches the client.
 * Also enforces authentication, input length caps, rate limiting,
 * and base_url SSRF validation.
 *
 * POST body: { questionText: string, answerText: string }
 * Headers:   Authorization: Bearer <supabase-jwt>
 * Returns:   ScoreResult JSON
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  callConfiguredProvider,
  formatScoringUserContent,
  parseLegacyScoreResponse,
  type AiConfig,
} from '../_shared/aiProvider.ts';
import { prepareEdgeHttpRequest } from '../_shared/http.ts';

// ── System prompt ─────────────────────────────────────────────────────────────

const SCORING_SYSTEM_PROMPT = `You are an expert UK medical school interviewer and assessor.
Your task is to evaluate a student's answer to a medical school interview question.

Score the answer on EXACTLY these 5 dimensions, each from 1 to 5:
1. structure      — logical flow, clear beginning/middle/end, STARR or SPAR framework use
2. ethics         — awareness of four pillars (autonomy, beneficence, non-maleficence, justice)
3. communication  — clarity, vocabulary, avoidance of jargon, fluency
4. reflection     — self-awareness, learning demonstrated, personal growth shown
5. nhs_awareness  — NHS values, current NHS issues, policy awareness

Scoring guide: 1=very weak, 2=below average, 3=adequate, 4=good, 5=excellent

Also provide:
- overall_pct: overall percentage score (0-100, calculated as average of 5 scores × 20)
- ai_feedback: 2-3 sentence constructive feedback paragraph (what was good and what could improve)
- improvement_tip: 1 specific actionable tip using a named framework (e.g. SPAR, STARR, four pillars)

Respond ONLY with valid JSON. No markdown, no preamble. Example format:
{
  "structure": 4,
  "ethics": 3,
  "communication": 4,
  "reflection": 3,
  "nhs_awareness": 2,
  "overall_pct": 64,
  "ai_feedback": "Your answer demonstrated clear structure...",
  "improvement_tip": "Try using the SPAR framework..."
}`;

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const http = prepareEdgeHttpRequest(req, Deno.env.get('APP_ALLOWED_ORIGINS') ?? '');
  if (http.response) return http.response;

  // 1. Authenticate caller
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return http.json({ error: 'Unauthorized' }, 401);
  }

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return http.json({ error: 'Unauthorized' }, 401);
  }

  // 2. Parse + validate body
  let body: { questionText?: string; answerText?: string };
  try {
    body = await req.json();
  } catch {
    return http.json({ error: 'Invalid JSON body' }, 400);
  }

  const { questionText, answerText } = body;
  if (!questionText?.trim() || !answerText?.trim()) {
    return http.json({ error: 'questionText and answerText are required' }, 400);
  }
  if (answerText.length > 3000) {
    return http.json({ error: 'Answer too long (max 3000 characters)' }, 400);
  }
  if (questionText.length > 1000) {
    return http.json({ error: 'Question text too long (max 1000 characters)' }, 400);
  }

  // 3. Service-role client for secrets + rate limiting
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 4. Rate limiting: max 50 scoring calls per user per hour
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await serviceClient
    .from('answers')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', hourAgo);

  if ((recentCount ?? 0) >= 50) {
    return http.json(
      { error: 'Rate limit exceeded. Maximum 50 answers per hour. Please wait before trying again.' },
      429,
      { 'Retry-After': '3600' },
    );
  }

  // 5. Fetch AI config (server-side only — key never sent to client)
  const { data: configRows, error: configError } = await serviceClient
    .from('app_config')
    .select('key, value')
    .in('key', ['ai_provider', 'ai_model', 'ai_base_url', 'ai_api_key']);

  if (configError) {
    return http.json({ error: 'Failed to load AI configuration' }, 500);
  }

  const cfg: Record<string, string> = {};
  for (const row of configRows ?? []) if (row.value) cfg[row.key] = row.value;

  if (!cfg.ai_api_key) {
    return http.json({ error: 'AI API key not configured. Ask an admin to set it up in Settings → AI Configuration.' }, 503);
  }

  const config: AiConfig = {
    provider: cfg.ai_provider ?? 'anthropic',
    model: cfg.ai_model ?? 'claude-3-5-haiku-20241022',
    apiKey: cfg.ai_api_key,
    baseUrl: cfg.ai_base_url ?? null,
  };

  // 6. Call AI provider
  let raw: unknown;
  try {
    raw = await callConfiguredProvider(config, {
      systemPrompt: SCORING_SYSTEM_PROMPT,
      userContent: formatScoringUserContent(questionText, answerText),
      maxTokens: 512,
    });
  } catch {
    return http.json({ error: 'AI_PROVIDER_REQUEST_FAILED' }, 502);
  }

  // 7. Parse and return
  try {
    const result = parseLegacyScoreResponse(raw);
    return http.json(result);
  } catch {
    return http.json({ error: 'AI_PROVIDER_RESPONSE_INVALID' }, 502);
  }
});
