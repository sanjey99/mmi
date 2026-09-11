export type AdminMmiDifficulty = 'foundation' | 'intermediate' | 'advanced';
export type AdminMmiContentStatus = 'draft' | 'published' | 'archived';
export type AdminMmiProvider = 'anthropic' | 'openai' | 'openai_compatible';
export type AdminMmiAssessmentPurpose =
  | 'scoring_review'
  | 'support'
  | 'cost_review'
  | 'quality_audit';

export type AdminMmiCriterionDraft = Readonly<{
  criterionId: string;
  order: number;
  bulletText: string;
  domain: string | null;
  sourceWeight: number;
}>;

export type AdminMmiQuestionDraft = Readonly<{
  subQuestionId: string;
  order: number;
  questionText: string;
  timeLimitSec: 120;
  modelAnswerCached: string | null;
  criteria: readonly AdminMmiCriterionDraft[];
}>;

export type AdminMmiStationDraft = Readonly<{
  stationId: string;
  expectedVersion: number | null;
  category: string;
  topic: string;
  difficulty: AdminMmiDifficulty;
  universityTags: readonly string[];
  prepTimeSec: 60;
  imageUrl: string | null;
  scenarioText: string;
  questions: readonly AdminMmiQuestionDraft[];
}>;

export type AdminMmiValidationMode = 'draft' | 'publish';
export type AdminMmiValidationIssue = Readonly<{
  path: string;
  code:
    | 'required'
    | 'too_long'
    | 'invalid_id'
    | 'invalid_url'
    | 'invalid_number'
    | 'invalid_prep_time'
    | 'invalid_question_orders'
    | 'invalid_response_time'
    | 'duplicate_tag'
    | 'duplicate_criterion_id'
    | 'duplicate_criterion_order';
  message: string;
}>;
export type AdminMmiEqualWeightPreview = Readonly<{
  subQuestionId: string;
  criteria: readonly Readonly<{ criterionId: string; weightPct: number }>[];
}>;
export type AdminMmiStationValidation = Readonly<{
  value: AdminMmiStationDraft;
  issues: readonly AdminMmiValidationIssue[];
  equalWeightPreview: readonly AdminMmiEqualWeightPreview[];
}>;

export type AdminMmiDashboard = Readonly<{
  stationCounts: Readonly<{ draft: number; published: number; archived: number }>;
  universityCounts: readonly Readonly<{ tag: string; count: number }>[];
  contentHealth: Readonly<{
    stationCount: number;
    questionCount: number;
    criterionCount: number;
    invalidStationCount: number;
  }>;
  ai: Readonly<{ provider: AdminMmiProvider; model: string; isConfigured: boolean }>;
  usage: Readonly<{
    periodStart: string;
    periodEnd: string;
    callCount: number;
    knownCost: string;
    unknownCostCount: number;
    failureCount: number;
  }>;
}>;

export type AdminMmiStationSummary = Readonly<{
  stationId: string;
  category: string;
  topic: string;
  difficulty: AdminMmiDifficulty;
  universityTags: readonly string[];
  prepTimeSec: number;
  status: AdminMmiContentStatus;
  contentVersion: number;
  questionCount: number;
  criterionCount: number;
  isComplete: boolean;
  updatedAt: string;
}>;
export type AdminMmiStationList = Readonly<{
  items: readonly AdminMmiStationSummary[];
  total: number;
}>;
export type AdminMmiStationDetail = Readonly<{
  station: AdminMmiStationDraft;
  status: AdminMmiContentStatus;
  contentVersion: number;
}>;

export type AdminMmiPanel = Readonly<{
  questionId: string;
  questionText: string;
  stationType: string;
  topic: string;
  difficulty: AdminMmiDifficulty;
  universityTags: readonly string[];
  notes: string | null;
  modelAnswerCached: string | null;
  status: AdminMmiContentStatus;
  updatedAt: string;
}>;
export type AdminMmiPanelList = Readonly<{
  items: readonly AdminMmiPanel[];
  total: number;
}>;

export type AdminMmiAiConfig = Readonly<{
  provider: AdminMmiProvider;
  model: string;
  baseUrl: string | null;
  inputRatePerMillion: number;
  cachedInputRatePerMillion: number;
  outputRatePerMillion: number;
  isConfigured: boolean;
  updatedAt: string;
}>;
export type AdminMmiAiConfigInput = Readonly<Omit<AdminMmiAiConfig, 'isConfigured' | 'updatedAt'>>;

export type AdminMmiUsageSummary = Readonly<{
  callCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  knownCost: string;
  unknownCostCount: number;
  averageLatencyMs: number;
  failureRatePct: number;
}>;
export type AdminMmiUsageRow = Readonly<{
  usageId: string;
  userId: string;
  userDisplayName: string;
  sessionId: string;
  responseId: string;
  stationId: string;
  promptOrder: number;
  scope: 'target' | 'all' | null;
  targetUniversity: string | null;
  provider: string;
  model: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: string | null;
  latencyMs: number;
  outcome: 'scored' | 'provider_failed' | 'invalid_response' | 'persistence_failed';
  createdAt: string;
}>;
export type AdminMmiUsage = Readonly<{
  summary: AdminMmiUsageSummary;
  rows: readonly AdminMmiUsageRow[];
}>;

export type AdminMmiAssessmentSummary = Readonly<{
  responseId: string;
  userId: string;
  userDisplayName: string;
  stationId: string;
  subQuestionId: string;
  promptOrder: number;
  questionScorePct: number;
  provider: string | null;
  model: string | null;
  estimatedCost: string | null;
  costKnown: boolean;
  outcome: AdminMmiUsageRow['outcome'] | null;
  scoredAt: string;
}>;
export type AdminMmiAssessmentList = Readonly<{
  items: readonly AdminMmiAssessmentSummary[];
  total: number;
}>;
export type AdminMmiAssessmentDetail = Readonly<{
  accessAuditId: string;
  responseId: string;
  userId: string;
  userDisplayName: string;
  stationId: string;
  subQuestionId: string;
  promptOrder: number;
  questionScorePct: number;
  criteria: readonly Readonly<{
    criterionId: string;
    bulletText: string;
    domain: string | null;
    achieved: boolean;
    weightPct: number;
  }>[];
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: string | null;
  latencyMs: number | null;
  outcome: AdminMmiUsageRow['outcome'] | null;
  finalizedAt: string;
  scoredAt: string;
}>;

export type AdminMmiMutationConfirmation = Readonly<{
  ok: true;
  auditId: string;
  targetId: string;
  version: number | null;
}>;

export type AdminMmiStationFilters = Readonly<{
  query?: string;
  status?: AdminMmiContentStatus;
  university?: string;
  category?: string;
  topic?: string;
  difficulty?: AdminMmiDifficulty;
  limit: number;
  offset: number;
}>;
export type AdminMmiPageFilters = Readonly<{ limit: number; offset: number }>;
export type AdminMmiUsageFilters = AdminMmiPageFilters & Readonly<{
  from?: string;
  to?: string;
  userId?: string;
  provider?: string;
  model?: string;
  stationId?: string;
  scope?: 'target' | 'all';
  outcome?: AdminMmiUsageRow['outcome'];
}>;
export type AdminMmiAssessmentFilters = AdminMmiPageFilters & Readonly<{
  from?: string;
  to?: string;
  userId?: string;
  provider?: string;
  model?: string;
  stationId?: string;
}>;

export type AdminMmiRpcResult = Readonly<{
  data: unknown;
  error: Readonly<{ code?: string; message?: string }> | null;
}>;
export type AdminMmiRpcClient = Readonly<{
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<AdminMmiRpcResult>;
}>;
