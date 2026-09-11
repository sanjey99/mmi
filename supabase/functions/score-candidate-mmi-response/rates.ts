/** Exact JavaScript admission boundary for PostgreSQL NUMERIC(14,6) USD rates. */
export function parseUsdRate(value: string | undefined): number | null {
  if (value === undefined || !/^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,6})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 99_999_999.999999 ? parsed : null;
}

export function isValidEstimatedUsdCost(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 99_999_999.99999999;
}
