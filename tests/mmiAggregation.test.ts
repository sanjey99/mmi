import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// @ts-ignore TS5097: Node's native TypeScript runner executes these source files directly.
import { calculateOverallPct } from '../src/features/mmi/aggregation.ts';

const allScores = {
  structure: 4,
  ethics: 3,
  communication: 5,
  reflection: 2,
  nhs_awareness: 1,
} as const;

describe('MMI assessment aggregation', () => {
  it('excludes zero-weight N/A dimensions and converts the weighted score to a percentage', () => {
    const scores = { ...allScores, nhs_awareness: null };
    const weights = {
      structure: 0.25, ethics: 0.25, communication: 0.25, reflection: 0.25, nhs_awareness: 0,
    };
    assert.equal(calculateOverallPct(scores, weights), 70);
    assert.deepEqual(scores, { ...allScores, nhs_awareness: null });
    assert.deepEqual(weights, {
      structure: 0.25, ethics: 0.25, communication: 0.25, reflection: 0.25, nhs_awareness: 0,
    });
  });

  it('rounds to one decimal after applying the score-times-twenty convention', () => {
    assert.equal(calculateOverallPct({ ...allScores, reflection: null, nhs_awareness: null }, {
      structure: 1 / 3, ethics: 1 / 3, communication: 1 / 3, reflection: 0, nhs_awareness: 0,
    }), 80);
    assert.equal(calculateOverallPct({ ...allScores, nhs_awareness: null }, {
      structure: 0.1, ethics: 0.2, communication: 0.3, reflection: 0.4, nhs_awareness: 0,
    }), 66);
    assert.equal(calculateOverallPct({ ...allScores, reflection: null, nhs_awareness: null }, {
      structure: 0.33, ethics: 0.33, communication: 0.34, reflection: 0, nhs_awareness: 0,
    }), 80.2);
  });

  it('supports alternate valid weights and rejects missing applicable scores or all-N/A distributions', () => {
    assert.equal(calculateOverallPct(allScores, {
      structure: 0.5, ethics: 0.2, communication: 0.1, reflection: 0.1, nhs_awareness: 0.1,
    }), 68);
    assert.throws(() => calculateOverallPct({ ...allScores, ethics: null }, {
      structure: 0.25, ethics: 0.25, communication: 0.25, reflection: 0.25, nhs_awareness: 0,
    }), /Missing applicable score: ethics/);
    assert.throws(() => calculateOverallPct({
      structure: null, ethics: null, communication: null, reflection: null, nhs_awareness: null,
    }, {
      structure: 0, ethics: 0, communication: 0, reflection: 0, nhs_awareness: 0,
    }), /at least one applicable dimension/i);
    for (const structure of [NaN, Infinity, -0.1]) {
      assert.throws(() => calculateOverallPct(allScores, {
        structure, ethics: 0.25, communication: 0.25, reflection: 0.25, nhs_awareness: 0.25,
      }), /Invalid weight: structure/);
    }
    for (const ethics of [0, 2.5, 6] as const) {
      assert.throws(() => calculateOverallPct({ ...allScores, ethics } as never, {
        structure: 0.2, ethics: 0.2, communication: 0.2, reflection: 0.2, nhs_awareness: 0.2,
      }), /Invalid applicable score: ethics/);
    }
    assert.throws(() => calculateOverallPct(allScores, {
      structure: 0.2, ethics: 0.2, communication: 0.2, reflection: 0.2, nhs_awareness: 0.1,
    }), /weights must sum to 1/i);
  });

  it('rejects a score for every zero-weight dimension instead of silently discarding it', () => {
    assert.throws(() => calculateOverallPct(allScores, {
      structure: 0.25,
      ethics: 0.25,
      communication: 0.25,
      reflection: 0.25,
      nhs_awareness: 0,
    }), /non-applicable score: nhs_awareness/i);
  });
});
