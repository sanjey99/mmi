/**
 * The scoring handler injects production provider/RPC operations here. Keeping
 * this boundary data-only lets deterministic tests cover failure fencing without
 * weakening the provider adapter or introducing a test-mode environment switch.
 */
export async function runMmiScoringOrchestration<TProvider, TCompleted>(input: {
  transcript: string;
  runProvider: (transcript: string) => Promise<string>;
  parseProvider: (raw: unknown) => TProvider;
  complete: (assessment: TProvider) => Promise<TCompleted>;
  fail: (safeErrorCode: 'scoring_unavailable') => Promise<void>;
}): Promise<TCompleted | { code: 'scoring_unavailable' }> {
  try {
    const raw = await input.runProvider(input.transcript);
    return await input.complete(input.parseProvider(JSON.parse(raw)));
  } catch {
    try { await input.fail('scoring_unavailable'); } catch { /* a stale lease must not disclose internals */ }
    return { code: 'scoring_unavailable' };
  }
}
