interface MmiScoringClaimReleaseResult {
  error: unknown;
}

const RELEASE_ATTEMPTS = 2;

/** Releases a scoring lease without exposing database details to the caller. */
export async function releaseMmiScoringClaim(
  release: () => Promise<MmiScoringClaimReleaseResult>,
): Promise<void> {
  for (let attempt = 0; attempt < RELEASE_ATTEMPTS; attempt += 1) {
    try {
      const result = await release();
      if (result.error === null) return;
    } catch {
      // Retry once; the public boundary returns only a fixed safe error.
    }
  }
  throw new Error('MMI scoring claim release failed');
}
