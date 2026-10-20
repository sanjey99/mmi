export type CandidateMmiScoringAllowance = Readonly<{
  checkedAt: string;
  resetsAt: string;
  responsesRemaining: number;
  attemptsRemaining: number;
  stationAllowanceRemaining: number;
  scoringPaused: boolean;
  globalCapacityAvailable: boolean;
}>;

type AllowanceErrorKind = 'access_denied' | 'invalid_response' | 'unavailable';
const messages: Readonly<Record<AllowanceErrorKind, string>> = {
  access_denied: 'Sign in to check your AI feedback allowance.',
  invalid_response: 'Your remaining AI feedback allowance could not be verified.',
  unavailable: 'Your remaining AI feedback allowance is unavailable right now.',
};

export class CandidateMmiAllowanceError extends Error {
  readonly kind: AllowanceErrorKind;
  constructor(kind: AllowanceErrorKind) {
    super(messages[kind]);
    this.name = 'CandidateMmiAllowanceError';
    this.kind = kind;
  }
}

type AllowanceRpcClient = Readonly<{
  rpc: (name: string, args: Record<string, never>) => PromiseLike<Readonly<{ data: unknown; error: Readonly<{ code?: string }> | null }>>;
}>;
const KEYS = ['checkedAt', 'resetsAt', 'responsesRemaining', 'attemptsRemaining', 'stationAllowanceRemaining', 'scoringPaused', 'globalCapacityAvailable'] as const;
const ISO = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const DAY_MS = 86_400_000;
const invalid = (): never => { throw new CandidateMmiAllowanceError('invalid_response'); };

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !ISO.test(value) || !Number.isFinite(Date.parse(value))) return invalid();
  if (new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) return invalid();
  return value;
}

export function parseCandidateMmiScoringAllowance(value: unknown): CandidateMmiScoringAllowance {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== KEYS.length || Object.keys(row).some(key => !KEYS.includes(key as typeof KEYS[number]))) return invalid();
  const checkedAt = timestamp(row.checkedAt);
  const resetsAt = timestamp(row.resetsAt);
  if (Date.parse(resetsAt) !== (Math.floor(Date.parse(checkedAt) / DAY_MS) + 1) * DAY_MS) return invalid();
  const counts = [row.responsesRemaining, row.attemptsRemaining, row.stationAllowanceRemaining];
  if (counts.some(count => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) return invalid();
  const responsesRemaining = row.responsesRemaining as number;
  const attemptsRemaining = row.attemptsRemaining as number;
  const stationAllowanceRemaining = row.stationAllowanceRemaining as number;
  if (stationAllowanceRemaining !== Math.floor(responsesRemaining / 5)
    || typeof row.scoringPaused !== 'boolean' || typeof row.globalCapacityAvailable !== 'boolean'
    || (row.scoringPaused && row.globalCapacityAvailable)) return invalid();
  return Object.freeze({ checkedAt, resetsAt, responsesRemaining, attemptsRemaining, stationAllowanceRemaining, scoringPaused: row.scoringPaused, globalCapacityAvailable: row.globalCapacityAvailable });
}

export function createCandidateMmiAllowanceApi(client: AllowanceRpcClient) {
  return Object.freeze({
    async getAllowance(): Promise<CandidateMmiScoringAllowance> {
      let response: Awaited<ReturnType<AllowanceRpcClient['rpc']>>;
      try { response = await client.rpc('get_candidate_mmi_scoring_allowance', {}); }
      catch { throw new CandidateMmiAllowanceError('unavailable'); }
      if (response.error) throw new CandidateMmiAllowanceError(response.error.code === '42501' ? 'access_denied' : 'unavailable');
      return parseCandidateMmiScoringAllowance(response.data);
    },
  });
}

export function describeCandidateMmiAllowance(value: CandidateMmiScoringAllowance): Readonly<{ title: string; message: string; warning: boolean; completeStations: number }> {
  // Retried answers consume attempts without consuming another first-answer
  // slot. Both limits must cover five requests before promising a full station.
  const completeStations = Math.min(value.stationAllowanceRemaining, Math.floor(value.attemptsRemaining / 5));
  if (value.scoringPaused) return Object.freeze({ title: 'AI feedback is temporarily paused', message: 'You can still practise, but AI feedback may be unavailable until the service resumes.', warning: true, completeStations: 0 });
  if (!value.globalCapacityAvailable) return Object.freeze({ title: 'AI feedback is temporarily unavailable', message: 'Shared feedback capacity is unavailable right now. You can still practise, but feedback may need a later retry.', warning: true, completeStations: 0 });
  if (value.attemptsRemaining === 0 || value.responsesRemaining === 0) return Object.freeze({ title: "Today's AI feedback allowance is used", message: value.attemptsRemaining > 0
    ? 'You can still practise, but new answers may not receive AI feedback today. Previously submitted answers may still be eligible for a retry. Existing feedback remains available.'
    : 'You can still practise, but AI feedback may be unavailable for the rest of today. Existing feedback remains available.', warning: true, completeStations: 0 });
  if (completeStations === 0) {
    const answers = Math.min(value.responsesRemaining, value.attemptsRemaining);
    return Object.freeze({ title: 'Less than a full station of AI feedback remains', message: `Your allowance has room for feedback on up to ${answers} more ${answers === 1 ? 'answer' : 'answers'} today. A complete station has five answers. You can still practise without AI feedback.`, warning: true, completeStations });
  }
  return Object.freeze({ title: `Up to ${completeStations} complete ${completeStations === 1 ? 'station' : 'stations'} of AI feedback left today`, message: 'This is your remaining daily allowance. Retries also use it, and shared availability is checked again when feedback is requested.', warning: false, completeStations });
}
