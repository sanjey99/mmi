import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const scoringPath = new URL('../supabase/functions/_shared/mmiScoring.ts', import.meta.url).href;
const { buildMmiScoringSystemPrompt, normalizeMmiSubmission } = await import(scoringPath);

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
      promptKind: 'standard', stationId: 'station-1', subQuestionId: 'prompt-1',
      transcript: ' I would  explain the plan  clearly. ',
    });
    const second = await normalizeMmiSubmission({
      promptKind: 'standard', stationId: 'station-1', subQuestionId: 'prompt-1',
      transcript: 'I would explain the plan clearly.',
    });

    assert.equal(first.transcript, 'I would explain the plan clearly.');
    assert.equal(first.digest, second.digest);
    assert.match(first.digest, /^[a-f0-9]{64}$/);
  });
});
