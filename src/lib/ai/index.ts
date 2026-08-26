/**
 * AI Adapter — client-side entry point.
 *
 * All AI calls are proxied through the Supabase Edge Function `score-answer`.
 * The API key is read server-side only and never sent to the client.
 */

import { supabase } from '../supabase';
import { createLegacyScoringApi } from '../../features/practice/scoringApi';

const scoringApi = createLegacyScoringApi((name, options) => (
  supabase.functions.invoke(name, options)
));

export const scoreAnswer = scoringApi.scoreAnswer;

// Kept for the admin AI config screen to clear its local UI state after saving.
export function clearAIConfigCache() {
  // No-op: config is now read server-side on every Edge Function call.
}
