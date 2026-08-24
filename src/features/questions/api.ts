import type { Question, QuestionCategory, QuestionDifficulty } from '../../types';
import { QUESTION_CATEGORIES, type QuestionCounts } from './selection';
import { validateQuestionDraft, type QuestionDraft } from './validation';

const QUESTION_DIFFICULTIES = Object.freeze([
  'foundation',
  'intermediate',
  'advanced',
] as const satisfies readonly QuestionDifficulty[]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcError {
  code?: string;
  message?: string;
}

interface RpcResponse {
  data: unknown;
  error: RpcError | null;
}

export interface QuestionRpcClient {
  rpc: (
    functionName: string,
    parameters?: Record<string, unknown>,
  ) => PromiseLike<RpcResponse>;
}

interface CatalogOptions {
  category?: QuestionCategory;
  difficulty?: QuestionDifficulty;
  university?: string;
  limit?: number;
}

const invalidRequest = () => new Error('Question request is invalid.');
const invalidResponse = () => new Error('Question service returned an invalid response.');
const unavailable = () => new Error('Question service is unavailable.');
const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

async function callRpc(
  client: QuestionRpcClient,
  functionName: string,
  parameters?: Record<string, unknown>,
): Promise<unknown> {
  try {
    const response = parameters
      ? client.rpc(functionName, parameters)
      : client.rpc(functionName);
    const { data, error } = await response;
    if (error) throw unavailable();
    return data;
  } catch (error) {
    if (error instanceof Error && error.message === 'Question service is unavailable.') {
      throw error;
    }
    throw unavailable();
  }
}

function parseStudentQuestion(value: unknown): Question {
  if (!isRecord(value)) throw invalidResponse();

  const tags = value.university_tags;
  const averageScore = typeof value.avg_score === 'number'
    ? value.avg_score
    : Number(value.avg_score);
  const valid = (
    typeof value.id === 'string'
    && UUID_PATTERN.test(value.id)
    && QUESTION_CATEGORIES.includes(value.category as QuestionCategory)
    && (value.subcategory === null || typeof value.subcategory === 'string')
    && typeof value.text === 'string'
    && value.text.length >= 20
    && value.text.length <= 2000
    && Array.isArray(tags)
    && tags.every(tag => typeof tag === 'string')
    && QUESTION_DIFFICULTIES.includes(value.difficulty as QuestionDifficulty)
    && typeof value.is_mmi_suitable === 'boolean'
    && Number.isInteger(value.times_attempted)
    && Number(value.times_attempted) >= 0
    && Number.isFinite(averageScore)
    && averageScore >= 0
    && averageScore <= 100
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at))
  );
  if (!valid) throw invalidResponse();

  return {
    id: value.id as string,
    category: value.category as QuestionCategory,
    subcategory: value.subcategory as string | null,
    text: value.text as string,
    guidance_notes: null,
    university_tags: [...tags] as string[],
    difficulty: value.difficulty as QuestionDifficulty,
    is_mmi_suitable: value.is_mmi_suitable as boolean,
    times_attempted: Number(value.times_attempted),
    avg_score: averageScore,
    created_at: value.created_at as string,
  };
}

export async function fetchQuestionCatalog(
  client: QuestionRpcClient,
  options: CatalogOptions = {},
): Promise<Question[]> {
  const limit = options.limit ?? 50;
  const university = options.university?.trim().toLowerCase() || null;
  if (
    (options.category && !QUESTION_CATEGORIES.includes(options.category))
    || (options.difficulty && !QUESTION_DIFFICULTIES.includes(options.difficulty))
    || !Number.isInteger(limit)
    || limit < 1
    || limit > 100
    || (university !== null && university.length > 60)
  ) {
    throw invalidRequest();
  }

  const data = await callRpc(client, 'list_legacy_questions', {
    p_category: options.category ?? null,
    p_difficulty: options.difficulty ?? null,
    p_university: university,
    p_limit: limit,
  });
  if (!Array.isArray(data)) throw invalidResponse();
  return data.map(parseStudentQuestion);
}

export async function fetchQuestionById(
  client: QuestionRpcClient,
  questionId: string,
): Promise<Question | null> {
  if (!UUID_PATTERN.test(questionId)) throw invalidRequest();
  const data = await callRpc(client, 'get_legacy_question', { p_question_id: questionId });
  if (!Array.isArray(data) || data.length > 1) throw invalidResponse();
  return data.length === 0 ? null : parseStudentQuestion(data[0]);
}

export async function fetchQuestionCounts(client: QuestionRpcClient): Promise<QuestionCounts> {
  const data = await callRpc(client, 'get_legacy_question_counts');
  if (!Array.isArray(data)) throw invalidResponse();

  return data.reduce<QuestionCounts>((counts, row) => {
    if (!isRecord(row) || !QUESTION_CATEGORIES.includes(row.category as QuestionCategory)) {
      throw invalidResponse();
    }
    const count = typeof row.question_count === 'number'
      ? row.question_count
      : Number(row.question_count);
    if (!Number.isSafeInteger(count) || count < 0 || counts[row.category as QuestionCategory] !== 0) {
      throw invalidResponse();
    }
    return { ...counts, [row.category as QuestionCategory]: count };
  }, Object.fromEntries(QUESTION_CATEGORIES.map(category => [category, 0])) as QuestionCounts);
}

export async function createQuestionRows(
  client: QuestionRpcClient,
  questions: readonly QuestionDraft[],
): Promise<string[]> {
  if (questions.length < 1 || questions.length > 500) throw invalidRequest();
  const normalized = questions.map(question => {
    const validation = validateQuestionDraft(question);
    if (!validation.success) throw invalidRequest();
    return validation.data;
  });
  const data = await callRpc(client, 'create_legacy_questions', { p_rows: normalized });
  if (!Array.isArray(data) || data.length !== normalized.length) throw invalidResponse();

  const indexedIds = data.map(row => {
    if (
      !isRecord(row)
      || !Number.isInteger(row.source_index)
      || Number(row.source_index) < 0
      || Number(row.source_index) >= normalized.length
      || typeof row.id !== 'string'
      || !UUID_PATTERN.test(row.id)
    ) {
      throw invalidResponse();
    }
    return { sourceIndex: Number(row.source_index), id: row.id };
  });
  if (new Set(indexedIds.map(row => row.sourceIndex)).size !== normalized.length) {
    throw invalidResponse();
  }
  return indexedIds
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
    .map(row => row.id);
}
