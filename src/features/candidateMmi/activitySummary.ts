export type CandidateMmiActivitySummary = Readonly<{
  completedToday: number;
  completedTotal: number;
  streakCurrent: number;
  streakLongest: number;
  latestCompletedAt: string | null;
}>;

type ActivitySummaryErrorKind = 'access_denied' | 'invalid_response' | 'unavailable';
const messages: Readonly<Record<ActivitySummaryErrorKind, string>> = {
  access_denied: 'Sign in to see your MMI practice activity.',
  invalid_response: 'Your MMI practice activity could not be verified.',
  unavailable: 'Your MMI practice activity is unavailable right now.',
};

export class CandidateMmiActivitySummaryError extends Error {
  readonly kind: ActivitySummaryErrorKind;
  constructor(kind: ActivitySummaryErrorKind) {
    super(messages[kind]);
    this.name = 'CandidateMmiActivitySummaryError';
    this.kind = kind;
  }
}

type ActivitySummaryRpcClient = Readonly<{
  rpc: (name: string, args: Record<string, never>) => PromiseLike<Readonly<{ data: unknown; error: Readonly<{ code?: string }> | null }>>;
}>;
const KEYS = ['completedToday', 'completedTotal', 'streakCurrent', 'streakLongest', 'latestCompletedAt'] as const;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|\+00:00)$/;
const invalid = (): never => { throw new CandidateMmiActivitySummaryError('invalid_response'); };

export function parseCandidateMmiActivitySummary(value: unknown): CandidateMmiActivitySummary {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== KEYS.length || Object.keys(row).some(key => !KEYS.includes(key as typeof KEYS[number]))) return invalid();
  const counts = [row.completedToday, row.completedTotal, row.streakCurrent, row.streakLongest];
  if (counts.some(count => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) return invalid();
  const completedToday = row.completedToday as number;
  const completedTotal = row.completedTotal as number;
  const streakCurrent = row.streakCurrent as number;
  const streakLongest = row.streakLongest as number;
  if (completedToday > completedTotal || streakCurrent > streakLongest || streakLongest > completedTotal
    || (completedToday > 0 && streakCurrent === 0) || (completedTotal > 0 && streakLongest === 0)) return invalid();
  const latestCompletedAt = row.latestCompletedAt;
  if (completedTotal === 0) {
    if (latestCompletedAt !== null) return invalid();
  } else if (typeof latestCompletedAt !== 'string' || !UTC_TIMESTAMP.test(latestCompletedAt)
    || !Number.isFinite(Date.parse(latestCompletedAt))
    || new Date(`${latestCompletedAt.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== latestCompletedAt.slice(0, 10)) return invalid();
  return Object.freeze({ completedToday, completedTotal, streakCurrent, streakLongest, latestCompletedAt: latestCompletedAt as string | null });
}

export function createCandidateMmiActivitySummaryApi(client: ActivitySummaryRpcClient) {
  return Object.freeze({
    async getSummary(): Promise<CandidateMmiActivitySummary> {
      let response: Awaited<ReturnType<ActivitySummaryRpcClient['rpc']>>;
      try { response = await client.rpc('get_candidate_mmi_activity_summary', {}); }
      catch { throw new CandidateMmiActivitySummaryError('unavailable'); }
      if (!response || typeof response !== 'object') return invalid();
      if (response.error) throw new CandidateMmiActivitySummaryError(response.error.code === '42501' ? 'access_denied' : 'unavailable');
      return parseCandidateMmiActivitySummary(response.data);
    },
  });
}
