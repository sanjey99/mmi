export type AuthCaptchaConfig = Readonly<{ mode: 'off' | 'unavailable'; siteKey: null } | { mode: 'required'; siteKey: string }>;
export type AuthCaptchaStatus = 'disabled' | 'loading' | 'ready' | 'verified' | 'expired' | 'error' | 'unavailable' | 'submitting';
export type AuthCaptchaSnapshot = Readonly<{ status: AuthCaptchaStatus; revision: number; canSubmit: boolean }>;
const messages = {
  required: 'Complete the security check before continuing.',
  expired: 'The security check expired. Please try it again.',
  unavailable: 'The security check is unavailable right now. Please try again later.',
  rejected: 'The security check failed or expired. Please complete a new check and try again.',
  busy: 'Please wait for your current request to finish.',
} as const;
export class AuthCaptchaError extends Error {
  readonly code: keyof typeof messages;
  constructor(code: keyof typeof messages) { super(messages[code]); this.name = 'AuthCaptchaError'; this.code = code; }
}

export function resolveAuthCaptchaConfig(enabled: string | undefined, siteKey: string | undefined): AuthCaptchaConfig {
  if (enabled !== 'true') return Object.freeze({ mode: 'off', siteKey: null });
  if (typeof siteKey !== 'string' || !/^[A-Za-z0-9_-]{10,128}$/.test(siteKey)) return Object.freeze({ mode: 'unavailable', siteKey: null });
  return Object.freeze({ mode: 'required', siteKey });
}
export const authCaptchaConfig = resolveAuthCaptchaConfig(process.env.EXPO_PUBLIC_AUTH_CAPTCHA_ENABLED, process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY);
export function isCaptchaRejection(error: unknown): boolean {
  return error !== null && typeof error === 'object' && (error as { code?: unknown }).code === 'captcha_failed';
}
export function captchaOptions(token: string | undefined): Readonly<{ captchaToken?: string }> {
  if (token === undefined) return {};
  if (typeof token !== 'string' || !token || token.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(token)) throw new AuthCaptchaError('rejected');
  return { captchaToken: token };
}

/** Tokens live only in this closure and are consumed before an auth request.
 * Snapshots contain status only, never the token. The server remains the
 * authority: a frontend success alone does not establish CAPTCHA verification.
 */
export function createAuthCaptchaController(config: AuthCaptchaConfig, now: () => number = Date.now) {
  let active = false;
  let generation = 0;
  let revision = 0;
  let inFlight = false;
  let token: string | undefined;
  let verifiedAt = 0;
  let snapshot: AuthCaptchaSnapshot = Object.freeze({ status: config.mode === 'off' ? 'disabled' : config.mode === 'unavailable' ? 'unavailable' : 'loading', revision, canSubmit: config.mode === 'off' });
  const listeners = new Set<() => void>();
  const publish = (status: AuthCaptchaStatus) => {
    snapshot = Object.freeze({ status, revision, canSubmit: !inFlight && (status === 'disabled' || status === 'verified') });
    listeners.forEach(listener => listener());
  };
  const clear = () => { token = undefined; verifiedAt = 0; };
  const current = (expected: number) => active && config.mode === 'required' && generation === expected && !inFlight;
  const refresh = () => {
    if (inFlight) return;
    clear(); generation += 1; revision += 1;
    publish(config.mode === 'off' ? 'disabled' : config.mode === 'unavailable' ? 'unavailable' : 'loading');
  };
  return Object.freeze({
    config,
    getSnapshot: () => snapshot,
    getGeneration: () => generation,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate() { active = true; refresh(); },
    deactivate() { active = false; generation += 1; clear(); publish(config.mode === 'off' ? 'disabled' : 'loading'); },
    refresh,
    ready(expected: number) { if (current(expected) && snapshot.status === 'loading') publish('ready'); },
    verify(value: string, expected: number) {
      if (!current(expected)) return;
      if (typeof value !== 'string' || !value) { generation += 1; clear(); publish('error'); return; }
      try { captchaOptions(value); } catch { generation += 1; clear(); publish('error'); return; }
      token = value; verifiedAt = now(); publish('verified');
    },
    fail(status: 'expired' | 'error' | 'unavailable', expected: number) {
      if (!current(expected)) return;
      generation += 1; clear(); publish(status);
    },
    async run<T>(operation: (captchaToken: string | undefined) => PromiseLike<T>): Promise<T> {
      if (inFlight) throw new AuthCaptchaError('busy');
      if (!active || config.mode === 'unavailable') throw new AuthCaptchaError('unavailable');
      if (config.mode === 'required') {
        if (!token) throw new AuthCaptchaError(snapshot.status === 'expired' ? 'expired' : 'required');
        // Refresh before the server's five-minute expiry, allowing transit time.
        const age = now() - verifiedAt;
        if (age < 0 || age >= 290_000) { generation += 1; clear(); publish('expired'); throw new AuthCaptchaError('expired'); }
      }
      const captured = token;
      clear(); inFlight = true; publish('submitting');
      try { return await operation(captured); }
      finally { inFlight = false; if (active) refresh(); else clear(); }
    },
  });
}
export type AuthCaptchaController = ReturnType<typeof createAuthCaptchaController>;
