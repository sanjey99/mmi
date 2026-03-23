/**
 * AI Adapter — client-side entry point.
 *
 * All AI calls are proxied through the Supabase Edge Function `score-answer`.
 * The API key is read server-side only and never sent to the client.
 */

import { supabase } from '../supabase';
import type { ScoreResult } from '../../types';

export async function scoreAnswer(
  questionText: string,
  answerText: string,
): Promise<ScoreResult> {
  const { data, error } = await supabase.functions.invoke<ScoreResult>('score-answer', {
    body: { questionText, answerText },
  });

  if (error) throw new Error(error.message ?? 'Failed to score answer. Please try again.');
  if (!data) throw new Error('AI returned an empty response. Please try again.');

  return data;
}

// Kept for the admin AI config screen to clear its local UI state after saving.
export function clearAIConfigCache() {
  // No-op: config is now read server-side on every Edge Function call.
}
