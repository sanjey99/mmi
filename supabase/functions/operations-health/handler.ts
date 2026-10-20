type Check = 'ok' | 'failing';
type Checks = Readonly<{ database: Check; retention: Check; scoring: Check; runtime: Check }>;
type Snapshot = Readonly<{
  retention: { jobActive: boolean; heartbeatAgeSeconds: number | null; overdueResponses: number; overdueDrafts: number };
  scoring: { isConfigured: boolean; stalledClaims: number; recentCalls: number; recentFailures: number };
  runtime: { recentAffectedAccounts: number };
}>;

const failedChecks: Checks = Object.freeze({ database: 'failing', retention: 'failing', scoring: 'failing', runtime: 'failing' });
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Validate only health inputs; the HTTP response never includes the snapshot. */
function snapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Record<string, unknown>;
  const retention = root.retention as Snapshot['retention'] | undefined;
  const scoring = root.scoring as Snapshot['scoring'] | undefined;
  const runtime = root.runtime as Snapshot['runtime'] | undefined;
  if (!retention || !scoring || !runtime || typeof retention.jobActive !== 'boolean'
    || !(retention.heartbeatAgeSeconds === null || (typeof retention.heartbeatAgeSeconds === 'number' && Number.isFinite(retention.heartbeatAgeSeconds) && retention.heartbeatAgeSeconds >= 0))
    || !count(retention.overdueResponses) || !count(retention.overdueDrafts)
    || typeof scoring.isConfigured !== 'boolean' || !count(scoring.stalledClaims) || !count(scoring.recentCalls) || !count(scoring.recentFailures)
    || scoring.recentFailures > scoring.recentCalls || !count(runtime.recentAffectedAccounts)) return null;
  return { retention, scoring, runtime };
}

export function assessOperationsHealth(value: unknown): Readonly<{ ok: boolean; checks: Checks }> {
  const input = snapshot(value);
  if (!input) return { ok: false, checks: failedChecks };
  const { retention, scoring, runtime } = input;
  const checks: Checks = {
    database: 'ok',
    retention: !retention.jobActive || retention.heartbeatAgeSeconds === null
      || retention.heartbeatAgeSeconds > 900 || retention.overdueResponses > 0 || retention.overdueDrafts > 0 ? 'failing' : 'ok',
    scoring: !scoring.isConfigured || scoring.stalledClaims > 0 || (scoring.recentFailures >= 3 && scoring.recentFailures / scoring.recentCalls >= 0.25) ? 'failing' : 'ok',
    runtime: runtime.recentAffectedAccounts > 0 ? 'failing' : 'ok',
  };
  return { ok: Object.values(checks).every(check => check === 'ok'), checks };
}

async function sameToken(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left); const b = new Uint8Array(right);
  let different = 0;
  for (let index = 0; index < a.length; index++) different |= a[index] ^ b[index];
  return different === 0;
}

export function createOperationsHealthHandler(dependencies: Readonly<{
  token: string | undefined;
  loadSnapshot: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }>;
  timeoutMs?: number;
}>) {
  const respond = (body: unknown, status: number) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return respond({ error: 'method_not_allowed' }, 405);
    if (new URL(request.url).search) return respond({ error: 'invalid_request' }, 400);
    const token = dependencies.token;
    if (!token || !/^[a-f0-9]{64}$/u.test(token)) return respond({ error: 'monitoring_not_configured' }, 503);
    const authorization = request.headers.get('Authorization') ?? '';
    if (!/^Bearer [a-f0-9]{64}$/u.test(authorization) || !await sameToken(authorization.slice(7), token)) {
      return respond({ error: 'unauthorized' }, 401);
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        dependencies.loadSnapshot(controller.signal),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, dependencies.timeoutMs ?? 8_000); }),
      ]);
      const health = result.error ? { ok: false, checks: failedChecks } : assessOperationsHealth(result.data);
      return respond(health, health.ok ? 200 : 503);
    } catch {
      return respond({ ok: false, checks: failedChecks }, 503);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  };
}
