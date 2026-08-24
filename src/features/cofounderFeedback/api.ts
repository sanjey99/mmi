const FEEDBACK_CATEGORIES = Object.freeze([
  'bug',
  'usability',
  'content',
  'scoring',
  'idea',
  'other',
] as const);
const FEEDBACK_SEVERITIES = Object.freeze([
  'blocking',
  'major',
  'minor',
  'suggestion',
] as const);
const FEEDBACK_SCREENS = Object.freeze([
  'orientation',
  'practice',
  'feedback',
  'progress',
  'profile',
  'question_desk',
  'ai_config',
  'other',
] as const);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;

export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];
export type FeedbackSeverity = typeof FEEDBACK_SEVERITIES[number];
export type FeedbackScreen = typeof FEEDBACK_SCREENS[number];

export interface CofounderFeedbackInput {
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  screen: FeedbackScreen;
  message: string;
  appVersion: string;
  allowReply: boolean;
}

export interface CofounderFeedbackReview {
  id: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  screen: FeedbackScreen;
  message: string;
  appVersion: string;
  allowReply: boolean;
  authorId: string | null;
  createdAt: string;
}

interface RpcResponse {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface FeedbackRpcClient {
  rpc: (
    functionName: string,
    parameters?: Record<string, unknown>,
  ) => PromiseLike<RpcResponse>;
}

const invalidRequest = () => new Error('Feedback request is invalid.');
const invalidResponse = () => new Error('Feedback service returned an invalid response.');
const unavailable = () => new Error('Feedback service is unavailable.');
const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

async function callRpc(
  client: FeedbackRpcClient,
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
    if (error instanceof Error && error.message === 'Feedback service is unavailable.') throw error;
    throw unavailable();
  }
}

function normalizeInput(input: CofounderFeedbackInput): CofounderFeedbackInput {
  const message = input.message.trim();
  const appVersion = input.appVersion.trim();
  if (message.length < 10 || message.length > 2000) {
    throw new Error('Feedback must be between 10 and 2000 characters.');
  }
  if (
    !FEEDBACK_CATEGORIES.includes(input.category)
    || !FEEDBACK_SEVERITIES.includes(input.severity)
    || !FEEDBACK_SCREENS.includes(input.screen)
    || !VERSION_PATTERN.test(appVersion)
    || typeof input.allowReply !== 'boolean'
  ) {
    throw invalidRequest();
  }
  return { ...input, message, appVersion };
}

export async function submitCofounderFeedback(
  client: FeedbackRpcClient,
  input: CofounderFeedbackInput,
): Promise<string> {
  const normalized = normalizeInput(input);
  const data = await callRpc(client, 'submit_cofounder_feedback', {
    p_category: normalized.category,
    p_severity: normalized.severity,
    p_screen: normalized.screen,
    p_message: normalized.message,
    p_app_version: normalized.appVersion,
    p_allow_reply: normalized.allowReply,
  });
  if (typeof data !== 'string' || !UUID_PATTERN.test(data)) throw invalidResponse();
  return data;
}

function parseReview(value: unknown): CofounderFeedbackReview {
  if (!isRecord(value)) throw invalidResponse();
  const valid = (
    typeof value.id === 'string'
    && UUID_PATTERN.test(value.id)
    && FEEDBACK_CATEGORIES.includes(value.category as FeedbackCategory)
    && FEEDBACK_SEVERITIES.includes(value.severity as FeedbackSeverity)
    && FEEDBACK_SCREENS.includes(value.screen as FeedbackScreen)
    && typeof value.message === 'string'
    && value.message.length >= 10
    && value.message.length <= 2000
    && typeof value.app_version === 'string'
    && VERSION_PATTERN.test(value.app_version)
    && typeof value.allow_reply === 'boolean'
    && (value.author_id === null || (typeof value.author_id === 'string' && UUID_PATTERN.test(value.author_id)))
    && (value.allow_reply === true || value.author_id === null)
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at))
  );
  if (!valid) throw invalidResponse();
  return {
    id: value.id as string,
    category: value.category as FeedbackCategory,
    severity: value.severity as FeedbackSeverity,
    screen: value.screen as FeedbackScreen,
    message: value.message as string,
    appVersion: value.app_version as string,
    allowReply: value.allow_reply as boolean,
    authorId: value.author_id as string | null,
    createdAt: value.created_at as string,
  };
}

export async function listCofounderFeedback(
  client: FeedbackRpcClient,
  limit = 100,
): Promise<CofounderFeedbackReview[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw invalidRequest();
  const data = await callRpc(client, 'list_cofounder_feedback', { p_limit: limit });
  if (!Array.isArray(data)) throw invalidResponse();
  return data.map(parseReview);
}
