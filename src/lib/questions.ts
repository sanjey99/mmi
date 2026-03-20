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

export async function getRandomQuestion(category?: QuestionCategory): Promise<Question | null> {
  const questions = await getQuestions({ category, limit: 50 });
  if (!questions.length) return null;
  return questions[Math.floor(Math.random() * questions.length)];
}

// ── CSV import (admin only) ───────────────────────────────────────────────────

export interface CSVImportResult {
  inserted: number;
  errors: { row: number; message: string }[];
}

/**
 * Parse a CSV string and upsert questions into Supabase.
 * Called from the admin questions screen after the user picks a file.
 */
export async function importQuestionsFromCSV(csvText: string): Promise<CSVImportResult> {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (!lines.length) return { inserted: 0, errors: [] };

  // Skip header row if present
  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes('category') || firstLine.includes('text');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const errors: { row: number; message: string }[] = [];
  const toInsert: Omit<Question, 'id' | 'times_attempted' | 'avg_score' | 'created_at'>[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const rowNum = hasHeader ? i + 2 : i + 1;
    try {
      const row = parseCSVRow(dataLines[i]);
      if (row.length < 3) {
        errors.push({ row: rowNum, message: 'Too few columns (need at least category, text)' });
        continue;
      }

      const [category, subcategory, text, difficulty, university_tags_raw, is_mmi_raw, guidance_notes] = row;

      const validCategories: QuestionCategory[] = ['motivation', 'ethics', 'nhs', 'teamwork', 'resilience', 'scenarios'];
      if (!validCategories.includes(category as QuestionCategory)) {
        errors.push({ row: rowNum, message: `Invalid category "${category}". Must be one of: ${validCategories.join(', ')}` });
        continue;
      }

      const validDiffs: QuestionDifficulty[] = ['foundation', 'intermediate', 'advanced'];
      const diff = (difficulty?.trim() || 'intermediate') as QuestionDifficulty;
      if (!validDiffs.includes(diff)) {
        errors.push({ row: rowNum, message: `Invalid difficulty "${diff}"` });
        continue;
      }

      const university_tags = university_tags_raw
        ? university_tags_raw.split(',').map(u => u.trim().toLowerCase()).filter(Boolean)
        : [];

      toInsert.push({
        category: category as QuestionCategory,
        subcategory: subcategory?.trim() || null,
        text: text.trim(),
        difficulty: diff,
        university_tags,
        is_mmi_suitable: ['true', '1', 'yes'].includes((is_mmi_raw ?? '').toLowerCase()),
        guidance_notes: guidance_notes?.trim() || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      } as any);
    } catch (e: any) {
      errors.push({ row: rowNum, message: e.message });
    }
  }

  if (!toInsert.length) return { inserted: 0, errors };

  const { error } = await supabase.from('questions').insert(toInsert);
  if (error) throw new Error(`DB insert failed: ${error.message}`);

  return { inserted: toInsert.length, errors };
}

// Minimal CSV row parser (handles quoted fields with commas)
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map(s => s.trim());
}
