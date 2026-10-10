import { CandidateMmiScoringError, type CandidateMmiScoringResult } from './scoringApi';
import type { CandidateMmiPromptOrder } from './types';

const CONCURRENT_REQUESTS = 2;
const MAX_AUTOMATIC_RETRY_SECONDS = 10;

function retryDelay(error: unknown): number | null {
  if (!(error instanceof CandidateMmiScoringError)) return null;
  if (error.code === 'rate_limited') {
    return error.retryAfterSeconds !== null && error.retryAfterSeconds <= MAX_AUTOMATIC_RETRY_SECONDS
      ? error.retryAfterSeconds * 1_000 : null;
  }
  return ['provider_failed', 'invalid_provider_response', 'unavailable'].includes(error.code) ? 1_000 : null;
}

/** Bound provider bursts and recover once from transient failures using the same response identity. */
export async function scoreCandidateMmiResponses(
  promptOrders: readonly CandidateMmiPromptOrder[],
  score: (promptOrder: CandidateMmiPromptOrder) => Promise<CandidateMmiScoringResult>,
  options: Readonly<{
    wait?: (milliseconds: number) => Promise<void>;
    onSettled?: () => Promise<void>;
  }> = {},
): Promise<readonly PromiseSettledResult<CandidateMmiScoringResult>[]> {
  const wait = options.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const outcomes: PromiseSettledResult<CandidateMmiScoringResult>[] = new Array(promptOrders.length);
  let next = 0;
  const worker = async () => {
    while (next < promptOrders.length) {
      const index = next++;
      const order = promptOrders[index];
      try {
        let value: CandidateMmiScoringResult;
        try { value = await score(order); } catch (error) {
          const delay = retryDelay(error);
          if (delay === null) throw error;
          await wait(delay);
          value = await score(order);
        }
        outcomes[index] = { status: 'fulfilled', value };
      } catch (reason) {
        outcomes[index] = { status: 'rejected', reason };
      }
      try { await options.onSettled?.(); } catch { /* A feedback read must not interrupt remaining scoring. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_REQUESTS, promptOrders.length) }, worker));
  return outcomes;
}
