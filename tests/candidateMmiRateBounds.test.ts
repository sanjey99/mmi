import { describe, expect, it } from 'vitest';
import { calculateEstimatedUsdCost, isValidEstimatedUsdCost, parseUsdRate } from '../supabase/functions/score-candidate-mmi-response/rates';

describe('candidate MMI USD numeric bounds', () => {
  it('admits only exact NUMERIC(14,6) rate literals', () => {
    expect(parseUsdRate('0')).toBe(0);
    expect(parseUsdRate('99999999.999999')).toBe(99999999.999999);
    for (const value of [undefined, '', '-1', '01', '1e3', '1.0000001', '100000000', '99999999.9999999']) {
      expect(parseUsdRate(value)).toBeNull();
    }
  });

  it('rejects non-finite and NUMERIC(16,8)-overflow estimated costs', () => {
    expect(isValidEstimatedUsdCost(0)).toBe(true);
    expect(isValidEstimatedUsdCost(99_999_999.99999999)).toBe(true);
    for (const value of [-1, Infinity, Number.NaN, 100_000_000]) {
      expect(isValidEstimatedUsdCost(value)).toBe(false);
    }
  });

  it('rounds valid six-decimal rates to the database NUMERIC(16,8) cost', () => {
    // Raw formula is 0.000015185088, which has twelve fractional places.
    expect(calculateEstimatedUsdCost(123, 0, 0, 0.123456, 0, 0)).toBe('0.00001519');
    // Half-up ties are resolved deterministically without IEEE-754 drift.
    expect(calculateEstimatedUsdCost(1, 0, 0, 0.005, 0, 0)).toBe('0.00000001');
  });

  it('keeps costs above Number scaled-integer precision lossless and reports NUMERIC overflow', () => {
    expect(calculateEstimatedUsdCost(9_007_199_254_740_991, 0, 0, 0.000001, 0, 0)).toBe('9007.19925474');
    expect(calculateEstimatedUsdCost(9_007_199_254_740_991, 0, 0, 99_999_999.999999, 0, 0)).toBeNull();
  });
});
