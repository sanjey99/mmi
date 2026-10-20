export type EmailActionMode = 'invite' | 'recovery';
export type EmailActionMarker = Readonly<{ mode: EmailActionMode; userId: string }>;

export const EMAIL_ACTION_CALLBACK_PATH = '/auth/callback';
export const EMAIL_ACTION_STORAGE_KEY = 'interview-station:email-action:v1';
export const PASSWORD_RESET_SENT_MESSAGE = 'If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder.';
export const MIN_PASSWORD_CODE_POINTS = 12;

const messages = Object.freeze({
  invalid_link: 'This account link is not valid. Request a new link or contact the founding team.',
  expired_link: 'This account link has expired or has already been used. Request a new link.',
  session_required: 'Your account link session has expired. Open a new invitation or password reset link.',
  password_too_short: 'Choose a password with at least 12 characters.',
  password_mismatch: 'The passwords do not match.',
  password_rejected: 'This password was not accepted. Choose a different password and try again.',
  invalid_email: 'Enter a valid email address.',
  unavailable: 'Account setup is unavailable right now. Please try again.',
});
export type EmailActionErrorCode = keyof typeof messages;

/** Contains only application-owned messages, never a provider response or URL. */
export class EmailActionError extends Error {
  readonly code: EmailActionErrorCode;
  constructor(code: EmailActionErrorCode) {
    super(messages[code]);
    this.name = 'EmailActionError';
    this.code = code;
  }
}

type EmailActionUser = Readonly<{ id: string }>;
export type EmailActionSession = Readonly<{ access_token: string; refresh_token: string; user: EmailActionUser }>;
export type EmailActionUserResult = Readonly<{ data: Readonly<{ user: EmailActionUser | null }>; error: unknown }>;
type AuthResult = Readonly<{ data: Readonly<{ user: EmailActionUser | null; session: EmailActionSession | null }>; error: unknown }>;
export type UpdatePasswordForSession = (args: Readonly<{ session: EmailActionSession; expectedUserId: string; password: string }>) => PromiseLike<EmailActionUserResult>;
export interface EmailActionAuth {
  verifyOtp: (params: Readonly<{ token_hash: string; type: EmailActionMode }>) => PromiseLike<AuthResult>;
  setSession: (params: Readonly<{ access_token: string; refresh_token: string }>) => PromiseLike<AuthResult>;
  exchangeCodeForSession: (code: string) => PromiseLike<AuthResult>;
  getUser: () => PromiseLike<EmailActionUserResult>;
  getSession: () => PromiseLike<Readonly<{ data: Readonly<{ session: EmailActionSession | null }>; error: unknown }>>;
  resetPasswordForEmail: (email: string, options: Readonly<{ redirectTo: string }>) => PromiseLike<Readonly<{ data?: unknown; error: unknown }>>;
}
export interface EmailActionStorage {
  getItem: (key: string) => string | null | PromiseLike<string | null>;
  setItem: (key: string, value: string) => void | PromiseLike<void>;
  removeItem: (key: string) => void | PromiseLike<void>;
}

type ParsedAction = Readonly<{ mode: EmailActionMode }> & (
  | Readonly<{ kind: 'otp'; tokenHash: string }>
  | Readonly<{ kind: 'implicit'; accessToken: string; refreshToken: string }>
  | Readonly<{ kind: 'pkce'; code: string }>
);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARAMETER_KEYS = new Set(['type', 'token_hash', 'access_token', 'refresh_token', 'code', 'expires_in', 'expires_at', 'token_type', 'error', 'error_code', 'error_description', 'error_uri']);
const isMode = (value: unknown): value is EmailActionMode => value === 'invite' || value === 'recovery';
const fail = (code: EmailActionErrorCode): never => { throw new EmailActionError(code); };

function trustedOrigin(value: string | undefined): string {
  if (typeof value !== 'string') return fail('unavailable');
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return fail('unavailable');
    return url.origin;
  } catch { return fail('unavailable'); }
}

function parseAction(rawUrl: string, origin: string): ParsedAction {
  if (typeof rawUrl !== 'string' || rawUrl.length > 20_000) return fail('invalid_link');
  let url: URL;
  try { url = new URL(rawUrl); } catch { return fail('invalid_link'); }
  if (url.origin !== origin || url.pathname !== EMAIL_ACTION_CALLBACK_PATH || url.username || url.password) return fail('invalid_link');
  const values = new Map<string, string>();
  const locations = new Map<string, number>();
  for (const [location, parameters] of [url.searchParams, new URLSearchParams(url.hash.slice(1))].entries()) {
    const seen = new Set<string>();
    for (const [key, value] of parameters) {
      if (!PARAMETER_KEYS.has(key) || seen.has(key) || value.length > 8_192) return fail('invalid_link');
      seen.add(key);
      if (values.has(key)) {
        // Supabase adds type to its hash even when redirectTo already contains it.
        if (key !== 'type' || locations.get(key) === location || values.get(key) !== value) return fail('invalid_link');
      } else {
        values.set(key, value);
        locations.set(key, location);
      }
    }
  }
  if (['error', 'error_code', 'error_description', 'error_uri'].some((key) => values.has(key))) {
    return fail(values.get('error_code') === 'otp_expired' ? 'expired_link' : 'invalid_link');
  }
  const mode = values.get('type');
  if (!isMode(mode)) return fail('invalid_link');
  for (const key of ['expires_in', 'expires_at']) {
    if (values.has(key) && !/^\d{1,12}$/.test(values.get(key)!)) return fail('invalid_link');
  }
  if (values.has('token_type') && values.get('token_type') !== 'bearer') return fail('invalid_link');
  for (const key of ['token_hash', 'access_token', 'refresh_token', 'code']) {
    if (values.has(key) && (!values.get(key) || /\s|[\u0000-\u001f\u007f]/u.test(values.get(key)!))) return fail('invalid_link');
  }
  const hasOtp = values.has('token_hash');
  const hasImplicit = values.has('access_token') || values.has('refresh_token');
  const hasCode = values.has('code');
  if (Number(hasOtp) + Number(hasImplicit) + Number(hasCode) !== 1) return fail('invalid_link');
  if (hasOtp) return { kind: 'otp', mode, tokenHash: values.get('token_hash')! };
  if (hasCode) return { kind: 'pkce', mode, code: values.get('code')! };
  if (!values.has('access_token') || !values.has('refresh_token')) return fail('invalid_link');
  return { kind: 'implicit', mode, accessToken: values.get('access_token')!, refreshToken: values.get('refresh_token')! };
}

function temporaryFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; name?: unknown };
  return (typeof value.status === 'number' && value.status >= 500)
    || value.name === 'AuthRetryableFetchError' || value.name === 'TypeError';
}

function parseMarker(raw: string | null): EmailActionMarker | null {
  if (raw === null || raw.length > 200) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2
      || !isMode(value.mode) || typeof value.userId !== 'string' || !UUID.test(value.userId)) return null;
    return Object.freeze({ mode: value.mode, userId: value.userId });
  } catch { return null; }
}

export function createEmailActionService({ auth, storage, callbackOrigin, updatePasswordForSession }: Readonly<{
  auth: EmailActionAuth;
  storage?: EmailActionStorage;
  callbackOrigin?: string;
  updatePasswordForSession: UpdatePasswordForSession;
}>) {
  let marker: EmailActionMarker | null | undefined;
  let markerVersion = 0;
  let callbackPromise: Promise<EmailActionMarker> | null = null;
  let callbackInFlight = false;
  let operationEpoch = 0;
  let callbackEpoch = -1;
  const listeners = new Set<(pending: EmailActionMarker | null) => void>();
  const notify = () => {
    for (const listener of listeners) {
      try { listener(marker ?? null); } catch { /* UI listeners cannot affect authentication. */ }
    }
  };
  const clearPendingAction = async (): Promise<void> => {
    operationEpoch += 1;
    markerVersion += 1;
    marker = null;
    notify();
    try { await storage?.removeItem(EMAIL_ACTION_STORAGE_KEY); } catch { /* The in-memory marker is already cleared. */ }
  };
  const saveMarker = async (value: EmailActionMarker): Promise<void> => {
    markerVersion += 1;
    marker = Object.freeze(value);
    notify();
    try { await storage?.setItem(EMAIL_ACTION_STORAGE_KEY, JSON.stringify(value)); } catch { /* Keep setup usable when browser storage is blocked. */ }
  };
  const readMarker = async (): Promise<EmailActionMarker | null> => {
    if (marker !== undefined) return marker;
    const version = markerVersion;
    let stored: string | null = null;
    try { stored = await storage?.getItem(EMAIL_ACTION_STORAGE_KEY) ?? null; } catch { /* No persisted action is trusted. */ }
    if (version !== markerVersion) return marker ?? null;
    marker = parseMarker(stored);
    if (stored !== null && marker === null) await clearPendingAction();
    return marker ?? null;
  };
  const getPendingAction = async (): Promise<EmailActionMarker | null> => {
    const pending = await readMarker();
    if (!pending) return null;
    const version = markerVersion;
    let result: EmailActionUserResult;
    try { result = await auth.getUser(); } catch { return fail('unavailable'); }
    if (version !== markerVersion) return getPendingAction();
    if (result.error && temporaryFailure(result.error)) return fail('unavailable');
    if (result.error || result.data.user?.id !== pending.userId) {
      await clearPendingAction();
      return null;
    }
    return pending;
  };

  return Object.freeze({
    clearPendingAction,
    getPendingAction,
    getCallbackPromise: (): Promise<EmailActionMarker> | null => callbackPromise,
    peekPendingAction: (): EmailActionMarker | null => marker ?? null,
    subscribe(listener: (pending: EmailActionMarker | null) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    handleCallback(rawUrl: string, replaceUrl: (cleanPath: string) => void): Promise<EmailActionMarker> {
      // Strip the entire query and fragment before parsing, storage, or any async work.
      try {
        replaceUrl(EMAIL_ACTION_CALLBACK_PATH);
      } catch {
        const rejected = Promise.reject<EmailActionMarker>(new EmailActionError('unavailable'));
        if (!callbackInFlight) callbackPromise = rejected;
        return rejected;
      }
      if (callbackInFlight && callbackEpoch === operationEpoch) return callbackPromise!;
      let action: ParsedAction;
      try { action = parseAction(rawUrl, trustedOrigin(callbackOrigin)); } catch (error) {
        void clearPendingAction();
        callbackPromise = Promise.reject(error instanceof EmailActionError ? error : new EmailActionError('invalid_link'));
        return callbackPromise;
      }
      // Capture and validate the original URL synchronously; bootstrap and the screen
      // share this promise so one-time tokens are never consumed twice.
      const cleared = clearPendingAction();
      const currentEpoch = operationEpoch;
      callbackEpoch = currentEpoch;
      callbackInFlight = true;
      callbackPromise = (async (): Promise<EmailActionMarker> => {
        await cleared;
        if (operationEpoch !== currentEpoch) return fail('session_required');
        let result: AuthResult;
        try {
          result = action.kind === 'otp'
            ? await auth.verifyOtp({ token_hash: action.tokenHash, type: action.mode })
            : action.kind === 'implicit'
              ? await auth.setSession({ access_token: action.accessToken, refresh_token: action.refreshToken })
              : await auth.exchangeCodeForSession(action.code);
        } catch { return fail('unavailable'); }
        if (operationEpoch !== currentEpoch) return fail('session_required');
        if (result.error) return fail(temporaryFailure(result.error) ? 'unavailable' : 'expired_link');
        const expectedUserId = result.data?.user?.id;
        if (typeof expectedUserId !== 'string' || !UUID.test(expectedUserId)
          || result.data?.session?.user?.id !== expectedUserId
          || !result.data.session.access_token || !result.data.session.refresh_token) return fail('session_required');
        let user: EmailActionUserResult;
        try { user = await auth.getUser(); } catch { return fail('unavailable'); }
        if (operationEpoch !== currentEpoch) return fail('session_required');
        if (user.error) return fail(temporaryFailure(user.error) ? 'unavailable' : 'session_required');
        if (user.data.user?.id !== expectedUserId) return fail('session_required');
        const pending = Object.freeze({ mode: action.mode, userId: expectedUserId });
        await saveMarker(pending);
        return pending;
      })().then((pending) => {
        if (callbackEpoch === currentEpoch) callbackInFlight = false;
        return pending;
      }, (error: unknown) => {
        if (callbackEpoch === currentEpoch) callbackInFlight = false;
        throw error;
      });
      return callbackPromise;
    },
    async updatePassword({ password, confirmPassword }: Readonly<{ password: string; confirmPassword: string }>): Promise<void> {
      if (typeof password !== 'string' || Array.from(password).length < MIN_PASSWORD_CODE_POINTS) return fail('password_too_short');
      if (password !== confirmPassword) return fail('password_mismatch');
      const pending = await getPendingAction();
      if (!pending) return fail('session_required');
      const currentEpoch = operationEpoch;
      let captured: Awaited<ReturnType<EmailActionAuth['getSession']>>;
      try { captured = await auth.getSession(); } catch { return fail('unavailable'); }
      if (operationEpoch !== currentEpoch) return fail('session_required');
      const session = captured.data.session;
      if (captured.error || !session || session.user.id !== pending.userId || !session.access_token || !session.refresh_token) {
        await clearPendingAction();
        return fail('session_required');
      }
      // The independent client may only mutate the captured, verified account.
      // Reading shared auth again inside the mutation could switch to another user.
      let result: EmailActionUserResult;
      try { result = await updatePasswordForSession({ session: Object.freeze({
        access_token: session.access_token, refresh_token: session.refresh_token,
        user: Object.freeze({ id: pending.userId }),
      }), expectedUserId: pending.userId, password }); } catch { return fail('unavailable'); }
      if (operationEpoch !== currentEpoch) return fail('session_required');
      if (result.error) {
        const status = typeof result.error === 'object' && result.error !== null
          ? (result.error as { status?: unknown }).status : null;
        if (status === 401 || status === 403) {
          await clearPendingAction();
          return fail('session_required');
        }
        return fail(temporaryFailure(result.error) ? 'unavailable' : 'password_rejected');
      }
      if (result.data.user?.id !== pending.userId) {
        await clearPendingAction();
        return fail('session_required');
      }
      await clearPendingAction();
    },
    async requestPasswordReset(email: string): Promise<void> {
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return fail('invalid_email');
      const redirectTo = `${trustedOrigin(callbackOrigin)}${EMAIL_ACTION_CALLBACK_PATH}?type=recovery`;
      let result: Readonly<{ data?: unknown; error: unknown }>;
      try { result = await auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo }); } catch { return fail('unavailable'); }
      // Unknown accounts and rate-limited addresses share the same public confirmation.
      if (result.error && temporaryFailure(result.error)) return fail('unavailable');
    },
  });
}
