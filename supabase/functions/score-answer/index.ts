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

// ── CORS headers (Expo Go + production) ───────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

// ── SSRF guard ────────────────────────────────────────────────────────────────

function validateBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Only allow http for localhost
    if (parsed.protocol === 'http:') {
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') return false;
    } else if (parsed.protocol !== 'https:') {
      return false;
    }

    // Block private IP ranges (SSRF protection)
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^169\.254\./, // link-local / AWS metadata
      /^::1$/,       // IPv6 loopback
      /^fc00:/,      // IPv6 unique local
    ];
    if (privateRanges.some((r) => r.test(hostname))) return false;

    return true;
  } catch {
    return false;
  }
}

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

// ── AI provider calls ─────────────────────────────────────────────────────────

async function callAnthropic(apiKey: string, model: string, userMessage: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: SCORING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.content?.[0]?.text ?? '';
}

async function callOpenAICompat(
  apiKey: string,
  model: string,
  baseUrl: string,
  userMessage: string,
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SCORING_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI API error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
}

// ── JSON parser ───────────────────────────────────────────────────────────────

function clamp(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 3 : Math.min(5, Math.max(1, Math.round(n)));
}

function parseScoreJSON(raw: string) {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const parsed = JSON.parse(cleaned);
  const dims = ['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness'];
  const avg = dims.reduce((s, k) => s + clamp(parsed[k]), 0) / dims.length;
  return {
    structure: clamp(parsed.structure),
    ethics: clamp(parsed.ethics),
    communication: clamp(parsed.communication),
    reflection: clamp(parsed.reflection),
    nhs_awareness: clamp(parsed.nhs_awareness),
    overall_pct: Math.round(parsed.overall_pct ?? avg * 20),
    ai_feedback: parsed.ai_feedback ?? '',
    improvement_tip: parsed.improvement_tip ?? '',
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  // 1. Authenticate caller
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  const anonClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  // 2. Parse + validate body
  let body: { questionText?: string; answerText?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
  }

  const { questionText, answerText } = body;
  if (!questionText?.trim() || !answerText?.trim()) {
    return new Response(JSON.stringify({ error: 'questionText and answerText are required' }), { status: 400, headers: CORS });
  }
  if (answerText.length > 3000) {
    return new Response(JSON.stringify({ error: 'Answer too long (max 3000 characters)' }), { status: 400, headers: CORS });
  }
  if (questionText.length > 1000) {
    return new Response(JSON.stringify({ error: 'Question text too long (max 1000 characters)' }), { status: 400, headers: CORS });
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
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Maximum 50 answers per hour. Please wait before trying again.' }),
      { status: 429, headers: CORS },
    );
  }

  // 5. Fetch AI config (server-side only — key never sent to client)
  const { data: configRows, error: configError } = await serviceClient
    .from('app_config')
    .select('key, value')
    .in('key', ['ai_provider', 'ai_model', 'ai_base_url', 'ai_api_key']);

  if (configError) {
    return new Response(JSON.stringify({ error: 'Failed to load AI configuration' }), { status: 500, headers: CORS });
  }

  const cfg: Record<string, string> = {};
  for (const row of configRows ?? []) if (row.value) cfg[row.key] = row.value;

  if (!cfg.ai_api_key) {
    return new Response(
      JSON.stringify({ error: 'AI API key not configured. Ask an admin to set it up in Settings → AI Configuration.' }),
      { status: 503, headers: CORS },
    );
  }

  const provider = cfg.ai_provider ?? 'anthropic';
  const model = cfg.ai_model ?? 'claude-3-5-haiku-20241022';
  const apiKey = cfg.ai_api_key;
  const baseUrl = cfg.ai_base_url ?? null;

  // 6. SSRF guard on base_url
  if (baseUrl && !validateBaseUrl(baseUrl)) {
    return new Response(
      JSON.stringify({ error: 'Invalid AI base URL in configuration. Must be HTTPS and not a private address.' }),
      { status: 500, headers: CORS },
    );
  }

  // 7. Call AI provider
  const userMessage = `QUESTION: ${questionText}\n\nSTUDENT ANSWER: ${answerText}`;
  let raw: string;
  try {
    if (provider === 'anthropic') {
      raw = await callAnthropic(apiKey, model, userMessage);
    } else {
      raw = await callOpenAICompat(apiKey, model, baseUrl ?? 'https://api.openai.com', userMessage);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'AI provider error';
    return new Response(JSON.stringify({ error: msg }), { status: 502, headers: CORS });
  }

  // 8. Parse and return
  try {
    const result = parseScoreJSON(raw);
    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: 'AI returned an invalid response. Please try again.' }),
      { status: 502, headers: CORS },
    );
  }
});
