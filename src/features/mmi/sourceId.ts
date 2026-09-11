export const MMI_SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** Shared browser-side contract for server-owned MMI source identifiers. */
export function isMmiSourceId(value: unknown): value is string {
  return typeof value === 'string' && MMI_SOURCE_ID_PATTERN.test(value);
}
