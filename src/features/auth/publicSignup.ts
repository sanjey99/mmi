import { EMAIL_ACTION_CALLBACK_PATH, MIN_PASSWORD_CODE_POINTS } from './emailActions';

export const SIGNUP_CONFIRMATION_MESSAGE = 'If this address can be registered, a confirmation email will arrive shortly. Check your inbox and spam folder. If you already have an account, sign in or reset your password.';
export const SIGNUP_EMAIL_COOLDOWN_MS = 60_000;

const messages = Object.freeze({
  invalid_email: 'Enter a valid email address.',
  password_too_short: 'Use at least 12 characters.',
  password_too_long: 'Use a password with no more than 128 characters.',
  password_mismatch: 'The passwords do not match.',
  password_rejected: 'This password was not accepted. Choose another unique password with at least 12 characters.',
  cooldown: 'Please wait a minute before requesting another account email.',
  unavailable: 'Registration emails are unavailable right now. Please try again later. Existing accounts can still sign in.',
});
export type SignupErrorCode = keyof typeof messages;

export class SignupError extends Error {
  readonly code: SignupErrorCode;
  constructor(code: SignupErrorCode) {
    super(messages[code]);
    this.name = 'SignupError';
    this.code = code;
  }
}

type SignupResult = Readonly<{ data: Readonly<{ session: unknown }>; error: unknown }>;
export interface SignupAuth {
  signUp: (args: Readonly<{ email: string; password: string; options: Readonly<{ emailRedirectTo: string }> }>) => PromiseLike<SignupResult>;
  resend: (args: Readonly<{ type: 'signup'; email: string; options: Readonly<{ emailRedirectTo: string }> }>) => PromiseLike<Readonly<{ error: unknown }>>;
}

function normalizeEmail(value: string): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new SignupError('invalid_email');
  return value.trim().toLowerCase();
}

function confirmationRedirect(origin: string | undefined): string {
  try {
    if (typeof origin !== 'string') throw new Error();
    const url = new URL(origin);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error();
    return `${url.origin}${EMAIL_ACTION_CALLBACK_PATH}?type=signup`;
  } catch { throw new SignupError('unavailable'); }
}

function publicError(error: unknown): void {
  if (!error) return;
  const code = typeof error === 'object' ? (error as { code?: unknown }).code : null;
  // The response must not disclose whether an address already has an account.
  if (code === 'user_already_exists' || code === 'email_exists' || code === 'user_not_found') return;
  if (code === 'weak_password') throw new SignupError('password_rejected');
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') throw new SignupError('cooldown');
  throw new SignupError('unavailable');
}

/** Sends only the chosen account credentials. No role, age, or profile metadata is accepted. */
export function createPublicSignupService({ auth, callbackOrigin, now = Date.now }: Readonly<{
  auth: SignupAuth;
  callbackOrigin?: string;
  now?: () => number;
}>) {
  let inFlight = false;
  let nextRequestAt = 0;

  async function send(operation: () => PromiseLike<Readonly<{ error: unknown }>>): Promise<void> {
    const instant = now();
    if (inFlight || instant < nextRequestAt) throw new SignupError('cooldown');
    inFlight = true;
    nextRequestAt = instant + SIGNUP_EMAIL_COOLDOWN_MS;
    try { publicError((await operation()).error); }
    catch (error) { throw error instanceof SignupError ? error : new SignupError('unavailable'); }
    finally { inFlight = false; }
  }

  return Object.freeze({
    async register({ email, password, confirmPassword }: Readonly<{ email: string; password: string; confirmPassword: string }>): Promise<void> {
      const address = normalizeEmail(email);
      if (typeof password !== 'string' || Array.from(password).length < MIN_PASSWORD_CODE_POINTS) throw new SignupError('password_too_short');
      if (Array.from(password).length > 128) throw new SignupError('password_too_long');
      if (password !== confirmPassword) throw new SignupError('password_mismatch');
      const emailRedirectTo = confirmationRedirect(callbackOrigin);
      await send(async () => {
        const result = await auth.signUp({ email: address, password, options: { emailRedirectTo } });
        // The isolated client never installs this session in the app. Require
        // confirmation to be enabled instead of silently signing the user in.
        if (result.data?.session) throw new SignupError('unavailable');
        return result;
      });
    },
    async resendConfirmation(email: string): Promise<void> {
      const address = normalizeEmail(email);
      const emailRedirectTo = confirmationRedirect(callbackOrigin);
      await send(() => auth.resend({ type: 'signup', email: address, options: { emailRedirectTo } }));
    },
    getCooldownSeconds(): number {
      return Math.max(0, Math.ceil((nextRequestAt - now()) / 1_000));
    },
  });
}
