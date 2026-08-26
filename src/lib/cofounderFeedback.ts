import {
  listCofounderFeedback,
  submitCofounderFeedback,
  type CofounderFeedbackInput,
  type CofounderFeedbackReview,
  type FeedbackRpcClient,
} from '../features/cofounderFeedback/api';
import { supabase } from './supabase';

const feedbackRpcClient = supabase as unknown as FeedbackRpcClient;

export const sendCofounderFeedback = (
  input: CofounderFeedbackInput,
): Promise<string> => submitCofounderFeedback(feedbackRpcClient, input);

export const getCofounderFeedback = (
  limit = 100,
): Promise<CofounderFeedbackReview[]> => listCofounderFeedback(feedbackRpcClient, limit);
