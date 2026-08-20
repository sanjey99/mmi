// @ts-ignore TS5097: this Edge shared module intentionally imports source TypeScript.
import {
  MMI_STUDENT_FEEDBACK_CATALOGS,
  parseProviderAssessment,
  type MmiRubric,
  type MmiStudentFeedbackCatalog,
  type ProviderAssessment,
} from './mmiContracts.ts';

export interface MmiScoringContract {
  version: string;
  parserVersion: string;
  assessorInstructions: string;
  responseSchema: Readonly<Record<string, unknown>>;
  studentFeedbackCatalog: MmiStudentFeedbackCatalog;
}

export type MmiScoringContractRegistry = Readonly<Record<string, MmiScoringContract>>;
type ProviderAssessmentParser = (
  value: unknown,
  rubric: MmiRubric,
  transcript: string,
  catalog: MmiStudentFeedbackCatalog,
) => ProviderAssessment;

const CATALOG_CODE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const UNSAFE_CATALOG_TEXT_PATTERN = /[\p{Cc}\p{Cs}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function isStudentFeedbackCatalog(value: unknown): value is MmiStudentFeedbackCatalog {
  if (!isJsonObject(value) || !hasExactKeys(value, ['templates', 'frameworkTips'])
    || !isJsonObject(value.templates) || !isJsonObject(value.frameworkTips)) {
    return false;
  }
  const templateEntries = Object.entries(value.templates);
  const frameworkEntries = Object.entries(value.frameworkTips);
  if (templateEntries.length < 1 || templateEntries.length > 100 || frameworkEntries.length < 1 || frameworkEntries.length > 20) {
    return false;
  }
  for (const [template, definition] of templateEntries) {
    if (!isJsonObject(definition) || !hasExactKeys(definition, ['kind', 'text'])
      || !CATALOG_CODE_PATTERN.test(template)
      || (definition.kind !== 'strength' && definition.kind !== 'improvement' && definition.kind !== 'safety')
      || typeof definition.text !== 'string' || definition.text.trim() === ''
      || Array.from(definition.text).length > 1_000
      || !/[\p{L}\p{N}]/u.test(definition.text)
      || UNSAFE_CATALOG_TEXT_PATTERN.test(definition.text)) {
      return false;
    }
  }
  return frameworkEntries.every(([framework, tip]) => CATALOG_CODE_PATTERN.test(framework)
    && typeof tip === 'string'
    && tip.trim() !== ''
    && Array.from(tip).length <= 1_000
    && /[\p{L}\p{N}]/u.test(tip)
    && !UNSAFE_CATALOG_TEXT_PATTERN.test(tip));
}

function parserCatalogInvariantHolds(contract: MmiScoringContract): boolean {
  if (contract.parserVersion !== '1') return true;
  const properties = contract.responseSchema.properties;
  if (!isJsonObject(properties)) return false;
  const frameworkSchema = properties.improvementFramework;
  if (!isJsonObject(frameworkSchema) || frameworkSchema.type !== 'string' || !Array.isArray(frameworkSchema.enum)
    || frameworkSchema.enum.length < 1 || frameworkSchema.enum.length > 20) {
    return false;
  }
  const frameworks = frameworkSchema.enum;
  if (!frameworks.every((framework) => typeof framework === 'string' && CATALOG_CODE_PATTERN.test(framework))) return false;
  if (new Set(frameworks).size !== frameworks.length) return false;
  return frameworks.every((framework) => Object.prototype.hasOwnProperty.call(contract.studentFeedbackCatalog.frameworkTips, framework));
}

function isScoringContract(value: unknown, expectedVersion?: string): value is MmiScoringContract {
  if (!(isJsonObject(value)
    && hasExactKeys(value, ['version', 'parserVersion', 'assessorInstructions', 'responseSchema', 'studentFeedbackCatalog'])
    && typeof value.version === 'string'
    && value.version.trim() !== ''
    && (expectedVersion === undefined || value.version === expectedVersion)
    && typeof value.parserVersion === 'string'
    && value.parserVersion.trim() !== ''
    && typeof value.assessorInstructions === 'string'
    && value.assessorInstructions.trim() !== ''
    && isJsonObject(value.responseSchema)
    && isStudentFeedbackCatalog(value.studentFeedbackCatalog))) {
    return false;
  }
  return parserCatalogInvariantHolds(value as unknown as MmiScoringContract);
}

function cloneValidatedContract(value: unknown, expectedVersion?: string): MmiScoringContract {
  if (!isScoringContract(value, expectedVersion)) throw new Error('Invalid MMI scoring contract');
  const clone = cloneJson(value);
  if (!isScoringContract(clone, expectedVersion)) throw new Error('Invalid MMI scoring contract');
  canonicalSerialize(clone);
  return deepFreeze(clone);
}

function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid scoring contract');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(',')}]`;
  if (isJsonObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`).join(',')}}`;
  }
  throw new Error('Invalid scoring contract');
}

function canonicalContract(contract: MmiScoringContract): string {
  return canonicalSerialize(contract);
}

const EVIDENCE_REFERENCE_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['start', 'end'],
  properties: {
    start: { type: 'integer', minimum: 0, maximum: 12_000 },
    end: { type: 'integer', minimum: 1, maximum: 12_000 },
  },
});

const APPLICABLE_DIMENSION_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['score', 'evidenceReference'],
  properties: {
    score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    evidenceReference: EVIDENCE_REFERENCE_SCHEMA,
  },
});

const NOT_APPLICABLE_DIMENSION_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['score', 'evidenceReference'],
  properties: {
    score: { type: 'null' },
    evidenceReference: { type: 'null' },
  },
});

const DIMENSION_RESULT_SCHEMA = deepFreeze({
  oneOf: [APPLICABLE_DIMENSION_SCHEMA, NOT_APPLICABLE_DIMENSION_SCHEMA],
});

const RUBRIC_CODE_SCHEMA = deepFreeze({
  type: 'string',
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
});

const V1_RESPONSE_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'dimensions', 'rubricStrengthCodes', 'rubricImprovementCodes',
    'safetyCriticalOmissionCodes', 'improvementFramework',
  ],
  properties: {
    dimensions: {
      type: 'object',
      additionalProperties: false,
      required: ['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness'],
      properties: {
        structure: DIMENSION_RESULT_SCHEMA,
        ethics: DIMENSION_RESULT_SCHEMA,
        communication: DIMENSION_RESULT_SCHEMA,
        reflection: DIMENSION_RESULT_SCHEMA,
        nhs_awareness: DIMENSION_RESULT_SCHEMA,
      },
    },
    rubricStrengthCodes: { type: 'array', minItems: 1, maxItems: 5, items: RUBRIC_CODE_SCHEMA },
    rubricImprovementCodes: { type: 'array', minItems: 1, maxItems: 5, items: RUBRIC_CODE_SCHEMA },
    safetyCriticalOmissionCodes: { type: 'array', minItems: 0, maxItems: 20, items: RUBRIC_CODE_SCHEMA },
    improvementFramework: { type: 'string', enum: ['sbar', 'starr', 'spar', 'four-pillars'] },
  },
});

const V1_INSTRUCTIONS = [
  'You are a UK medical-school MMI assessor grading only the reviewed transcript supplied below.',
  'Do not infer vocal confidence, pace, tone, hesitation, pronunciation, or any delivery quality from transcript text.',
  'Assess valid alternative reasoning fairly; a curated reference answer is context, never the only acceptable answer.',
  'For each applicable dimension, return a score from 1 through 5 and one evidenceReference using start-inclusive, end-exclusive Unicode code-point offsets into the reviewed transcript.',
  'For each non-applicable dimension, return null for both score and evidenceReference.',
  'Select only rubricStrengthCodes, rubricImprovementCodes, and safetyCriticalOmissionCodes supplied in the clinician-reviewed rubric.',
  'Select improvementFramework only from sbar, starr, spar, or four-pillars.',
  'Return no prose, overall percentage, hidden context, rubric criteria, internal instructions, or fields outside the strict JSON schema.',
].join(' ');

export const CURRENT_MMI_SCORING_CONTRACT_VERSION = '2026-08-17.1';
const PINNED_V1_CONTRACT: MmiScoringContract = deepFreeze({
  version: '2026-08-17.1',
  parserVersion: '1',
  assessorInstructions: V1_INSTRUCTIONS,
  responseSchema: cloneJson(V1_RESPONSE_SCHEMA),
  studentFeedbackCatalog: cloneJson(MMI_STUDENT_FEEDBACK_CATALOGS['2026-08-17.1']),
});
const PINNED_V1_GOLDEN_CANONICAL = canonicalContract(PINNED_V1_CONTRACT);

export const MMI_SCORING_CONTRACTS: MmiScoringContractRegistry = deepFreeze({
  '2026-08-17.1': cloneJson(PINNED_V1_CONTRACT),
});

export const MMI_PROVIDER_PARSERS: Readonly<Record<string, ProviderAssessmentParser>> = deepFreeze({
  '1': parseProviderAssessment,
});

function isSchema(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value);
}

export function validateJsonSchema(value: unknown, schema: unknown): boolean {
  if (!isSchema(schema)) return false;
  if (hasOwn(schema, 'const') && !Object.is(value, schema.const)) return false;
  if (hasOwn(schema, 'anyOf')) {
    return Array.isArray(schema.anyOf) && schema.anyOf.some((candidate) => validateJsonSchema(value, candidate));
  }
  if (hasOwn(schema, 'oneOf')) {
    return Array.isArray(schema.oneOf) && schema.oneOf.filter((candidate) => validateJsonSchema(value, candidate)).length === 1;
  }
  if (!hasOwn(schema, 'type')) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'string') {
    if (typeof value !== 'string') return false;
    if (hasOwn(schema, 'minLength') && (typeof schema.minLength !== 'number' || !Number.isInteger(schema.minLength) || schema.minLength < 0 || Array.from(value).length < schema.minLength)) return false;
    if (hasOwn(schema, 'maxLength') && (typeof schema.maxLength !== 'number' || !Number.isInteger(schema.maxLength) || schema.maxLength < 0 || Array.from(value).length > schema.maxLength)) return false;
    if (hasOwn(schema, 'pattern') && (typeof schema.pattern !== 'string' || !new RegExp(schema.pattern, 'u').test(value))) return false;
    return !hasOwn(schema, 'enum') || (Array.isArray(schema.enum) && schema.enum.includes(value));
  }
  if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return false;
    if (hasOwn(schema, 'minimum') && (typeof schema.minimum !== 'number' || !Number.isFinite(schema.minimum) || value < schema.minimum)) return false;
    if (hasOwn(schema, 'maximum') && (typeof schema.maximum !== 'number' || !Number.isFinite(schema.maximum) || value > schema.maximum)) return false;
    return !hasOwn(schema, 'enum') || (Array.isArray(schema.enum) && schema.enum.includes(value));
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return false;
    if (hasOwn(schema, 'minItems') && (typeof schema.minItems !== 'number' || !Number.isInteger(schema.minItems) || schema.minItems < 0 || value.length < schema.minItems)) return false;
    if (hasOwn(schema, 'maxItems') && (typeof schema.maxItems !== 'number' || !Number.isInteger(schema.maxItems) || schema.maxItems < 0 || value.length > schema.maxItems)) return false;
    return hasOwn(schema, 'items') && isSchema(schema.items) && value.every((item) => validateJsonSchema(item, schema.items));
  }
  if (schema.type === 'object') {
    if (!isSchema(value)) return false;
    if (!hasOwn(schema, 'required') || !hasOwn(schema, 'properties') || !hasOwn(schema, 'additionalProperties')) return false;
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (!required.every((key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(value, key))) return false;
    const properties = isSchema(schema.properties) ? schema.properties : {};
    if (!isSchema(schema.properties) || schema.additionalProperties !== false || Object.keys(value).some((key) => !hasOwn(properties, key))) return false;
    return Object.entries(properties).every(([key, propertySchema]) => !Object.prototype.hasOwnProperty.call(value, key) || validateJsonSchema(value[key], propertySchema));
  }
  return false;
}

function assertPinnedContractIntegrity(contract: MmiScoringContract): void {
  if (contract.version === '2026-08-17.1'
    && (canonicalContract(PINNED_V1_CONTRACT) !== PINNED_V1_GOLDEN_CANONICAL
      || canonicalContract(contract) !== PINNED_V1_GOLDEN_CANONICAL)) {
    throw new Error('Invalid pinned MMI scoring contract');
  }
}

export function getMmiScoringContract(version: string, registry: MmiScoringContractRegistry = MMI_SCORING_CONTRACTS): MmiScoringContract {
  if (!isJsonObject(registry) || !Object.prototype.hasOwnProperty.call(registry, version)) throw new Error('Unknown MMI scoring contract version');
  const contract = registry[version];
  if (!isScoringContract(contract, version)) throw new Error('Invalid MMI scoring contract');
  canonicalSerialize(contract);
  assertPinnedContractIntegrity(contract);
  return contract;
}

export function getCurrentMmiScoringContract(
  registry: MmiScoringContractRegistry = MMI_SCORING_CONTRACTS,
  currentVersion: string = CURRENT_MMI_SCORING_CONTRACT_VERSION,
): MmiScoringContract {
  return getMmiScoringContract(currentVersion, registry);
}

export function createMmiScoringContractSnapshot(version: string): MmiScoringContract {
  const contract = getMmiScoringContract(version);
  return deepFreeze({
    version: contract.version,
    parserVersion: contract.parserVersion,
    assessorInstructions: contract.assessorInstructions,
    responseSchema: cloneJson(contract.responseSchema),
    studentFeedbackCatalog: cloneJson(contract.studentFeedbackCatalog),
  });
}

export function parseProviderAssessmentForContract(
  value: unknown,
  contract: MmiScoringContract,
  rubric: MmiRubric,
  transcript: string,
  registry: MmiScoringContractRegistry = MMI_SCORING_CONTRACTS,
): ProviderAssessment {
  const contractSnapshot = cloneValidatedContract(contract);
  const pinnedContract = getMmiScoringContract(contractSnapshot.version, registry);
  assertPinnedContractIntegrity(contractSnapshot);
  if (canonicalContract(pinnedContract) !== canonicalContract(contractSnapshot)) {
    throw new Error('Scoring contract snapshot does not match retained contract');
  }
  if (!validateJsonSchema(value, contractSnapshot.responseSchema)) throw new Error('Invalid provider assessment');
  const parser = MMI_PROVIDER_PARSERS[contractSnapshot.parserVersion];
  if (parser === undefined) throw new Error('Unsupported MMI assessment parser');
  return parser(value, rubric, transcript, contractSnapshot.studentFeedbackCatalog);
}
