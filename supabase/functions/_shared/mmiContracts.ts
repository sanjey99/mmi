export const MMI_DIMENSIONS = Object.freeze([
  'structure',
  'ethics',
  'communication',
  'reflection',
  'nhs_awareness',
] as const);

export const MMI_IMPROVEMENT_FRAMEWORKS = Object.freeze([
  'sbar',
  'starr',
  'spar',
  'four-pillars',
] as const);

export const MMI_STUDENT_FEEDBACK_TEMPLATES = Object.freeze([
  'clear-priorities',
  'balanced-ethical-reasoning',
  'patient-centred-language',
  'reflective-learning',
  'nhs-context',
  'explicit-safety-netting',
  'weigh-ethical-pillars',
  'check-understanding',
  'deepen-reflection',
  'connect-nhs-values',
  'escalate-immediate-risk',
  'protect-confidentiality',
  'seek-senior-support',
] as const);

export type MmiDimension = (typeof MMI_DIMENSIONS)[number];
export type MmiScore = 1 | 2 | 3 | 4 | 5;
export type MmiImprovementFramework = (typeof MMI_IMPROVEMENT_FRAMEWORKS)[number];
export type MmiStudentFeedbackTemplate = (typeof MMI_STUDENT_FEEDBACK_TEMPLATES)[number];
export type MmiFeedbackKind = 'strength' | 'improvement';

export type MmiPromptIdentity =
  | { promptKind: 'standard'; stationId: string; subQuestionId: string }
  | { promptKind: 'roleplay'; stationId: string };

export interface MmiTranscriptEvidenceReference {
  start: number;
  end: number;
}

export interface MmiDimensionResult {
  score: MmiScore | null;
  applicable: boolean;
  evidence: string | null;
  improvement: string | null;
}

export interface MmiAssessment {
  dimensions: Record<MmiDimension, MmiDimensionResult>;
  overallPct: number;
  strengths: string[];
  improvements: string[];
  improvementTip: string;
  rubricVersion: number;
}

export type SubmitMmiPromptRequest = MmiPromptIdentity & {
  attemptId: string;
  transcript: string;
  idempotencyKey: string;
};

export interface MmiRubricCriterion {
  dimension: MmiDimension;
  kind: MmiFeedbackKind;
  assessorCriterion: string;
  studentFeedback: MmiStudentFeedbackTemplate;
}

export interface MmiSafetyCriticalItem {
  id: string;
  assessorCriterion: string;
  studentFeedback: MmiStudentFeedbackTemplate;
}

export interface MmiRubric {
  version: number;
  criteria: Record<string, MmiRubricCriterion>;
  dimensionWeights: Record<MmiDimension, number>;
  safetyCriticalItems: MmiSafetyCriticalItem[];
}

export interface ProviderMmiDimensionResult {
  score: MmiScore | null;
  evidenceReference: MmiTranscriptEvidenceReference | null;
}

export interface ProviderAssessment {
  dimensions: Record<MmiDimension, ProviderMmiDimensionResult>;
  rubricStrengthCodes: string[];
  rubricImprovementCodes: string[];
  safetyCriticalOmissionCodes: string[];
  improvementFramework: MmiImprovementFramework;
}

declare const VALIDATED_PUBLIC_OUTPUT_CONTEXT_TYPE: unique symbol;
export type ValidatedMmiPublicOutputContext = {
  readonly [VALIDATED_PUBLIC_OUTPUT_CONTEXT_TYPE]: true;
};

type StudentTemplateKind = MmiFeedbackKind | 'safety';
export interface MmiStudentTemplateDefinition {
  readonly kind: StudentTemplateKind;
  readonly text: string;
}

export interface MmiStudentFeedbackCatalog {
  readonly templates: Readonly<Record<string, MmiStudentTemplateDefinition>>;
  readonly frameworkTips: Readonly<Record<string, string>>;
}

interface ProviderAssessmentRules {
  readonly dimensionWeights: Readonly<Record<MmiDimension, number>>;
  readonly strengthCodes: readonly string[];
  readonly improvementCodes: readonly string[];
  readonly improvementCodeDimensions: Readonly<Record<string, MmiDimension>>;
  readonly safetyCodes: readonly string[];
}

interface PublicFeedbackRule {
  readonly code: string;
  readonly dimension: MmiDimension;
  readonly kind: MmiFeedbackKind;
  readonly text: string;
}

interface PublicSafetyRule {
  readonly code: string;
  readonly text: string;
}

interface MmiPublicOutputContextData {
  readonly rubricVersion: number;
  readonly providerRules: ProviderAssessmentRules;
  readonly feedbackRules: readonly PublicFeedbackRule[];
  readonly safetyRules: readonly PublicSafetyRule[];
  readonly frameworkTips: Readonly<Record<MmiImprovementFramework, string>>;
}

const VALIDATED_PUBLIC_OUTPUT_CONTEXTS = new WeakSet<object>();
const PUBLIC_OUTPUT_CONTEXT_DATA = new WeakMap<object, MmiPublicOutputContextData>();

export const MMI_TEXT_LIMITS = Object.freeze({
  transcript: 12_000,
  criteriaEntries: 20,
  criterion: 1_000,
  safetyItems: 20,
  assessorText: 1_000,
  providerCodes: 5,
  evidenceSpan: 600,
  code: 64,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SCORE_VALUES = new Set<number>([1, 2, 3, 4, 5]);
const DIMENSION_VALUES = new Set<string>(MMI_DIMENSIONS);
const FRAMEWORK_VALUES = new Set<string>(MMI_IMPROVEMENT_FRAMEWORKS);
const INVISIBLE_TEXT_PATTERN = /[\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}]/gu;
const CONTROL_TEXT_PATTERN = /[\p{Cc}]/gu;
const UNSAFE_TRANSCRIPT_PATTERN = /[\p{Cs}\p{Cf}\p{Default_Ignorable_Code_Point}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

const V1_STUDENT_FEEDBACK_TEMPLATE_DEFINITIONS: Readonly<Record<string, MmiStudentTemplateDefinition>> = deepFreeze({
  'clear-priorities': { kind: 'strength', text: 'You set out the main priorities in a clear and logical order.' },
  'balanced-ethical-reasoning': { kind: 'strength', text: 'You considered more than one ethical responsibility before reaching a decision.' },
  'patient-centred-language': { kind: 'strength', text: 'You kept the explanation focused on the patient and used accessible language.' },
  'reflective-learning': { kind: 'strength', text: 'You identified a concrete lesson that could improve future practice.' },
  'nhs-context': { kind: 'strength', text: 'You connected your reasoning to relevant NHS values and responsibilities.' },
  'explicit-safety-netting': { kind: 'improvement', text: 'Make the safety-netting steps explicit, including when and how you would escalate.' },
  'weigh-ethical-pillars': { kind: 'improvement', text: 'Explain how the relevant ethical principles support or conflict with each possible action.' },
  'check-understanding': { kind: 'improvement', text: 'Add a clear check that the patient has understood the explanation and next steps.' },
  'deepen-reflection': { kind: 'improvement', text: 'State what you would change next time and how you would know that the change helped.' },
  'connect-nhs-values': { kind: 'improvement', text: 'Link your proposed action to the most relevant NHS value or professional responsibility.' },
  'escalate-immediate-risk': { kind: 'safety', text: 'Explain when you would escalate an immediate risk to a senior clinician.' },
  'protect-confidentiality': { kind: 'safety', text: 'Explain how you would protect confidentiality while responding to the concern.' },
  'seek-senior-support': { kind: 'safety', text: 'Include the point at which you would seek appropriate senior support.' },
});

const V1_FRAMEWORK_TIPS: Readonly<Record<string, string>> = deepFreeze({
  sbar: 'Use SBAR to organise a concise escalation: situation, background, assessment, then recommendation.',
  starr: 'Use STARR to structure the example: situation, task, action, result, then reflection.',
  spar: 'Use SPAR to structure the response: situation, problem, action, then reflection.',
  'four-pillars': 'Use the four pillars to compare autonomy, beneficence, non-maleficence, and justice.',
});

export const MMI_STUDENT_FEEDBACK_CATALOGS: Readonly<Record<string, MmiStudentFeedbackCatalog>> = deepFreeze({
  '2026-08-17.1': {
    templates: V1_STUDENT_FEEDBACK_TEMPLATE_DEFINITIONS,
    frameworkTips: V1_FRAMEWORK_TIPS,
  },
  '2026-09-04.1': {
    templates: V1_STUDENT_FEEDBACK_TEMPLATE_DEFINITIONS,
    frameworkTips: V1_FRAMEWORK_TIPS,
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[], label: string): void {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actualKeys.length !== expected.length || actualKeys.some((key, index) => key !== expected[index])) {
    throw new Error(`Invalid ${label}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid JSON value');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('Invalid JSON value');
}

function parseText(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid ${label}`);
  const length = Array.from(value).length;
  if (length < minimum || length > maximum) throw new Error(`Invalid ${label}`);
  return value;
}

function normalizedDisplayText(value: string): string {
  return value.normalize('NFKC').replace(CONTROL_TEXT_PATTERN, ' ').replace(INVISIBLE_TEXT_PATTERN, '').trim().replace(/\s+/gu, ' ');
}

function parseCanonicalText(value: unknown, label: string, minimum: number, maximum: number): string {
  const parsed = parseText(value, label, 1, maximum);
  const normalized = normalizedDisplayText(parsed);
  const meaningfulLength = normalized.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (meaningfulLength < minimum) throw new Error(`Invalid ${label}`);
  return normalized;
}

function parseIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value !== value.trim() || !IDENTIFIER_PATTERN.test(value)) throw new Error(`Invalid ${label}`);
  const length = Array.from(value).length;
  if (length < 1 || length > 256) throw new Error(`Invalid ${label}`);
  return value;
}

function parseTranscript(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid transcript');
  const codePoints = Array.from(value);
  if (codePoints.length < 20 || codePoints.length > MMI_TEXT_LIMITS.transcript || UNSAFE_TRANSCRIPT_PATTERN.test(value)) {
    throw new Error('Invalid transcript');
  }
  if (!/[\p{L}\p{N}]/u.test(value)) throw new Error('Invalid transcript');
  return value;
}

function parseCode(value: unknown, label: string): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length > MMI_TEXT_LIMITS.code || !CODE_PATTERN.test(value)
    || value === 'constructor' || value === 'prototype' || value === '__proto__') {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function parseDimensionWeights(value: unknown): Record<MmiDimension, number> {
  if (!isRecord(value)) throw new Error('Invalid dimension weights');
  assertExactKeys(value, MMI_DIMENSIONS, 'dimension weights');
  const weights = {} as Record<MmiDimension, number>;
  let total = 0;
  for (const dimension of MMI_DIMENSIONS) {
    const weight = value[dimension];
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error('Invalid dimension weight');
    weights[dimension] = weight;
    total += weight;
  }
  if (Math.abs(total - 1) > Number.EPSILON * 16) throw new Error('Dimension weights must sum to 1');
  return weights;
}

function parseStudentTemplate(
  value: unknown,
  expectedKind: StudentTemplateKind,
  catalog: MmiStudentFeedbackCatalog,
): MmiStudentFeedbackTemplate {
  if (typeof value !== 'string') throw new Error('Invalid student feedback template');
  const definition = catalog.templates[value];
  if (definition === undefined || definition.kind !== expectedKind) throw new Error('Invalid student feedback template');
  return value as MmiStudentFeedbackTemplate;
}

function parseRubricCriteria(
  value: unknown,
  dimensionWeights: Readonly<Record<MmiDimension, number>>,
  catalog: MmiStudentFeedbackCatalog,
): Record<string, MmiRubricCriterion> {
  if (!isRecord(value) || Object.keys(value).length < 2 || Object.keys(value).length > MMI_TEXT_LIMITS.criteriaEntries) {
    throw new Error('Invalid rubric criteria');
  }
  const codes = new Set<string>();
  const templates = new Set<string>();
  const kinds = new Set<MmiFeedbackKind>();
  const criteria: Record<string, MmiRubricCriterion> = {};
  for (const [rawCode, rawCriterion] of Object.entries(value)) {
    const code = parseCode(rawCode, 'rubric criterion code');
    if (!isRecord(rawCriterion)) throw new Error('Invalid rubric criterion');
    assertExactKeys(rawCriterion, ['dimension', 'kind', 'assessorCriterion', 'studentFeedback'], 'rubric criterion');
    if (typeof rawCriterion.dimension !== 'string' || !DIMENSION_VALUES.has(rawCriterion.dimension)) throw new Error('Invalid feedback dimension');
    if (rawCriterion.kind !== 'strength' && rawCriterion.kind !== 'improvement') throw new Error('Invalid feedback kind');
    const dimension = rawCriterion.dimension as MmiDimension;
    if (dimensionWeights[dimension] === 0) throw new Error('Invalid feedback dimension');
    const studentFeedback = parseStudentTemplate(rawCriterion.studentFeedback, rawCriterion.kind, catalog);
    const templateIdentity = `${rawCriterion.kind}:${studentFeedback}`;
    if (codes.has(code) || templates.has(templateIdentity)) throw new Error('Duplicate rubric criterion');
    codes.add(code);
    templates.add(templateIdentity);
    kinds.add(rawCriterion.kind);
    Object.defineProperty(criteria, code, {
      value: {
        dimension,
        kind: rawCriterion.kind,
        assessorCriterion: parseCanonicalText(rawCriterion.assessorCriterion, 'rubric assessor criterion', 10, MMI_TEXT_LIMITS.criterion),
        studentFeedback,
      },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  if (!kinds.has('strength') || !kinds.has('improvement')) throw new Error('Invalid rubric criteria');
  return criteria;
}

function parseSafetyItems(value: unknown, catalog: MmiStudentFeedbackCatalog): MmiSafetyCriticalItem[] {
  if (!Array.isArray(value) || value.length > MMI_TEXT_LIMITS.safetyItems) throw new Error('Invalid safety items');
  const ids = new Set<string>();
  const templates = new Set<MmiStudentFeedbackTemplate>();
  const items: MmiSafetyCriticalItem[] = [];
  for (const rawItem of value) {
    if (!isRecord(rawItem)) throw new Error('Invalid safety item');
    assertExactKeys(rawItem, ['id', 'assessorCriterion', 'studentFeedback'], 'safety item');
    const id = parseCode(rawItem.id, 'safety ID');
    const assessorCriterion = parseCanonicalText(rawItem.assessorCriterion, 'safety assessor criterion', 10, MMI_TEXT_LIMITS.assessorText);
    const studentFeedback = parseStudentTemplate(rawItem.studentFeedback, 'safety', catalog);
    if (ids.has(id) || templates.has(studentFeedback)) throw new Error('Duplicate safety item');
    ids.add(id);
    templates.add(studentFeedback);
    items.push({ id, assessorCriterion, studentFeedback });
  }
  return items;
}

export function parseMmiRubric(
  value: unknown,
  catalog: MmiStudentFeedbackCatalog = MMI_STUDENT_FEEDBACK_CATALOGS['2026-08-17.1'],
): MmiRubric {
  if (!isRecord(value)) throw new Error('Invalid MMI rubric');
  assertExactKeys(value, ['version', 'criteria', 'dimensionWeights', 'safetyCriticalItems'], 'MMI rubric');
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) throw new Error('Invalid rubric version');
  const dimensionWeights = parseDimensionWeights(value.dimensionWeights);
  return {
    version: value.version,
    criteria: parseRubricCriteria(value.criteria, dimensionWeights, catalog),
    dimensionWeights,
    safetyCriticalItems: parseSafetyItems(value.safetyCriticalItems, catalog),
  };
}

export function parseSubmitMmiPromptRequest(value: unknown): SubmitMmiPromptRequest {
  if (!isRecord(value)) throw new Error('Invalid MMI prompt submission');
  const promptKind = value.promptKind;
  if (promptKind !== 'standard' && promptKind !== 'roleplay') throw new Error('Invalid prompt kind');
  assertExactKeys(value, promptKind === 'standard'
    ? ['promptKind', 'stationId', 'subQuestionId', 'attemptId', 'transcript', 'idempotencyKey']
    : ['promptKind', 'stationId', 'attemptId', 'transcript', 'idempotencyKey'], 'MMI prompt submission');
  const attemptId = parseText(value.attemptId, 'attempt ID', 1, 36);
  const idempotencyKey = parseText(value.idempotencyKey, 'idempotency key', 1, 36);
  if (!UUID_PATTERN.test(attemptId) || !UUID_PATTERN.test(idempotencyKey)) throw new Error('Invalid UUID');
  const transcript = parseTranscript(value.transcript);
  const stationId = parseIdentifier(value.stationId, 'station ID');
  if (promptKind === 'standard') return { promptKind, stationId, subQuestionId: parseIdentifier(value.subQuestionId, 'sub-question ID'), attemptId, transcript, idempotencyKey };
  return { promptKind, stationId, attemptId, transcript, idempotencyKey };
}

function providerRulesForRubric(rubric: MmiRubric): ProviderAssessmentRules {
  const criteria = Object.entries(rubric.criteria);
  const improvementCodeDimensions = Object.fromEntries(
    criteria.filter(([, criterion]) => criterion.kind === 'improvement').map(([code, criterion]) => [code, criterion.dimension]),
  );
  return deepFreeze({
    dimensionWeights: { ...rubric.dimensionWeights },
    strengthCodes: criteria.filter(([, criterion]) => criterion.kind === 'strength').map(([code]) => code),
    improvementCodes: criteria.filter(([, criterion]) => criterion.kind === 'improvement').map(([code]) => code),
    improvementCodeDimensions,
    safetyCodes: rubric.safetyCriticalItems.map((item) => item.id),
  });
}

function parseEvidenceReference(
  value: unknown,
  transcriptCodePoints: readonly string[],
  applicable: boolean,
): MmiTranscriptEvidenceReference | null {
  if (!applicable) {
    if (value !== null) throw new Error('Invalid evidence reference');
    return null;
  }
  if (!isRecord(value)) throw new Error('Invalid evidence reference');
  assertExactKeys(value, ['start', 'end'], 'evidence reference');
  if (typeof value.start !== 'number' || typeof value.end !== 'number'
    || !Number.isInteger(value.start) || !Number.isInteger(value.end)
    || value.start < 0 || value.end <= value.start
    || value.end > transcriptCodePoints.length
    || value.end - value.start > MMI_TEXT_LIMITS.evidenceSpan) {
    throw new Error('Invalid evidence reference');
  }
  const excerpt = transcriptCodePoints.slice(value.start, value.end).join('');
  parseCanonicalText(excerpt, 'transcript evidence', 1, MMI_TEXT_LIMITS.evidenceSpan);
  return { start: value.start, end: value.end };
}

function parseProviderCodes(value: unknown, label: string, knownCodes: readonly string[], minimum: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`Invalid ${label}`);
  const known = new Set(knownCodes);
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const rawCode of value) {
    const code = parseCode(rawCode, label);
    if (!known.has(code) || seen.has(code)) throw new Error(`Invalid ${label}`);
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

function parseProviderAssessmentAgainstRules(value: unknown, rules: ProviderAssessmentRules, transcript: string): ProviderAssessment {
  if (!isRecord(value)) throw new Error('Invalid provider assessment');
  assertExactKeys(value, [
    'dimensions', 'rubricStrengthCodes', 'rubricImprovementCodes',
    'safetyCriticalOmissionCodes', 'improvementFramework',
  ], 'provider assessment');
  if (!isRecord(value.dimensions)) throw new Error('Invalid provider dimensions');
  assertExactKeys(value.dimensions, MMI_DIMENSIONS, 'provider dimensions');
  const transcriptCodePoints = Array.from(parseTranscript(transcript));
  const dimensions = {} as Record<MmiDimension, ProviderMmiDimensionResult>;
  for (const dimension of MMI_DIMENSIONS) {
    const rawResult = value.dimensions[dimension];
    if (!isRecord(rawResult)) throw new Error('Invalid provider dimension');
    assertExactKeys(rawResult, ['score', 'evidenceReference'], 'provider dimension');
    const applicable = rules.dimensionWeights[dimension] > 0;
    if (applicable) {
      if (typeof rawResult.score !== 'number' || !SCORE_VALUES.has(rawResult.score)) throw new Error('Invalid provider score');
    } else if (rawResult.score !== null) {
      throw new Error('Invalid provider score');
    }
    dimensions[dimension] = {
      score: applicable ? rawResult.score as MmiScore : null,
      evidenceReference: parseEvidenceReference(rawResult.evidenceReference, transcriptCodePoints, applicable),
    };
  }
  if (typeof value.improvementFramework !== 'string' || !FRAMEWORK_VALUES.has(value.improvementFramework)) {
    throw new Error('Invalid improvement framework');
  }
  const rubricStrengthCodes = parseProviderCodes(value.rubricStrengthCodes, 'rubric strength codes', rules.strengthCodes, 1, MMI_TEXT_LIMITS.providerCodes);
  const rubricImprovementCodes = parseProviderCodes(value.rubricImprovementCodes, 'rubric improvement codes', rules.improvementCodes, 1, MMI_TEXT_LIMITS.providerCodes);
  const improvementDimensions = new Set(rubricImprovementCodes.map((code) => rules.improvementCodeDimensions[code]));
  if (improvementDimensions.size !== rubricImprovementCodes.length) throw new Error('Invalid rubric improvement codes');
  const safetyCriticalOmissionCodes = parseProviderCodes(
    value.safetyCriticalOmissionCodes,
    'safety omission codes',
    rules.safetyCodes,
    0,
    MMI_TEXT_LIMITS.safetyItems,
  );
  if (rubricImprovementCodes.length + safetyCriticalOmissionCodes.length > MMI_TEXT_LIMITS.safetyItems) {
    throw new Error('Invalid provider improvements');
  }
  return {
    dimensions,
    rubricStrengthCodes,
    rubricImprovementCodes,
    safetyCriticalOmissionCodes,
    improvementFramework: value.improvementFramework as MmiImprovementFramework,
  };
}

export function parseProviderAssessment(
  value: unknown,
  rubric: MmiRubric,
  transcript: string,
  catalog: MmiStudentFeedbackCatalog = MMI_STUDENT_FEEDBACK_CATALOGS['2026-08-17.1'],
): ProviderAssessment {
  const parsedRubric = parseMmiRubric(rubric, catalog);
  return parseProviderAssessmentAgainstRules(value, providerRulesForRubric(parsedRubric), transcript);
}

export function createMmiPublicOutputContext(value: unknown): ValidatedMmiPublicOutputContext {
  if (!isRecord(value)) throw new Error('Invalid MMI public output context');
  assertExactKeys(value, ['rubric', 'scoringContractVersion', 'studentFeedbackCatalog'], 'MMI public output context');
  if (typeof value.scoringContractVersion !== 'string') throw new Error('Invalid MMI public output context');
  const approvedCatalog = MMI_STUDENT_FEEDBACK_CATALOGS[value.scoringContractVersion];
  if (approvedCatalog === undefined || canonicalJson(value.studentFeedbackCatalog) !== canonicalJson(approvedCatalog)) {
    throw new Error('Invalid MMI public output context');
  }
  const rubric = parseMmiRubric(value.rubric, approvedCatalog);
  const providerRules = providerRulesForRubric(rubric);
  const feedbackRules = Object.entries(rubric.criteria).map(([code, criterion]) => Object.freeze({
    code,
    dimension: criterion.dimension,
    kind: criterion.kind,
    text: approvedCatalog.templates[criterion.studentFeedback].text,
  }));
  const safetyRules = rubric.safetyCriticalItems.map((item) => Object.freeze({
    code: item.id,
    text: approvedCatalog.templates[item.studentFeedback].text,
  }));
  const context = Object.freeze({}) as ValidatedMmiPublicOutputContext;
  const contextData = deepFreeze({
    rubricVersion: rubric.version,
    providerRules,
    feedbackRules,
    safetyRules,
    frameworkTips: approvedCatalog.frameworkTips,
  });
  VALIDATED_PUBLIC_OUTPUT_CONTEXTS.add(context);
  PUBLIC_OUTPUT_CONTEXT_DATA.set(context, contextData);
  return context;
}

function getPublicOutputContextData(context: unknown): MmiPublicOutputContextData {
  if (typeof context !== 'object' || context === null || !VALIDATED_PUBLIC_OUTPUT_CONTEXTS.has(context)) {
    throw new Error('Invalid MMI public output context');
  }
  const contextData = PUBLIC_OUTPUT_CONTEXT_DATA.get(context);
  if (contextData === undefined) throw new Error('Invalid MMI public output context');
  return contextData;
}

function resolveEvidence(transcriptCodePoints: readonly string[], reference: MmiTranscriptEvidenceReference): string {
  return normalizedDisplayText(transcriptCodePoints.slice(reference.start, reference.end).join(''));
}

function feedbackTextForCode(code: string, kind: MmiFeedbackKind, rules: readonly PublicFeedbackRule[]): string {
  const rule = rules.find((candidate) => candidate.code === code && candidate.kind === kind);
  if (rule === undefined) throw new Error('Invalid provider feedback code');
  return rule.text;
}

function safetyTextForCode(code: string, rules: readonly PublicSafetyRule[]): string {
  const rule = rules.find((candidate) => candidate.code === code);
  if (rule === undefined) throw new Error('Invalid provider safety code');
  return rule.text;
}

function calculateProviderOverallPct(
  provider: ProviderAssessment,
  weights: Readonly<Record<MmiDimension, number>>,
): number {
  let weightedFivePointScore = 0;
  for (const dimension of MMI_DIMENSIONS) {
    const score = provider.dimensions[dimension].score;
    const weight = weights[dimension];
    if (weight > 0 && score !== null) weightedFivePointScore += score * weight;
  }
  return Math.round(weightedFivePointScore * 200) / 10;
}

export function toPublicMmiAssessment(
  provider: unknown,
  transcript: string,
  context: ValidatedMmiPublicOutputContext,
): MmiAssessment {
  const contextData = getPublicOutputContextData(context);
  const parsedProvider = parseProviderAssessmentAgainstRules(provider, contextData.providerRules, transcript);
  const transcriptCodePoints = Array.from(transcript);
  const improvementRules = parsedProvider.rubricImprovementCodes.map((code) => {
    const rule = contextData.feedbackRules.find((candidate) => candidate.code === code && candidate.kind === 'improvement');
    if (rule === undefined) throw new Error('Invalid provider feedback code');
    return rule;
  });
  const dimensions = {} as Record<MmiDimension, MmiDimensionResult>;
  for (const dimension of MMI_DIMENSIONS) {
    const result = parsedProvider.dimensions[dimension];
    const applicable = contextData.providerRules.dimensionWeights[dimension] > 0;
    const evidenceReference = result.evidenceReference;
    dimensions[dimension] = {
      score: result.score,
      applicable,
      evidence: applicable && evidenceReference !== null ? resolveEvidence(transcriptCodePoints, evidenceReference) : null,
      improvement: applicable ? improvementRules.find((rule) => rule.dimension === dimension)?.text ?? null : null,
    };
  }
  const rubricImprovements = improvementRules.map((rule) => rule.text);
  const safetyImprovements = parsedProvider.safetyCriticalOmissionCodes.map((code) => safetyTextForCode(code, contextData.safetyRules));
  const improvementTip = contextData.frameworkTips[parsedProvider.improvementFramework];
  if (typeof improvementTip !== 'string') throw new Error('Invalid provider improvement framework');
  return {
    dimensions,
    overallPct: calculateProviderOverallPct(parsedProvider, contextData.providerRules.dimensionWeights),
    strengths: parsedProvider.rubricStrengthCodes.map((code) => feedbackTextForCode(code, 'strength', contextData.feedbackRules)),
    improvements: [...rubricImprovements, ...safetyImprovements],
    improvementTip,
    rubricVersion: contextData.rubricVersion,
  };
}
