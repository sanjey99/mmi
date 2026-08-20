// @ts-ignore TS5097: Node's native TypeScript runner executes these source files directly.
import { MMI_DIMENSIONS, type MmiDimension, type MmiScore } from './types.ts';

export function calculateOverallPct(
  scores: Record<MmiDimension, MmiScore | null>,
  weights: Record<MmiDimension, number>,
): number {
  let totalWeight = 0;
  let weightedFivePointScore = 0;

  for (const dimension of MMI_DIMENSIONS) {
    const weight = weights[dimension];
    const score = scores[dimension];
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`Invalid weight: ${dimension}`);
    }
    if (weight === 0) {
      if (score !== null) throw new Error(`Non-applicable score: ${dimension}`);
      continue;
    }
    if (score === null) throw new Error(`Missing applicable score: ${dimension}`);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new Error(`Invalid applicable score: ${dimension}`);
    }
    totalWeight += weight;
    weightedFivePointScore += score * weight;
  }

  if (totalWeight === 0) throw new Error('At least one applicable dimension is required');
  if (Math.abs(totalWeight - 1) > Number.EPSILON * 16) {
    throw new Error('Applicable dimension weights must sum to 1');
  }

  return Math.round(weightedFivePointScore * 200) / 10;
}
