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

/** Projects a validated rubric result without retaining provider evidence or candidate transcript. */
export function toPublicRubricAssessment(
  decisions: readonly ProviderCriterionDecision[],
  criteria: readonly RubricCriterionSnapshot[],
  transcript: string,
): PublicRubricAssessment {
  const parsed = parseRubricProviderAssessment(JSON.stringify({ decisions }), criteria, transcript);
  const weightPct = roundPct(100 / criteria.length);
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
