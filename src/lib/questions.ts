/**
 * Question service — handles fetching from Supabase + CSV parsing for admin import.
 *
 * CSV format (admin upload):
 * category,subcategory,text,difficulty,university_tags,is_mmi_suitable,guidance_notes
 *
 * Example row:
 * ethics,clinical_scenarios,"A patient refuses treatment...",intermediate,"oxford,ucl",true,"Consider autonomy..."
 */

import { supabase } from './supabase';
import type { Question, QuestionCategory, QuestionDifficulty } from '../types';
import {
  countQuestionsByCategory,
  pickRandomQuestion,
  type QuestionCounts,
} from '../features/questions/selection';
import { parseQuestionCsv } from '../features/questions/csv';
import type { QuestionDraft } from '../features/questions/validation';

// ── Fetch questions ───────────────────────────────────────────────────────────

export async function getQuestions(opts?: {
  category?: QuestionCategory;
  difficulty?: QuestionDifficulty;
  university?: string;
  limit?: number;
}): Promise<Question[]> {
  let query = supabase
    .from('questions')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (opts?.category) query = query.eq('category', opts.category);
  if (opts?.difficulty) query = query.eq('difficulty', opts.difficulty);
  if (opts?.university) query = query.contains('university_tags', [opts.university]);
  if (opts?.limit) query = query.limit(opts.limit);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Question[];
}

export async function getQuestionById(questionId: string): Promise<Question | null> {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('id', questionId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data as Question | null;
}

export async function getActiveQuestionCounts(): Promise<QuestionCounts> {
  const { data, error } = await supabase
    .from('questions')
    .select('category')
    .eq('is_active', true);
  if (error) throw error;
  return countQuestionsByCategory((data ?? []) as Pick<Question, 'category'>[]);
}

export async function getRandomQuestion(
  category?: QuestionCategory,
  previousQuestionId?: string,
): Promise<Question | null> {
  const questions = await getQuestions({ category, limit: 50 });
  return pickRandomQuestion(questions, previousQuestionId);
}

// ── CSV import (admin only) ───────────────────────────────────────────────────

export interface CSVImportResult {
  inserted: number;
  errors: { row: number; message: string }[];
}

export async function createQuestionDraft(question: QuestionDraft): Promise<string> {
  const { data, error } = await supabase
    .from('questions')
    .insert(question)
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Parse a CSV string and upsert questions into Supabase.
 * Called from the admin questions screen after the user picks a file.
 */
export async function importQuestionsFromCSV(csvText: string): Promise<CSVImportResult> {
  const parsed = parseQuestionCsv(csvText);
  if (!parsed.rows.length) return { inserted: 0, errors: parsed.errors };

  const { error } = await supabase
    .from('questions')
    .insert(parsed.rows.map(row => row.value));
  if (error) throw new Error(`DB insert failed: ${error.message}`);

  return { inserted: parsed.rows.length, errors: parsed.errors };
}
