/** Exact JavaScript admission boundary for PostgreSQL NUMERIC(14,6) USD rates. */
export function parseUsdRate(value: string | undefined): number | null {
  if (value === undefined || !/^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,6})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 99_999_999.999999 ? parsed : null;
}

export function isValidEstimatedUsdCost(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 99_999_999.99999999;
}

/**
 * PostgreSQL stores the derived dollar amount as NUMERIC(16,8).  Rates have
 * six decimal places per million, so do this in integer micro-rate units and
 * round half-up to eight dollar places instead of trusting binary floats.
 */
export function calculateEstimatedUsdCost(
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  inputRatePerMillion: number,
  cachedInputRatePerMillion: number,
  outputRatePerMillion: number,
): string | null {
  const toMicroRate = (rate: number): bigint => BigInt(Math.round(rate * 1_000_000));
  const numerator =
    BigInt(inputTokens) * toMicroRate(inputRatePerMillion) +
    BigInt(cachedInputTokens) * toMicroRate(cachedInputRatePerMillion) +
    BigInt(outputTokens) * toMicroRate(outputRatePerMillion);
  // numerator / 10^12 dollars; convert to 10^-8 dollars => divide by 10^4.
  const roundedUnits = (numerator + 5_000n) / 10_000n;
  if (roundedUnits > 9_999_999_999_999_999n) return null;
  const whole = roundedUnits / 100_000_000n;
  const fraction = (roundedUnits % 100_000_000n).toString().padStart(8, '0');
  return `${whole.toString()}.${fraction}`;
}
