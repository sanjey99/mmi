import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const scoringPath = new URL('../supabase/functions/_shared/mmiScoring.ts', import.meta.url).href;
const { buildMmiScoringSystemPrompt, normalizeMmiSubmission, reconstructCompletedMmiReplay } = await import(scoringPath);
const contractPath = new URL('../supabase/functions/_shared/mmiScoringContract.ts', import.meta.url).href;
const { createMmiScoringContractSnapshot, getRetainedMmiScoringContract } = await import(contractPath);

const rubric = {
  version: 7,
  criteria: {
    'clear-priorities': {
      dimension: 'structure', kind: 'strength',
      assessorCriterion: 'Assess whether priorities are ordered clearly.',
      studentFeedback: 'clear-priorities',
    },
    'explicit-safety-netting': {
      dimension: 'ethics', kind: 'improvement',
      assessorCriterion: 'Assess whether the candidate safety-nets clearly.',
      studentFeedback: 'explicit-safety-netting',
    },
  },
  dimensionWeights: { structure: 0.4, ethics: 0.3, communication: 0.1, reflection: 0.1, nhs_awareness: 0.1 },
  safetyCriticalItems: [{
    id: 'seek-senior-help', assessorCriterion: 'Assess whether urgent concerns are escalated.',
    studentFeedback: 'seek-senior-support',
  }],
} as const as import('../supabase/functions/_shared/mmiContracts').MmiRubric;

describe('MMI scoring boundary', () => {
  it('builds a strict trusted prompt that contains every pinned private scoring input', () => {
    const prompt = buildMmiScoringSystemPrompt({
      rubric,
      hiddenReferenceAnswer: 'The private reference says to seek senior support.',
      hiddenActorContext: { persona: 'Private actor context.' },
      assessorInstructions: 'Return the retained response format exactly.',
      responseSchema: { type: 'object', additionalProperties: false },
    });

    assert.match(prompt, /Assess whether priorities are ordered clearly/);
    assert.match(prompt, /"structure":0\.4/);
    assert.match(prompt, /Assess whether urgent concerns are escalated/);
    assert.match(prompt, /The private reference says to seek senior support/);
    assert.match(prompt, /Private actor context/);
    assert.match(prompt, /untrusted data/i);
    assert.match(prompt, /reference material, not the only acceptable answer/i);
    assert.match(prompt, /"additionalProperties":false/);
  });

  it('normalizes equivalent submissions before digesting them', async () => {
    const first = await normalizeMmiSubmission({
      attemptId: 'attempt-1', promptKind: 'standard', stationId: 'station-1', subQuestionId: 'prompt-1',
      transcript: ' I would  explain the plan  clearly. ',
    });
    const second = await normalizeMmiSubmission({
      attemptId: 'attempt-1', promptKind: 'standard', stationId: 'station-1', subQuestionId: 'prompt-1',
      transcript: 'I would explain the plan clearly.',
    });

    assert.equal(first.transcript, 'I would explain the plan clearly.');
    assert.equal(first.digest, second.digest);
    assert.match(first.digest, /^[a-f0-9]{64}$/);
  });

  it('binds the digest to the attempt as well as the complete prompt identity', async () => {
    const common = {
      promptKind: 'standard', stationId: 'station-1', subQuestionId: 'prompt-1',
      transcript: 'I would explain the plan clearly.',
    };
    const first = await normalizeMmiSubmission({ ...common, attemptId: 'attempt-1' });
    const otherAttempt = await normalizeMmiSubmission({ ...common, attemptId: 'attempt-2' });
    const otherPrompt = await normalizeMmiSubmission({ ...common, attemptId: 'attempt-1', subQuestionId: 'prompt-2' });

    assert.notEqual(first.digest, otherAttempt.digest);
    assert.notEqual(first.digest, otherPrompt.digest);
  });

  it('fails closed when the persisted contract version or response schema drifts', () => {
    const retained = createMmiScoringContractSnapshot('2026-08-17.1');
    assert.equal(
      getRetainedMmiScoringContract(retained, retained.version, retained.responseSchema).version,
      retained.version,
    );
    assert.throws(() => getRetainedMmiScoringContract(
      { ...retained, version: 'unrecognized' }, retained.version, retained.responseSchema,
    ));
    assert.throws(() => getRetainedMmiScoringContract(
      retained, retained.version, { type: 'object', additionalProperties: true },
    ));
  });

  it('reconstructs replay state from immutable prompt metadata', () => {
    assert.deepEqual(reconstructCompletedMmiReplay({ promptOrder: 1, expectedPromptCount: 2 }), {
      attemptStatus: 'in_progress', hasNextPrompt: true,
    });
    assert.deepEqual(reconstructCompletedMmiReplay({ promptOrder: 2, expectedPromptCount: 2 }), {
      attemptStatus: 'completed', hasNextPrompt: false,
    });
    assert.throws(() => reconstructCompletedMmiReplay({ promptOrder: 3, expectedPromptCount: 2 }));
  });
});
