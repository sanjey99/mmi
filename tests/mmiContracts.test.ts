import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type * as ClientContracts from '../src/features/mmi/types';
import type * as EdgeContracts from '../supabase/functions/_shared/mmiContracts';

const clientContractsPath = new URL('../src/features/mmi/types.ts', import.meta.url).href;
const edgeContractsPath = new URL('../supabase/functions/_shared/mmiContracts.ts', import.meta.url).href;
const scoringContractPath = new URL('../supabase/functions/_shared/mmiScoringContract.ts', import.meta.url).href;
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url).href);
const require = createRequire(import.meta.url);
const localTscPath = require.resolve('typescript/bin/tsc');
const clientContracts = await import(clientContractsPath);
const {
  createMmiPublicOutputContext,
  MMI_DIMENSIONS,
  MMI_IMPROVEMENT_FRAMEWORKS,
  MMI_STUDENT_FEEDBACK_TEMPLATES,
  parseMmiRubric,
  parseProviderAssessment,
  parseSubmitMmiPromptRequest,
  toPublicMmiAssessment,
} = await import(edgeContractsPath);
const {
  CURRENT_MMI_SCORING_CONTRACT_VERSION,
  MMI_SCORING_CONTRACTS,
  createMmiScoringContractSnapshot,
  getCurrentMmiRubric,
  getCurrentMmiScoringContract,
  getMmiScoringContract,
  parseProviderAssessmentForContract,
  validateJsonSchema,
} = await import(scoringContractPath);

type Assert<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2) ? true : false;

type _DimensionsMatch = Assert<Equal<ClientContracts.MmiDimension, EdgeContracts.MmiDimension>>;
type _ScoresMatch = Assert<Equal<ClientContracts.MmiScore, EdgeContracts.MmiScore>>;
type _FrameworkMatches = Assert<Equal<ClientContracts.MmiImprovementFramework, EdgeContracts.MmiImprovementFramework>>;
type _TemplateMatches = Assert<Equal<ClientContracts.MmiStudentFeedbackTemplate, EdgeContracts.MmiStudentFeedbackTemplate>>;
type _FeedbackKindMatches = Assert<Equal<ClientContracts.MmiFeedbackKind, EdgeContracts.MmiFeedbackKind>>;
type _PromptIdentityMatches = Assert<Equal<ClientContracts.MmiPromptIdentity, EdgeContracts.MmiPromptIdentity>>;
type _EvidenceReferenceMatches = Assert<Equal<ClientContracts.MmiTranscriptEvidenceReference, EdgeContracts.MmiTranscriptEvidenceReference>>;
type _DimensionResultMatches = Assert<Equal<ClientContracts.MmiDimensionResult, EdgeContracts.MmiDimensionResult>>;
type _AssessmentMatches = Assert<Equal<ClientContracts.MmiAssessment, EdgeContracts.MmiAssessment>>;
type _RequestMatches = Assert<Equal<ClientContracts.SubmitMmiPromptRequest, EdgeContracts.SubmitMmiPromptRequest>>;
type _RubricCriterionMatches = Assert<Equal<ClientContracts.MmiRubricCriterion, EdgeContracts.MmiRubricCriterion>>;
type _SafetyItemMatches = Assert<Equal<ClientContracts.MmiSafetyCriticalItem, EdgeContracts.MmiSafetyCriticalItem>>;
type _RubricMatches = Assert<Equal<ClientContracts.MmiRubric, EdgeContracts.MmiRubric>>;
type _ProviderDimensionMatches = Assert<Equal<ClientContracts.ProviderMmiDimensionResult, EdgeContracts.ProviderMmiDimensionResult>>;
type _ProviderAssessmentMatches = Assert<Equal<ClientContracts.ProviderAssessment, EdgeContracts.ProviderAssessment>>;
type _DimensionTupleMatches = Assert<Equal<typeof ClientContracts.MMI_DIMENSIONS, typeof EdgeContracts.MMI_DIMENSIONS>>;
type _FrameworkTupleMatches = Assert<Equal<typeof ClientContracts.MMI_IMPROVEMENT_FRAMEWORKS, typeof EdgeContracts.MMI_IMPROVEMENT_FRAMEWORKS>>;
type _TemplateTupleMatches = Assert<Equal<typeof ClientContracts.MMI_STUDENT_FEEDBACK_TEMPLATES, typeof EdgeContracts.MMI_STUDENT_FEEDBACK_TEMPLATES>>;

const reviewedTranscript = 'I would first ensure the patient is safe, then explain the plan clearly and escalate urgent concerns.';

const rubric = {
  version: 3,
  criteria: {
    'safe-first-action': {
      dimension: 'structure',
      kind: 'strength',
      assessorCriterion: 'Apply the cobalt assessor sequence when judging prioritisation.',
      studentFeedback: 'clear-priorities',
    },
    'plain-language': {
      dimension: 'communication',
      kind: 'strength',
      assessorCriterion: 'Assess whether explanations remain accessible and patient centred.',
      studentFeedback: 'patient-centred-language',
    },
    'explicit-safety-netting': {
      dimension: 'ethics',
      kind: 'improvement',
      assessorCriterion: 'Apply the amber assessor rule when judging immediate clinical risk.',
      studentFeedback: 'explicit-safety-netting',
    },
    'deepen-reflection': {
      dimension: 'reflection',
      kind: 'improvement',
      assessorCriterion: 'Assess whether reflection identifies a concrete future change.',
      studentFeedback: 'deepen-reflection',
    },
  },
  dimensionWeights: {
    structure: 0.25,
    ethics: 0.25,
    communication: 0.25,
    reflection: 0.25,
    nhs_awareness: 0,
  },
  safetyCriticalItems: [{
    id: 'urgent-escalation',
    assessorCriterion: 'The concealed violet safety rule requires appropriate escalation.',
    studentFeedback: 'escalate-immediate-risk',
  }],
} as const;

function codePointSpan(transcript: string, excerpt: string) {
  const utf16Start = transcript.indexOf(excerpt);
  assert.notEqual(utf16Start, -1, `Missing fixture excerpt: ${excerpt}`);
  const start = Array.from(transcript.slice(0, utf16Start)).length;
  return { start, end: start + Array.from(excerpt).length };
}

function providerForTranscript(transcript: string, excerpts = {
  structure: 'first ensure the patient is safe',
  ethics: 'ensure the patient is safe',
  communication: 'explain the plan clearly',
  reflection: 'escalate urgent concerns',
}) {
  return {
    dimensions: {
      structure: { score: 4, evidenceReference: codePointSpan(transcript, excerpts.structure) },
      ethics: { score: 4, evidenceReference: codePointSpan(transcript, excerpts.ethics) },
      communication: { score: 3, evidenceReference: codePointSpan(transcript, excerpts.communication) },
      reflection: { score: 3, evidenceReference: codePointSpan(transcript, excerpts.reflection) },
      nhs_awareness: { score: null, evidenceReference: null },
    },
    rubricStrengthCodes: ['safe-first-action', 'plain-language'],
    rubricImprovementCodes: ['explicit-safety-netting', 'deepen-reflection'],
    safetyCriticalOmissionCodes: ['urgent-escalation'],
    improvementFramework: 'sbar',
  };
}

const validProviderAssessment = providerForTranscript(reviewedTranscript);

function cloneProvider(mutator: (value: Record<string, unknown>) => void) {
  const value = structuredClone(validProviderAssessment) as Record<string, unknown>;
  mutator(value);
  return value;
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value as Record<string, unknown>).reverse();
  const reordered: Record<string, unknown> = {};
  for (const [key, child] of entries) reordered[key] = reverseObjectKeys(child);
  return reordered;
}

function publicOutputContext() {
  const contract = getMmiScoringContract('2026-08-17.1');
  return createMmiPublicOutputContext({
    rubric,
    scoringContractVersion: contract.version,
    studentFeedbackCatalog: contract.studentFeedbackCatalog,
  });
}

describe('MMI contracts', () => {
  it('keeps every client and Edge declaration plus runtime allowlists aligned', () => {
    assert.deepEqual(MMI_DIMENSIONS, clientContracts.MMI_DIMENSIONS);
    assert.deepEqual(MMI_IMPROVEMENT_FRAMEWORKS, clientContracts.MMI_IMPROVEMENT_FRAMEWORKS);
    assert.deepEqual(MMI_STUDENT_FEEDBACK_TEMPLATES, clientContracts.MMI_STUDENT_FEEDBACK_TEMPLATES);
    assert.deepEqual(MMI_DIMENSIONS, ['structure', 'ethics', 'communication', 'reflection', 'nhs_awareness']);
    assert.deepEqual(MMI_IMPROVEMENT_FRAMEWORKS, ['sbar', 'starr', 'spar', 'four-pillars']);
  });

  it('runs the focused Task 4 compile-time drift gate from the checked-in test surface', () => {
    assert.doesNotThrow(() => execFileSync(process.execPath, [
      localTscPath, '--noEmit', '--allowImportingTsExtensions', '--moduleResolution', 'bundler', '--module', 'esnext', '--target', 'es2022', '--strict', '--skipLibCheck',
      'src/features/mmi/types.ts', 'src/features/mmi/machine.ts', 'src/features/mmi/aggregation.ts',
      'supabase/functions/_shared/mmiContracts.ts', 'supabase/functions/_shared/mmiScoringContract.ts',
      'tests/mmiContracts.test.ts', 'tests/mmiMachine.test.ts', 'tests/mmiAggregation.test.ts',
    ], { cwd: repositoryRoot, stdio: 'pipe' }));
  });

  it('ships one immutable server-owned rubric for the current AI scorer', () => {
    const currentRubric = getCurrentMmiRubric() as EdgeContracts.MmiRubric;
    const criteria = Object.values(currentRubric.criteria);

    assert.equal(CURRENT_MMI_SCORING_CONTRACT_VERSION, '2026-09-04.1');
    assert.equal(currentRubric.version, 2);
    assert.equal(criteria.length, 10);
    assert.equal(
      Object.values(currentRubric.dimensionWeights).reduce((sum, value) => sum + value, 0),
      1,
    );
    assert.deepEqual(new Set(criteria.map(item => item.dimension)), new Set(MMI_DIMENSIONS));
    assert.doesNotMatch(JSON.stringify(currentRubric), /clinician|reviewed|approved/i);
    assert.equal(Object.isFrozen(currentRubric), true);
    assert.equal(Object.isFrozen(currentRubric.criteria), true);
    assert.equal(Object.isFrozen(currentRubric.dimensionWeights), true);
  });

  it('accepts exact standard and role-play requests and rejects identity/transcript mutations', () => {
    const common = {
      attemptId: '0b0d0e64-ef83-46b3-91e8-95743c4c7e63',
      transcript: reviewedTranscript,
      idempotencyKey: '7feb1793-6e83-4e12-b3de-4db5d01a4b52',
    };
    assert.equal(parseSubmitMmiPromptRequest({ ...common, promptKind: 'standard', stationId: 'station-1', subQuestionId: 'sub-1' }).promptKind, 'standard');
    assert.equal(parseSubmitMmiPromptRequest({ ...common, promptKind: 'roleplay', stationId: 'roleplay-1' }).promptKind, 'roleplay');
    for (const idempotencyKey of ['7feb1793-6e83-0e12-b3de-4db5d01a4b52', '7feb1793-6e83-4e12-73de-4db5d01a4b52', '7feb1793-6e83-4e12-c3de-4db5d01a4b52']) {
      assert.throws(() => parseSubmitMmiPromptRequest({ ...common, promptKind: 'roleplay', stationId: 'roleplay-1', idempotencyKey }));
    }
    assert.throws(() => parseSubmitMmiPromptRequest({ ...common, promptKind: 'standard', stationId: '  ', subQuestionId: 'sub-1' }));
    assert.throws(() => parseSubmitMmiPromptRequest({ ...common, promptKind: 'standard', stationId: 'station-1', subQuestionId: 'sub-1', additional: true }));
    assert.throws(() => parseSubmitMmiPromptRequest({ ...common, promptKind: 'roleplay', stationId: 'roleplay-1', transcript: 'a'.repeat(19) }));
    assert.throws(() => parseSubmitMmiPromptRequest({ ...common, promptKind: 'roleplay', stationId: 'roleplay-1', transcript: '😀'.repeat(12_001) }));
    assert.throws(() => parseSubmitMmiPromptRequest({ ...common, promptKind: 'roleplay', stationId: 'roleplay-1', transcript: '😀'.repeat(20) }));
    const unicodeTranscript = 'I would reassure the patient 😀 and explain the next steps.';
    assert.equal(parseSubmitMmiPromptRequest({ ...common, promptKind: 'roleplay', stationId: 'roleplay-1', transcript: unicodeTranscript }).transcript, unicodeTranscript);
  });

  it('rejects invisible, control-bearing, and malformed-Unicode request mutations without changing transcript offsets', () => {
    const common = {
      promptKind: 'roleplay',
      attemptId: '0b0d0e64-ef83-46b3-91e8-95743c4c7e63',
      stationId: 'roleplay-1',
      transcript: reviewedTranscript,
      idempotencyKey: '7feb1793-6e83-4e12-b3de-4db5d01a4b52',
    } as const;
    for (const mutation of [
      { stationId: '\u200B' },
      { stationId: 'roleplay-1\u200B' },
      { transcript: '\u200B'.repeat(20) },
      { transcript: `Patient is safe\u0000${' and reviewed'.repeat(2)}` },
      { transcript: `Patient is safe \uD800${' and reviewed'.repeat(2)}` },
    ]) {
      assert.throws(() => parseSubmitMmiPromptRequest({ ...common, ...mutation }));
    }
    assert.equal(parseSubmitMmiPromptRequest(common).transcript, reviewedTranscript);
  });

  it('strictly validates rubric rules, templates, weights, and safety codes', () => {
    assert.deepEqual(parseMmiRubric(rubric), rubric);
    for (const ethics of [NaN, Infinity, -0.1, 1.1]) {
      assert.throws(() => parseMmiRubric({ ...rubric, dimensionWeights: { ...rubric.dimensionWeights, ethics } }));
    }
    assert.throws(() => parseMmiRubric({ ...rubric, dimensionWeights: { ...rubric.dimensionWeights, ethics: 0.2 } }));
    assert.throws(() => parseMmiRubric({ ...rubric, criteria: {} }));
    assert.throws(() => parseMmiRubric({ ...rubric, unexpected: true }));
    assert.throws(() => parseMmiRubric({
      ...rubric,
      criteria: { ...rubric.criteria, 'safe-first-action': { ...rubric.criteria['safe-first-action'], studentFeedback: 'vocal-delivery-praise' } },
    }));
    assert.throws(() => parseMmiRubric({
      ...rubric,
      criteria: { ...rubric.criteria, 'safe-first-action': { ...rubric.criteria['safe-first-action'], kind: 'improvement' } },
    }));
    assert.throws(() => parseMmiRubric({
      ...rubric,
      criteria: { ...rubric.criteria, 'duplicate-strength': { ...rubric.criteria['safe-first-action'] } },
    }));
    assert.throws(() => parseMmiRubric({
      ...rubric,
      criteria: Object.fromEntries(Object.entries(rubric.criteria).map(([code, criterion]) => [code, { ...criterion, dimension: 'nhs_awareness' }])),
    }));
    assert.throws(() => parseMmiRubric({ ...rubric, safetyCriticalItems: [{ ...rubric.safetyCriticalItems[0], id: ' urgent-escalation ' }] }));
    assert.throws(() => parseMmiRubric({ ...rubric, safetyCriticalItems: [{ ...rubric.safetyCriticalItems[0], studentFeedback: 'clear-priorities' }] }));
  });

  it('rejects prototype-shaped rubric codes before constructing lookup maps', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const criteria = JSON.parse(JSON.stringify(rubric.criteria)) as Record<string, unknown>;
      Object.defineProperty(criteria, key, {
        value: rubric.criteria['safe-first-action'],
        enumerable: true,
      });
      assert.throws(() => parseMmiRubric({ ...rubric, criteria }));
    }
  });

  describe('provider-output mutation boundary', () => {
    it('rejects every provider-authored prose path before public mapping', () => {
      const legacyProseShape = {
        dimensions: {
          structure: { score: 4, applicable: true, evidence: 'Provider-authored evidence.', improvement: 'Provider-authored improvement.' },
        },
        strengths: ['Provider-authored strength.'],
        improvements: ['Provider-authored improvement.'],
        improvementTip: 'Your vocal confidence and delivery were excellent.',
        safetyCriticalOmissionIds: ['urgent-escalation'],
      };
      assert.throws(() => parseProviderAssessment(legacyProseShape, rubric, reviewedTranscript));
      assert.throws(() => parseProviderAssessment(cloneProvider((value) => {
        value.feedback = 'Your vocal confidence and delivery were excellent.';
      }), rubric, reviewedTranscript));
      assert.throws(() => parseProviderAssessment(cloneProvider((value) => {
        value.improvementFramework = 'your-vocal-confidence-was-excellent';
      }), rubric, reviewedTranscript));
    });

    it('accepts only scores, known rubric/safety codes, an approved framework, and transcript spans', () => {
      assert.deepEqual(parseProviderAssessment(validProviderAssessment, rubric, reviewedTranscript), validProviderAssessment);
      assert.throws(() => parseProviderAssessment(cloneProvider((value) => {
        (value.dimensions as Record<string, Record<string, unknown>>).structure.score = 6;
      }), rubric, reviewedTranscript));
      assert.throws(() => parseProviderAssessment(cloneProvider((value) => {
        (value.dimensions as Record<string, Record<string, unknown>>).nhs_awareness.score = 4;
      }), rubric, reviewedTranscript));
      assert.throws(() => parseProviderAssessment(cloneProvider((value) => {
        (value.dimensions as Record<string, Record<string, unknown>>).structure.evidenceReference = null;
      }), rubric, reviewedTranscript));
      for (const [field, code] of [
        ['rubricStrengthCodes', 'unknown-strength'],
        ['rubricImprovementCodes', 'unknown-improvement'],
        ['safetyCriticalOmissionCodes', 'unknown-safety'],
      ] as const) {
        assert.throws(() => parseProviderAssessment(cloneProvider((value) => { value[field] = [code]; }), rubric, reviewedTranscript));
      }
      assert.throws(() => parseProviderAssessment(cloneProvider((value) => { value.rubricStrengthCodes = ['safe-first-action', 'safe-first-action']; }), rubric, reviewedTranscript));
      assert.throws(() => parseProviderAssessment(cloneProvider((value) => { value.safetyCriticalOmissionCodes = ['urgent-escalation', 'urgent-escalation']; }), rubric, reviewedTranscript));
      const duplicateImprovementDimensionRubric = {
        ...rubric,
        criteria: {
          ...rubric.criteria,
          'weigh-ethical-options': {
            dimension: 'ethics',
            kind: 'improvement',
            assessorCriterion: 'Assess whether the response weighs competing ethical duties.',
            studentFeedback: 'weigh-ethical-pillars',
          },
        },
      } as const;
      assert.throws(() => parseProviderAssessment(cloneProvider((value) => {
        value.rubricImprovementCodes = ['explicit-safety-netting', 'weigh-ethical-options'];
      }), duplicateImprovementDimensionRubric, reviewedTranscript));
    });

    it('rejects forged spans and resolves Unicode code-point spans to transcript-owned evidence', () => {
      for (const reference of [
        { start: -1, end: 5 },
        { start: 5, end: 5 },
        { start: 7, end: 6 },
        { start: 0.5, end: 5 },
        { start: 0, end: 12_001 },
      ]) {
        assert.throws(() => parseProviderAssessment(cloneProvider((value) => {
          (value.dimensions as Record<string, Record<string, unknown>>).structure.evidenceReference = reference;
        }), rubric, reviewedTranscript));
      }
      assert.throws(() => parseProviderAssessment(cloneProvider((value) => {
        const reference = codePointSpan(reviewedTranscript, 'first ensure the patient is safe');
        (value.dimensions as Record<string, Record<string, unknown>>).structure.evidenceReference = [reference, reference];
      }), rubric, reviewedTranscript));

      const unicodeTranscript = 'I would reassure 😀 the patient, explain the plan clearly, and escalate urgent concerns.';
      const unicodeProvider = providerForTranscript(unicodeTranscript, {
        structure: 'reassure 😀 the patient',
        ethics: 'escalate urgent concerns',
        communication: 'explain the plan clearly',
        reflection: 'and escalate urgent concerns',
      });
      const assessment = toPublicMmiAssessment(unicodeProvider, unicodeTranscript, publicOutputContext());
      assert.equal(assessment.dimensions.structure.evidence, 'reassure 😀 the patient');
      assert.equal(assessment.dimensions.ethics.evidence, 'escalate urgent concerns');
    });
  });

  it('constructs public feedback only from server templates and transcript excerpts', () => {
    const context = publicOutputContext();
    const assessment = toPublicMmiAssessment(validProviderAssessment, reviewedTranscript, context);
    assert.deepEqual(assessment, {
      dimensions: {
        structure: { score: 4, applicable: true, evidence: 'first ensure the patient is safe', improvement: null },
        ethics: { score: 4, applicable: true, evidence: 'ensure the patient is safe', improvement: 'Make the safety-netting steps explicit, including when and how you would escalate.' },
        communication: { score: 3, applicable: true, evidence: 'explain the plan clearly', improvement: null },
        reflection: { score: 3, applicable: true, evidence: 'escalate urgent concerns', improvement: 'State what you would change next time and how you would know that the change helped.' },
        nhs_awareness: { score: null, applicable: false, evidence: null, improvement: null },
      },
      overallPct: 70,
      strengths: [
        'You set out the main priorities in a clear and logical order.',
        'You kept the explanation focused on the patient and used accessible language.',
      ],
      improvements: [
        'Make the safety-netting steps explicit, including when and how you would escalate.',
        'State what you would change next time and how you would know that the change helped.',
        'Explain when you would escalate an immediate risk to a senior clinician.',
      ],
      improvementTip: 'Use SBAR to organise a concise escalation: situation, background, assessment, then recommendation.',
      rubricVersion: 3,
    });
    const serialized = JSON.stringify(assessment);
    for (const forbidden of [
      'safe-first-action', 'explicit-safety-netting', 'urgent-escalation',
      'cobalt assessor sequence', 'amber assessor rule', 'concealed violet safety rule',
      'assessorCriterion', 'criteria', 'vocal confidence', 'delivery',
    ]) {
      assert.equal(serialized.toLocaleLowerCase('en-US').includes(forbidden.toLocaleLowerCase('en-US')), false, forbidden);
    }
  });

  it('rejects caller-forged percentages and emits the exact Task 3 persistence dimension shape', () => {
    const context = publicOutputContext();
    assert.throws(() => toPublicMmiAssessment({ ...validProviderAssessment, overallPct: 99.9 }, reviewedTranscript, context));
    const assessment = toPublicMmiAssessment(validProviderAssessment, reviewedTranscript, context);
    const persistedDimensions = JSON.parse(JSON.stringify(assessment.dimensions)) as Record<string, Record<string, unknown>>;
    for (const result of Object.values(persistedDimensions)) {
      assert.deepEqual(Object.keys(result).sort(), ['applicable', 'evidence', 'improvement', 'score']);
      assert.equal(result.evidence === null || typeof result.evidence === 'string', true);
      assert.equal(result.improvement === null || typeof result.improvement === 'string', true);
    }
    assert.deepEqual(persistedDimensions.nhs_awareness, {
      score: null,
      applicable: false,
      evidence: null,
      improvement: null,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(assessment, 'safetyFeedback'), false);
  });

  it('creates an unforgeable public context containing no hidden scoring inputs', () => {
    const context = publicOutputContext();
    assert.deepEqual(Reflect.ownKeys(context), []);
    const reflectedForgery = Object.freeze(Object.create(Object.getPrototypeOf(context), Object.getOwnPropertyDescriptors(context)));
    assert.throws(() => toPublicMmiAssessment(validProviderAssessment, reviewedTranscript, reflectedForgery as never), /output context/i);
    const contract = getMmiScoringContract('2026-08-17.1');
    assert.throws(() => createMmiPublicOutputContext({
      rubric,
      scoringContractVersion: contract.version,
      studentFeedbackCatalog: contract.studentFeedbackCatalog,
      hiddenReferenceAnswer: 'server-only reference answer',
    }), /output context/i);
    assert.throws(() => createMmiPublicOutputContext({
      rubric,
      scoringContractVersion: contract.version,
      studentFeedbackCatalog: contract.studentFeedbackCatalog,
      hiddenActorContext: { privateBrief: 'server-only actor context' },
    }), /output context/i);
    assert.throws(() => toPublicMmiAssessment({ ...validProviderAssessment, unexpected: true }, reviewedTranscript, context));
    assert.throws(() => createMmiPublicOutputContext({
      rubric,
      scoringContractVersion: contract.version,
      studentFeedbackCatalog: {
        ...contract.studentFeedbackCatalog,
        frameworkTips: { ...contract.studentFeedbackCatalog.frameworkTips, sbar: 'Provider-authored vocal confidence prose.' },
      },
    }), /output context/i);
  });

  it('enforces the strict code-only scoring schema and dispatches through the pinned parser', () => {
    const parsedRubric = parseMmiRubric(rubric);
    const v1 = getMmiScoringContract('2026-08-17.1');
    assert.equal(validateJsonSchema(validProviderAssessment, v1.responseSchema), true);
    assert.deepEqual(
      parseProviderAssessmentForContract(validProviderAssessment, v1, parsedRubric, reviewedTranscript),
      parseProviderAssessment(validProviderAssessment, parsedRubric, reviewedTranscript),
    );
    assert.equal(validateJsonSchema(cloneProvider((value) => { value.strengths = ['Provider prose']; }), v1.responseSchema), false);
    assert.equal(validateJsonSchema(cloneProvider((value) => {
      (value.dimensions as Record<string, Record<string, unknown>>).structure.score = 6;
    }), v1.responseSchema), false);
    assert.equal(validateJsonSchema(cloneProvider((value) => {
      const structure = (value.dimensions as Record<string, Record<string, unknown>>).structure;
      structure.evidenceReference = { ...(structure.evidenceReference as Record<string, unknown>), start: -1 };
    }), v1.responseSchema), false);
    assert.equal(validateJsonSchema(cloneProvider((value) => {
      (value.dimensions as Record<string, Record<string, unknown>>).nhs_awareness.evidenceReference = { start: 0, end: 5 };
    }), v1.responseSchema), false);
    assert.equal(validateJsonSchema(cloneProvider((value) => { value.improvementFramework = 'vocal-confidence'; }), v1.responseSchema), false);
    assert.equal(validateJsonSchema(cloneProvider((value) => { value.rubricStrengthCodes = []; }), v1.responseSchema), false);
    assert.equal(validateJsonSchema(validProviderAssessment, { type: 'unknown' }), false);
    const inheritedOneOf = Object.create({ oneOf: [{ type: 'string' }] });
    assert.equal(validateJsonSchema('accepted only through an inherited keyword', inheritedOneOf), false);
    const pollutedSchema = { type: 'object', properties: Object.assign(Object.create({ inherited: { type: 'string' } }), {}), required: [], additionalProperties: false };
    assert.equal(validateJsonSchema({ inherited: 'prototype-polluted' }, pollutedSchema), false);
  });

  it('pins the v1 contract and parser when an incompatible v2 becomes current', () => {
    const parsedRubric = parseMmiRubric(rubric);
    const v1 = getMmiScoringContract('2026-08-17.1');
    const syntheticV2 = Object.freeze({
      version: '2026-08-18.1',
      parserVersion: '2',
      assessorInstructions: 'incompatible',
      responseSchema: Object.freeze({ type: 'string' }),
      studentFeedbackCatalog: v1.studentFeedbackCatalog,
    });
    const registry = Object.freeze({ ...MMI_SCORING_CONTRACTS, '2026-08-18.1': syntheticV2 });
    assert.notEqual(CURRENT_MMI_SCORING_CONTRACT_VERSION, '2026-08-18.1');
    assert.equal(getCurrentMmiScoringContract(registry, '2026-08-18.1'), syntheticV2);
    assert.deepEqual(
      parseProviderAssessmentForContract(validProviderAssessment, getMmiScoringContract(v1.version, registry), parsedRubric, reviewedTranscript, registry),
      validProviderAssessment,
    );
    assert.throws(() => parseProviderAssessmentForContract(validProviderAssessment, syntheticV2, parsedRubric, reviewedTranscript, registry));
    assert.throws(() => getMmiScoringContract('2026-08-17.1', Object.freeze({ ...registry, '2026-08-17.1': { ...v1, assessorInstructions: 'silently overwritten' } })));
    assert.throws(() => getMmiScoringContract('2026-08-17.1', Object.freeze({ ...registry, '2026-08-17.1': { ...v1, responseSchema: { ...v1.responseSchema, required: [] } } })));
    assert.throws(() => getMmiScoringContract('2026-08-17.1', Object.freeze({ ...registry, '2026-08-17.1': undefined } as never)));
    assert.throws(() => getMmiScoringContract('missing', registry));
    const reorderedV1Snapshot = {
      responseSchema: reverseObjectKeys(v1.responseSchema),
      assessorInstructions: v1.assessorInstructions,
      parserVersion: v1.parserVersion,
      studentFeedbackCatalog: reverseObjectKeys(v1.studentFeedbackCatalog),
      version: v1.version,
    };
    assert.equal(
      parseProviderAssessmentForContract(validProviderAssessment, reorderedV1Snapshot, parsedRubric, reviewedTranscript).improvementFramework,
      'sbar',
    );
    const compatibleV2 = Object.freeze({
      ...syntheticV2,
      parserVersion: '1',
      responseSchema: v1.responseSchema,
      assessorInstructions: 'future-version instructions',
      studentFeedbackCatalog: {
        ...v1.studentFeedbackCatalog,
        templates: {
          ...v1.studentFeedbackCatalog.templates,
          'future-improvement-template': {
            kind: 'improvement',
            text: 'Future-version feedback wording.',
          },
        },
        frameworkTips: {
          ...v1.studentFeedbackCatalog.frameworkTips,
          sbar: 'Future-version wording that must not rewrite an old attempt.',
        },
      },
    });
    const futureRegistry = Object.freeze({ ...registry, '2026-08-18.1': compatibleV2 });
    assert.throws(() => parseProviderAssessmentForContract(validProviderAssessment, { ...compatibleV2, assessorInstructions: 'altered future-version instructions' }, parsedRubric, reviewedTranscript, futureRegistry));
    assert.equal(parseProviderAssessmentForContract(validProviderAssessment, compatibleV2, parsedRubric, reviewedTranscript, futureRegistry).improvementFramework, 'sbar');
    const incompleteFrameworkContract = Object.freeze({
      ...compatibleV2,
      version: '2026-08-19.1',
      studentFeedbackCatalog: {
        ...compatibleV2.studentFeedbackCatalog,
        frameworkTips: { sbar: compatibleV2.studentFeedbackCatalog.frameworkTips.sbar },
      },
    });
    const incompleteFrameworkRegistry = Object.freeze({
      ...futureRegistry,
      '2026-08-19.1': incompleteFrameworkContract,
    });
    assert.throws(() => getMmiScoringContract(incompleteFrameworkContract.version, incompleteFrameworkRegistry));
    assert.throws(() => parseProviderAssessmentForContract(
      validProviderAssessment,
      incompleteFrameworkContract,
      parsedRubric,
      reviewedTranscript,
      incompleteFrameworkRegistry,
    ));
    const snapshot = createMmiScoringContractSnapshot(v1.version);
    assert.equal(snapshot.version, v1.version);
    const retainedAttemptContext = createMmiPublicOutputContext({
      rubric,
      scoringContractVersion: snapshot.version,
      studentFeedbackCatalog: snapshot.studentFeedbackCatalog,
    });
    assert.equal(
      toPublicMmiAssessment(validProviderAssessment, reviewedTranscript, retainedAttemptContext).improvementTip,
      'Use SBAR to organise a concise escalation: situation, background, assessment, then recommendation.',
    );
    assert.throws(() => { (snapshot.responseSchema as Record<string, unknown>).type = 'string'; });
    const snapshotSchema = snapshot.responseSchema as Record<string, Record<string, unknown>>;
    assert.equal(Object.isFrozen(snapshot.responseSchema), true);
    assert.equal(Object.isFrozen(snapshotSchema.properties), true);
    assert.equal(Object.isFrozen(snapshot.studentFeedbackCatalog.frameworkTips), true);
    assert.equal(Object.isFrozen(snapshot.studentFeedbackCatalog.templates), true);
    assert.equal(Object.isFrozen(snapshot.studentFeedbackCatalog.templates['clear-priorities']), true);
    assert.throws(() => {
      (snapshot.studentFeedbackCatalog.frameworkTips as Record<string, string>).sbar = 'mutated';
    });
    assert.throws(() => {
      (snapshot.studentFeedbackCatalog.templates['clear-priorities'] as { text: string }).text = 'mutated';
    });
    assert.throws(() => { (MMI_SCORING_CONTRACTS as Record<string, unknown>)['2026-08-17.1'] = syntheticV2; });
  });

  it('pins student-safe feedback text in the scoring snapshot and rejects extra snapshot keys', () => {
    const snapshot = createMmiScoringContractSnapshot('2026-08-17.1') as unknown as Record<string, unknown>;
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'studentFeedbackCatalog'), true);
    assert.throws(() => parseProviderAssessmentForContract(
      validProviderAssessment,
      { ...snapshot, hiddenProviderProse: 'silently accepted' } as never,
      parseMmiRubric(rubric),
      reviewedTranscript,
    ));
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.studentFeedbackCatalog), true);
  });

  it('freezes the exported allowlist tuples at runtime', () => {
    for (const tuple of [
      MMI_DIMENSIONS,
      MMI_IMPROVEMENT_FRAMEWORKS,
      MMI_STUDENT_FEEDBACK_TEMPLATES,
      clientContracts.MMI_DIMENSIONS,
      clientContracts.MMI_IMPROVEMENT_FRAMEWORKS,
      clientContracts.MMI_STUDENT_FEEDBACK_TEMPLATES,
    ]) {
      assert.equal(Object.isFrozen(tuple), true);
      assert.throws(() => (tuple as unknown as string[]).push('mutated'));
    }
  });
});
