import { RUNTIME_KINDS, RUNTIME_AREAS, type RuntimeArea, type RuntimeKind } from './types';

type RuntimeClient = Readonly<{
  auth: { getSession: () => PromiseLike<{ data: { session: unknown }; error?: unknown }> };
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<unknown>;
}>;

/** Return a fixed category, never a URL, account ID, query, or fragment. */
export function runtimeArea(pathname: unknown): RuntimeArea {
  if (typeof pathname !== 'string' || pathname.length > 1_024) return 'other';
  const path = pathname.split(/[?#]/u, 1)[0];
  if (/^\/(?:auth\/callback|set-password)(?:\/|$)/u.test(path)) return 'account_link';
  if (/^\/(?:login|signup|forgot-password)(?:\/|$)/u.test(path)) return 'login';
  if (/^\/onboarding(?:\/|$)/u.test(path)) return 'onboarding';
  if (/^\/(?:practice\/)?feedback(?:\/|$)/u.test(path)) return 'feedback';
  if (/^\/practice(?:\/|$)/u.test(path)) return 'practice';
  if (/^\/progress(?:\/|$)/u.test(path)) return 'progress';
  if (/^\/profile(?:\/|$)/u.test(path)) return 'profile';
  if (/^\/admin(?:\/|$)/u.test(path)) return 'admin';
  return 'other';
}

/** Best-effort counters only. Failure never blocks, retries, logs, or reports itself. */
export function createRuntimeReporter(client: RuntimeClient, now: () => number = Date.now) {
  let inFlight = false;
  let attempts: number[] = [];
  return async (kind: RuntimeKind, area: RuntimeArea): Promise<void> => {
    if (!RUNTIME_KINDS.includes(kind) || !RUNTIME_AREAS.includes(area) || inFlight) return;
    const time = now();
    if (!Number.isFinite(time)) return;
    attempts = attempts.filter(attempt => time - attempt < 60_000);
    if (attempts.length >= 4) return;
    attempts.push(time);
    inFlight = true;
    try {
      // No new identity, persistent browser identifier, or anonymous ingestion.
      const result = await client.auth.getSession();
      if (!result.error && result.data.session) {
        await client.rpc('record_app_runtime_event', { p_kind: kind, p_area: area });
      }
    } catch {
      // Reporting must not cause another unhandled rejection.
    } finally {
      inFlight = false;
    }
  };
}

type RuntimeSurface = Readonly<{
  location: { pathname: string };
  addEventListener: (kind: 'error' | 'unhandledrejection', listener: () => void) => void;
  removeEventListener: (kind: 'error' | 'unhandledrejection', listener: () => void) => void;
}>;

export function installRuntimeMonitoring(surface: RuntimeSurface, report: ReturnType<typeof createRuntimeReporter>) {
  // Event arguments are deliberately ignored, including raw Error objects.
  const onError = () => { void report('runtime_error', runtimeArea(surface.location.pathname)); };
  const onRejection = () => { void report('unhandled_rejection', runtimeArea(surface.location.pathname)); };
  surface.addEventListener('error', onError);
  surface.addEventListener('unhandledrejection', onRejection);
  return () => {
    surface.removeEventListener('error', onError);
    surface.removeEventListener('unhandledrejection', onRejection);
  };
}
