export type RubricCriterionSnapshot = Readonly<{
  criterionId: string;
  bulletText: string;
  domain: string | null;
}>;

export type ProviderCriterionDecision = Readonly<{
  criterionId: string;
  achieved: boolean;
  evidenceReference: Readonly<{ start: number; end: number }> | null;
}>;

export type PublicRubricAssessment = Readonly<{
  schemaVersion: 3;
  questionScorePct: number;
  criteria: readonly Readonly<{
    criterionId: string;
    achieved: boolean;
    weightPct: number;
  }>[];
}>;

type JsonSchema = Readonly<Record<string, unknown>>;

export const MAX_RUBRIC_EVIDENCE_QUOTE_CODE_POINTS = 300;
export const MAX_RUBRIC_EVIDENCE_EXCERPT_CODE_POINTS = 300;
const RUBRIC_EVIDENCE_EXCERPT_STRIDE_CODE_POINTS = 150;
const MAX_RUBRIC_EVIDENCE_TRANSCRIPT_CODE_POINTS = 12_000;

export type RubricEvidenceExcerpt = Readonly<{
  evidenceId: string;
  text: string;
  evidenceReference: Readonly<{ start: number; end: number }>;
}>;

const RUBRIC_VALIDATION_REASONS = Object.freeze([
  'envelope', 'count', 'order', 'quote_null', 'quote_too_long', 'quote_not_found', 'internal',
  'evidence_null', 'evidence_unknown',
] as const);
export type RubricAssessmentValidationReason = typeof RUBRIC_VALIDATION_REASONS[number];

/** Carries only a fixed operational label; candidate and provider content is never retained. */
export class RubricAssessmentValidationError extends Error {
  readonly reason: RubricAssessmentValidationReason;

  constructor(reason: RubricAssessmentValidationReason) {
    super('AI_PROVIDER_RESPONSE_INVALID');
    this.name = 'RubricAssessmentValidationError';
    this.reason = RUBRIC_VALIDATION_REASONS.includes(reason) ? reason : 'internal';
  }
}

const invalidQuoteAssessment = (reason: RubricAssessmentValidationReason): never => {
  throw new RubricAssessmentValidationError(reason);
};

const invalidAssessment = (): never => {
  throw new Error('AI_PROVIDER_RESPONSE_INVALID');
};

function criterionIds(criteria: readonly RubricCriterionSnapshot[]): readonly string[] {
  if (criteria.length === 0 || criteria.some((criterion) => !criterion.criterionId)) invalidAssessment();
  const ids = criteria.map((criterion) => criterion.criterionId);
  if (new Set(ids).size !== ids.length) invalidAssessment();
  return ids;
}

/** Creates the exact provider response contract for this immutable rubric snapshot. */
export function createRubricResponseSchema(criteria: readonly RubricCriterionSnapshot[]): JsonSchema {
  const ids = criterionIds(criteria);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['decisions'],
    properties: {
      decisions: {
        type: 'array',
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterionId', 'achieved', 'evidenceReference'],
          properties: {
            criterionId: { type: 'string', enum: ids },
            achieved: { type: 'boolean' },
            evidenceReference: {
              anyOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['start', 'end'],
                  properties: {
                    start: { type: 'integer', minimum: 0 },
                    end: { type: 'integer', minimum: 1 },
                  },
                },
                { type: 'null' },
              ],
            },
          },
        },
      },
    },
  };
}

/** Provider-only contract: quote evidence instead of asking the model to count characters. */
export function createRubricQuoteResponseSchema(criteria: readonly RubricCriterionSnapshot[]): JsonSchema {
  const ids = criterionIds(criteria);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['decisions'],
    properties: {
      decisions: {
        type: 'array',
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterionId', 'achieved', 'evidenceQuote'],
          properties: {
            criterionId: { type: 'string', enum: ids },
            achieved: { type: 'boolean' },
            evidenceQuote: {
              anyOf: [
                { type: 'string', minLength: 1, maxLength: MAX_RUBRIC_EVIDENCE_QUOTE_CODE_POINTS },
                { type: 'null' },
              ],
            },
          },
        },
      },
    },
  };
}

/** Creates bounded, overlapping evidence ranges without asking the model to copy text. */
export function createRubricEvidenceExcerpts(transcript: string): readonly RubricEvidenceExcerpt[] {
  if (typeof transcript !== 'string' || !transcript.trim()) invalidQuoteAssessment('evidence_null');
  const points = Array.from(transcript);
  if (points.length > MAX_RUBRIC_EVIDENCE_TRANSCRIPT_CODE_POINTS) invalidQuoteAssessment('envelope');
  const excerpts: RubricEvidenceExcerpt[] = [];
  for (let start = 0; start < points.length; start += RUBRIC_EVIDENCE_EXCERPT_STRIDE_CODE_POINTS) {
    const end = Math.min(start + MAX_RUBRIC_EVIDENCE_EXCERPT_CODE_POINTS, points.length);
    const text = points.slice(start, end).join('');
    if (text.trim()) excerpts.push(Object.freeze({
      evidenceId: `E${excerpts.length + 1}`,
      text,
      evidenceReference: Object.freeze({ start, end }),
    }));
    if (end === points.length) break;
  }
  return Object.freeze(excerpts);
}

/** The provider can select only server-created evidence identifiers or null. */
export function createRubricExcerptResponseSchema(
  criteria: readonly RubricCriterionSnapshot[],
  transcript: string,
): JsonSchema {
  const ids = criterionIds(criteria);
  const evidenceIds = createRubricEvidenceExcerpts(transcript).map(({ evidenceId }) => evidenceId);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['decisions'],
    properties: {
      decisions: {
        type: 'array',
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterionId', 'achieved', 'evidenceId'],
          properties: {
            criterionId: { type: 'string', enum: ids },
            achieved: { type: 'boolean' },
            evidenceId: { anyOf: [{ type: 'string', enum: evidenceIds }, { type: 'null' }] },
          },
        },
      },
    },
  };
}

/** Independently rebuilds the server evidence map; provider text and offsets are never accepted. */
export function parseRubricExcerptProviderAssessment(
  raw: unknown,
  criteria: readonly RubricCriterionSnapshot[],
  transcript: string,
): readonly ProviderCriterionDecision[] {
  const ids = criterionIds(criteria);
  const evidenceById = new Map(createRubricEvidenceExcerpts(transcript).map((excerpt) => [excerpt.evidenceId, excerpt]));
  if (typeof raw !== 'string') invalidQuoteAssessment('envelope');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    invalidQuoteAssessment('envelope');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalidQuoteAssessment('envelope');
  const envelope = parsed as Record<string, unknown>;
  const rawDecisions = envelope.decisions;
  if (Object.keys(envelope).length !== 1 || !Array.isArray(rawDecisions)) invalidQuoteAssessment('envelope');
  if ((rawDecisions as unknown[]).length !== ids.length) invalidQuoteAssessment('count');
  const decisions = (rawDecisions as unknown[]).map((value, index): ProviderCriterionDecision => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidQuoteAssessment('envelope');
    const decision = value as Record<string, unknown>;
    if (Object.keys(decision).length !== 3 || !('criterionId' in decision) || !('achieved' in decision) || !('evidenceId' in decision)) {
      invalidQuoteAssessment('envelope');
    }
    if (decision.criterionId !== ids[index]) invalidQuoteAssessment('order');
    if (typeof decision.achieved !== 'boolean') invalidQuoteAssessment('envelope');
    if (!decision.achieved) {
      if (decision.evidenceId !== null) invalidQuoteAssessment('evidence_null');
      return { criterionId: ids[index], achieved: false, evidenceReference: null };
    }
    if (decision.evidenceId === null) invalidQuoteAssessment('evidence_null');
    if (typeof decision.evidenceId !== 'string') invalidQuoteAssessment('evidence_unknown');
    const excerpt = evidenceById.get(decision.evidenceId as string);
    if (!excerpt) invalidQuoteAssessment('evidence_unknown');
    return { criterionId: ids[index], achieved: true, evidenceReference: (excerpt as RubricEvidenceExcerpt).evidenceReference };
  });
  return parseRubricProviderAssessment(JSON.stringify({ decisions }), criteria, transcript);
}

/** Resolves only exact candidate quotations to the retained internal evidence contract. */
export function parseRubricQuoteProviderAssessment(
  raw: unknown,
  criteria: readonly RubricCriterionSnapshot[],
  transcript: string,
): readonly ProviderCriterionDecision[] {
  const ids = criterionIds(criteria);
  if (typeof raw !== 'string' || typeof transcript !== 'string') invalidQuoteAssessment('envelope');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    invalidQuoteAssessment('envelope');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalidQuoteAssessment('envelope');
  const envelope = parsed as Record<string, unknown>;
  const rawDecisions = envelope.decisions;
  if (Object.keys(envelope).length !== 1 || !Array.isArray(rawDecisions)) {
    invalidQuoteAssessment('envelope');
  }
  if ((rawDecisions as unknown[]).length !== ids.length) invalidQuoteAssessment('count');
  const transcriptPoints = Array.from(transcript);
  const decisions = (rawDecisions as unknown[]).map((value, index): ProviderCriterionDecision => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidQuoteAssessment('envelope');
    const decision = value as Record<string, unknown>;
    if (Object.keys(decision).length !== 3 || !('criterionId' in decision) || !('achieved' in decision) || !('evidenceQuote' in decision)) {
      invalidQuoteAssessment('envelope');
    }
    if (decision.criterionId !== ids[index]) invalidQuoteAssessment('order');
    if (typeof decision.achieved !== 'boolean') invalidQuoteAssessment('envelope');
    if (!decision.achieved) {
      if (decision.evidenceQuote !== null) invalidQuoteAssessment('quote_null');
      return { criterionId: ids[index], achieved: false, evidenceReference: null };
    }
    const quote = decision.evidenceQuote;
    if (typeof quote !== 'string' || !quote.trim()) invalidQuoteAssessment('quote_null');
    if (codePointLength(quote as string) > MAX_RUBRIC_EVIDENCE_QUOTE_CODE_POINTS) invalidQuoteAssessment('quote_too_long');
    const matchedAt = transcript.indexOf(quote as string);
    if (matchedAt < 0) invalidQuoteAssessment('quote_not_found');
    const start = codePointLength(transcript.slice(0, matchedAt));
    const end = start + codePointLength(quote as string);
    // A partial UTF-16 surrogate must never become an evidence code-point range.
    if (transcriptPoints.slice(start, end).join('') !== quote) invalidQuoteAssessment('internal');
    return { criterionId: ids[index], achieved: true, evidenceReference: { start, end } };
  });
  return parseRubricProviderAssessment(JSON.stringify({ decisions }), criteria, transcript);
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function parseEvidence(value: unknown, transcriptLength: number): ProviderCriterionDecision['evidenceReference'] {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidAssessment();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !('start' in record) || !('end' in record)) invalidAssessment();
  const start = record.start;
  const end = record.end;
  if (!isSafeInteger(start) || !isSafeInteger(end) || start < 0 || end <= start || end > transcriptLength) {
    invalidAssessment();
  }
  return { start: start as number, end: end as number };
}

/** Parses only a complete, ordered assessment; provider-created scores are never accepted. */
export function parseRubricProviderAssessment(
  raw: unknown,
  criteria: readonly RubricCriterionSnapshot[],
  transcript: string,
): readonly ProviderCriterionDecision[] {
  const ids = criterionIds(criteria);
  if (typeof raw !== 'string' || typeof transcript !== 'string') invalidAssessment();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw as string);
  } catch {
    invalidAssessment();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalidAssessment();
  const envelope = parsed as Record<string, unknown>;
  const rawDecisions = envelope.decisions;
  if (Object.keys(envelope).length !== 1 || !Array.isArray(rawDecisions) || rawDecisions.length !== ids.length) {
    invalidAssessment();
  }
  const transcriptLength = codePointLength(transcript);
  return (rawDecisions as unknown[]).map((value: unknown, index: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidAssessment();
    const decision = value as Record<string, unknown>;
    if (Object.keys(decision).length !== 3 || !('criterionId' in decision) || !('achieved' in decision) || !('evidenceReference' in decision)) {
      invalidAssessment();
    }
    if (typeof decision.criterionId !== 'string' || decision.criterionId !== ids[index] || typeof decision.achieved !== 'boolean') {
      invalidAssessment();
    }
    const evidenceReference = parseEvidence(decision.evidenceReference, transcriptLength);
    if ((decision.achieved && evidenceReference === null) || (!decision.achieved && evidenceReference !== null)) invalidAssessment();
    return Object.freeze({ criterionId: decision.criterionId as string, achieved: decision.achieved as boolean, evidenceReference: evidenceReference === null ? null : Object.freeze(evidenceReference) });
  });
}

const roundPct = (value: number): number => Math.round(value * 100) / 100;
const roundWeightPct = (value: number): number => Math.round(value * 100_000_000) / 100_000_000;

/** Projects a validated rubric result without retaining provider evidence or candidate transcript. */
export function toPublicRubricAssessment(
  decisions: readonly ProviderCriterionDecision[],
  criteria: readonly RubricCriterionSnapshot[],
  transcript: string,
): PublicRubricAssessment {
  const parsed = parseRubricProviderAssessment(JSON.stringify({ decisions }), criteria, transcript);
  const weightPct = roundWeightPct(100 / criteria.length);
  const questionScorePct = roundPct(parsed.filter((decision) => decision.achieved).length / criteria.length * 100);
  return Object.freeze({
    schemaVersion: 3,
    questionScorePct,
    criteria: Object.freeze(parsed.map((decision) => Object.freeze({
      criterionId: decision.criterionId,
      achieved: decision.achieved,
      weightPct,
    }))),
  });
}
