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
  pickRandomQuestion,
  type QuestionCounts,
} from '../features/questions/selection';
import { parseQuestionCsv } from '../features/questions/csv';
import type { QuestionDraft } from '../features/questions/validation';
import {
  createQuestionRows,
  fetchQuestionById,
  fetchQuestionCatalog,
  fetchQuestionCounts,
  type QuestionRpcClient,
} from '../features/questions/api';

const questionRpcClient = supabase as unknown as QuestionRpcClient;

// ── Fetch questions ───────────────────────────────────────────────────────────

export async function getQuestions(opts?: {
  category?: QuestionCategory;
  difficulty?: QuestionDifficulty;
  university?: string;
  limit?: number;
}): Promise<Question[]> {
  return fetchQuestionCatalog(questionRpcClient, opts);
}

export async function getQuestionById(questionId: string): Promise<Question | null> {
  return fetchQuestionById(questionRpcClient, questionId);
}

export async function getActiveQuestionCounts(): Promise<QuestionCounts> {
  return fetchQuestionCounts(questionRpcClient);
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
  const [questionId] = await createQuestionRows(questionRpcClient, [question]);
  return questionId;
}

/**
 * Parse a CSV string and upsert questions into Supabase.
 * Called from the admin questions screen after the user picks a file.
 */
export async function importQuestionsFromCSV(csvText: string): Promise<CSVImportResult> {
  const parsed = parseQuestionCsv(csvText);
  if (!parsed.rows.length) return { inserted: 0, errors: parsed.errors };

  await createQuestionRows(questionRpcClient, parsed.rows.map(row => row.value));

  return { inserted: parsed.rows.length, errors: parsed.errors };
}
