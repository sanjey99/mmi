/**
 * Question service — handles fetching from Supabase + CSV parsing for admin import.
 *
 * Workbook CSV format (admin upload):
 * category,text,difficulty,subcategory,university_tags,is_mmi_suitable,guidance_notes,
 * source_namespace,source_id,source_manifest_sha256,source_batch_id
 *
 * Example row:
 * ethics,"A patient refuses treatment...",intermediate,autonomy,"oxford,ucl",true,"Consider autonomy...",med_interview_question_bank,MMI_001/MMI_001_Q1,903fb1b3eedc92647c5cb9aa48465ebc49deaa618da2a53e3a736667f71d1a71,questions-part-1
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
  importQuestionRows,
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
  updated: number;
  unchanged: number;
  retried: boolean;
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
  if (!parsed.rows.length) {
    return { inserted: 0, updated: 0, unchanged: 0, retried: false, errors: parsed.errors };
  }

  const result = await importQuestionRows(
    questionRpcClient,
    parsed.rows.map(row => row.value),
  );

  return { ...result, errors: parsed.errors };
}
