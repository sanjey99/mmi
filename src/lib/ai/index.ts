/**
 * AI Adapter — plug-and-play provider system.
 *
 * Supports:
 *   - anthropic        → Messages API  (api.anthropic.com)
 *   - openai           → Chat API      (api.openai.com)
 *   - openai_compatible → Chat API at custom base_url (Groq, Together, Mistral, Ollama, etc.)
 *
 * Admin configures provider/key/model in Supabase app_config.
 * This module reads that config and routes requests accordingly.
 */

import { supabase } from '../supabase';
import type { AIConfig, AIProvider, ScoreResult } from '../../types';

// ── System prompt for answer scoring ──────────────────────────────────────────

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

// ── Config cache (avoid re-fetching on every call) ────────────────────────────

let _configCache: AIConfig | null = null;
let _configFetchedAt = 0;
const CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getAIConfig(): Promise<AIConfig> {
  const now = Date.now();
  if (_configCache && now - _configFetchedAt < CONFIG_TTL_MS) {
    return _configCache;
  }

  const { data, error } = await supabase
    .from('app_config')
    .select('key, value')
    .in('key', ['ai_provider', 'ai_model', 'ai_base_url', 'ai_api_key']);

  if (error) throw new Error(`Failed to load AI config: ${error.message}`);

  const map: Record<string, string | null> = {};
  for (const row of data ?? []) map[row.key] = row.value;

  if (!map.ai_api_key) {
    throw new Error('AI API key not configured. Ask an admin to set it up in Settings → AI Configuration.');
  }

  _configCache = {
    provider: (map.ai_provider ?? 'anthropic') as AIProvider,
    api_key: map.ai_api_key!,
    model: map.ai_model ?? 'claude-3-5-haiku-20241022',
    base_url: map.ai_base_url ?? null,
  };
  _configFetchedAt = now;
  return _configCache;
}

export function clearAIConfigCache() {
  _configCache = null;
  _configFetchedAt = 0;
}

// ── Score an answer ───────────────────────────────────────────────────────────

export async function scoreAnswer(
  questionText: string,
  answerText: string,
): Promise<ScoreResult> {
  const config = await getAIConfig();

  const userMessage = `QUESTION: ${questionText}\n\nSTUDENT ANSWER: ${answerText}`;

  let raw: string;

  if (config.provider === 'anthropic') {
    raw = await callAnthropic(config, userMessage);
  } else {
    // openai + openai_compatible use the same Chat Completions format
    raw = await callOpenAICompat(config, userMessage);
  }

  return parseScoreJSON(raw);
}

// ── Anthropic Messages API ────────────────────────────────────────────────────

async function callAnthropic(config: AIConfig, userMessage: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.api_key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 512,
      system: SCORING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.content?.[0]?.text ?? '';
}

// ── OpenAI / OpenAI-compatible Chat Completions ───────────────────────────────

async function callOpenAICompat(config: AIConfig, userMessage: string): Promise<string> {
  const baseUrl = config.base_url ?? 'https://api.openai.com';
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.api_key}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 512,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SCORING_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
}

// ── JSON parser with fallback ─────────────────────────────────────────────────

function parseScoreJSON(raw: string): ScoreResult {
  // Strip markdown code fences if the model wrapped it anyway
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      structure: clamp(parsed.structure),
      ethics: clamp(parsed.ethics),
      communication: clamp(parsed.communication),
      reflection: clamp(parsed.reflection),
      nhs_awareness: clamp(parsed.nhs_awareness),
      overall_pct: Math.round(parsed.overall_pct ?? scoreToPercent(parsed)),
      ai_feedback: parsed.ai_feedback ?? '',
      improvement_tip: parsed.improvement_tip ?? '',
    };
  } catch {
    throw new Error('AI returned an invalid response. Please try again.');
  }
}

function clamp(val: unknown): number {
  const n = Number(val);
  return isNaN(n) ? 3 : Math.min(5, Math.max(1, Math.round(n)));
}

function scoreToPercent(parsed: Record<string, unknown>): number {
  const dims = ['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness'];
  const avg = dims.reduce((s, k) => s + clamp(parsed[k]), 0) / dims.length;
  return Math.round(avg * 20);
}
