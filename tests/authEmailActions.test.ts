import { describe, expect, it, vi } from 'vitest';
import {
  createEmailActionService, EMAIL_ACTION_CALLBACK_PATH, EMAIL_ACTION_STORAGE_KEY,
  EmailActionError, PASSWORD_RESET_SENT_MESSAGE, type EmailActionAuth, type UpdatePasswordForSession,
} from '../src/features/auth/emailActions';

const origin = 'https://preview.example.test';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tokenHash = 'a'.repeat(64);
const inviteUrl = `${origin}/auth/callback#token_hash=${tokenHash}&type=invite`;
const password = 'a twelve character password';
const session = { access_token: 'synthetic-access-A', refresh_token: 'synthetic-refresh-A', user: { id: userId } };
const authData = { user: { id: userId }, session };
type AuthOverrides = Partial<EmailActionAuth> & { updateUser?: UpdatePasswordForSession };

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}
function auth(overrides: AuthOverrides = {}) {
  return {
    verifyOtp: vi.fn<EmailActionAuth['verifyOtp']>(async () => ({ data: authData, error: null })),
    setSession: vi.fn<EmailActionAuth['setSession']>(async () => ({ data: authData, error: null })),
    exchangeCodeForSession: vi.fn<EmailActionAuth['exchangeCodeForSession']>(async () => ({ data: authData, error: null })),
    getUser: vi.fn<EmailActionAuth['getUser']>(async () => ({ data: { user: { id: userId } }, error: null })),
    getSession: vi.fn<EmailActionAuth['getSession']>(async () => ({ data: { session }, error: null })),
    updateUser: vi.fn<UpdatePasswordForSession>(async () => ({ data: { user: { id: userId } }, error: null })),
    resetPasswordForEmail: vi.fn<EmailActionAuth['resetPasswordForEmail']>(async () => ({ data: {}, error: null })),
    ...overrides,
  };
}
function setup(overrides: AuthOverrides = {}) {
  const client = auth(overrides);
  const sessionStorage = storage();
  const service = createEmailActionService({ auth: client, storage: sessionStorage, callbackOrigin: origin, updatePasswordForSession: client.updateUser });
  const replaceUrl = vi.fn();
  return { client, sessionStorage, service, replaceUrl };
}

describe('email invitation and recovery callbacks', () => {
  it.each(['invite', 'recovery'] as const)('verifies %s token hashes from either query or fragment', async (mode) => {
    for (const separator of ['?', '#']) {
      const { client, sessionStorage, service, replaceUrl } = setup();
      const result = await service.handleCallback(`${origin}/auth/callback${separator}token_hash=${tokenHash}&type=${mode}`, replaceUrl);
      expect(result).toEqual({ mode, userId });
      expect(replaceUrl).toHaveBeenCalledExactlyOnceWith(EMAIL_ACTION_CALLBACK_PATH);
      expect(client.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: tokenHash, type: mode });
      expect(client.getUser).toHaveBeenCalledOnce();
      expect(client.setSession).not.toHaveBeenCalled();
      expect(client.exchangeCodeForSession).not.toHaveBeenCalled();
      expect([...sessionStorage.values.entries()]).toEqual([[EMAIL_ACTION_STORAGE_KEY, JSON.stringify({ mode, userId })]]);
      expect(JSON.stringify([...sessionStorage.values.values()])).not.toContain(tokenHash);
    }
  });

  it('strips credentials synchronously before storage and before any authentication call', async () => {
    const order: string[] = [];
    const sessionStorage = storage();
    sessionStorage.removeItem.mockImplementation((key) => { order.push('storage'); sessionStorage.values.delete(key); });
    const client = auth({ verifyOtp: vi.fn(async () => { order.push('verify'); return { data: authData, error: null }; }) });
    const service = createEmailActionService({ auth: client, storage: sessionStorage, callbackOrigin: origin, updatePasswordForSession: client.updateUser });
    const promise = service.handleCallback(inviteUrl, (path) => { expect(path).toBe('/auth/callback'); order.push('strip'); });
    expect(order).toEqual(['strip', 'storage']);
    expect(client.verifyOtp).not.toHaveBeenCalled();
    await promise;
    expect(order).toEqual(['strip', 'storage', 'verify']);
  });

  it('accepts implicit recovery tokens and an identical type in the app-owned redirect query', async () => {
    const { client, service, replaceUrl } = setup();
    await expect(service.handleCallback(`${origin}/auth/callback?type=recovery#access_token=synthetic-access&refresh_token=synthetic-refresh&type=recovery&expires_in=3600&expires_at=1800000000&token_type=bearer`, replaceUrl))
      .resolves.toEqual({ mode: 'recovery', userId });
    expect(client.setSession).toHaveBeenCalledExactlyOnceWith({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
    expect(client.verifyOtp).not.toHaveBeenCalled();
  });

  it('exchanges a PKCE code only when an explicit supported action type is supplied', async () => {
    const { client, service, replaceUrl } = setup();
    await service.handleCallback(`${origin}/auth/callback?code=synthetic-code&type=invite`, replaceUrl);
    expect(client.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('synthetic-code');
    const missingType = setup();
    await expect(missingType.service.handleCallback(`${origin}/auth/callback?code=synthetic-code`, missingType.replaceUrl))
      .rejects.toMatchObject({ code: 'invalid_link' });
    expect(missingType.client.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('shares callback consumption between bootstrap and the screen', async () => {
    let completeVerification!: (value: { data: typeof authData; error: null }) => void;
    const client = auth({ verifyOtp: vi.fn(() => new Promise<{ data: typeof authData; error: null }>((resolve) => { completeVerification = resolve; })) });
    const service = createEmailActionService({ auth: client, callbackOrigin: origin, updatePasswordForSession: client.updateUser });
    const first = service.handleCallback(inviteUrl, vi.fn());
    expect(service.getCallbackPromise()).toBe(first);
    const second = service.handleCallback(`${origin}/auth/callback`, vi.fn());
    expect(second).toBe(first);
    await vi.waitFor(() => expect(client.verifyOtp).toHaveBeenCalledOnce());
    completeVerification({ data: authData, error: null });
    await expect(first).resolves.toEqual({ mode: 'invite', userId });
    expect(client.verifyOtp).toHaveBeenCalledOnce();
    expect(service.getCallbackPromise()).toBe(first);
  });

  it.each([
    'not a URL',
    `${origin}/auth/callback?token_hash=secret&type=signup`,
    `${origin}/auth/callback?token_hash=secret&type=recovery&type=recovery`,
    `${origin}/auth/callback?token_hash=secret&type=invite#type=recovery`,
    `${origin}/auth/callback?token_hash=secret&type=invite#token_hash=secret`,
    `${origin}/auth/callback#access_token=secret&refresh_token=refresh&type=invite&access_token=secret`,
    `${origin}/auth/callback?type=invite&token_hash=secret&code=other-secret`,
    `${origin}/auth/callback?type=invite&token_hash=secret#access_token=secret&refresh_token=refresh`,
    `${origin}/auth/callback#access_token=secret&type=recovery`,
    `${origin}/auth/callback#refresh_token=secret&type=recovery`,
    `${origin}/auth/callback?token_hash=&type=invite`,
    `${origin}/auth/callback?token_hash=secret%0Asecret&type=invite`,
    `${origin}/auth/callback?token_hash=secret&type=invite&next=https%3A%2F%2Fevil.test`,
    `${origin}/auth/callback?token_hash=secret&type=invite&redirectTo=https%3A%2F%2Fevil.test`,
    `${origin}/auth/callback?token_hash=secret&type=invite#token_type=other`,
    `${origin}/auth/callback?token_hash=secret&type=invite&expires_in=NaN`,
    `https://evil.test/auth/callback?token_hash=secret&type=invite`,
    `${origin}/login?token_hash=secret&type=invite`,
    `https://attacker:secret@preview.example.test/auth/callback?token_hash=secret&type=invite`,
    `${origin}/auth/callback#token_hash=${'s'.repeat(8_193)}&type=invite`,
    `${origin}/auth/callback?${'s'.repeat(20_001)}`,
  ])('rejects malformed, duplicated, ambiguous, or redirect-steering input and still scrubs the URL', async (url) => {
    const { client, service, replaceUrl } = setup();
    const result = service.handleCallback(url, replaceUrl);
    expect(replaceUrl).toHaveBeenCalledExactlyOnceWith('/auth/callback');
    await expect(result).rejects.toMatchObject({ code: 'invalid_link' });
    expect(client.verifyOtp).not.toHaveBeenCalled();
    expect(client.setSession).not.toHaveBeenCalled();
    expect(client.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(service.peekPendingAction()).toBeNull();
  });

  it('scrubs URL error fields and returns a fixed expired-link error without provider details', async () => {
    const { client, service, replaceUrl } = setup();
    const result = service.handleCallback(`${origin}/auth/callback?error=access_denied&error_code=otp_expired&error_description=PRIVATE_PROVIDER_DETAIL#access_token=PRIVATE_TOKEN`, replaceUrl);
    expect(replaceUrl).toHaveBeenCalledExactlyOnceWith('/auth/callback');
    await expect(result).rejects.toMatchObject({ code: 'expired_link' });
    const error = await result.catch((value: unknown) => value) as EmailActionError;
    expect(JSON.stringify(error)).not.toContain('PRIVATE');
    expect(error.message).not.toContain('PRIVATE');
    expect(service.getCallbackPromise()).toBe(result);
    expect(client.getUser).not.toHaveBeenCalled();
  });

  it('does not consume credentials if browser history cannot be scrubbed', async () => {
    const { client, service } = setup();
    await expect(service.handleCallback(inviteUrl, () => { throw new Error(tokenHash); }))
      .rejects.toMatchObject({ code: 'unavailable' });
    expect(client.verifyOtp).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 403, message: 'PRIVATE_PROVIDER_DETAIL' }, 'expired_link'],
    [{ status: 500, message: 'PRIVATE_PROVIDER_DETAIL' }, 'unavailable'],
  ])('replaces provider failure with a safe public error', async (providerError, code) => {
    const { service, replaceUrl } = setup({ verifyOtp: vi.fn(async () => ({ data: { user: null, session: null }, error: providerError })) });
    const error = await service.handleCallback(inviteUrl, replaceUrl).catch((value: unknown) => value) as EmailActionError;
    expect(error).toBeInstanceOf(EmailActionError);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain('PRIVATE');
    expect(service.peekPendingAction()).toBeNull();
  });

  it('requires a server-validated user after consuming a link', async () => {
    const { service, replaceUrl, sessionStorage } = setup({ getUser: vi.fn(async () => ({ data: { user: null }, error: { status: 401 } })) });
    await expect(service.handleCallback(inviteUrl, replaceUrl)).rejects.toMatchObject({ code: 'session_required' });
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('rejects a verified account A link when shared auth switches to account B', async () => {
    const { client, service, replaceUrl, sessionStorage } = setup({
      getUser: vi.fn(async () => ({ data: { user: { id: otherUserId } }, error: null })),
    });
    await expect(service.handleCallback(inviteUrl, replaceUrl)).rejects.toMatchObject({ code: 'session_required' });
    expect(client.verifyOtp).toHaveBeenCalledOnce();
    expect(service.peekPendingAction()).toBeNull();
    expect(sessionStorage.values.size).toBe(0);
  });

  it('requires the successful callback response to identify the same user and session', async () => {
    const { client, service, replaceUrl } = setup({
      verifyOtp: vi.fn(async () => ({ data: { user: { id: userId }, session: { ...session, user: { id: otherUserId } } }, error: null })),
    });
    await expect(service.handleCallback(inviteUrl, replaceUrl)).rejects.toMatchObject({ code: 'session_required' });
    expect(client.getUser).not.toHaveBeenCalled();
    expect(service.peekPendingAction()).toBeNull();
    const missingSession = setup({ verifyOtp: vi.fn(async () => ({ data: { user: null, session: null }, error: null })) });
    await expect(missingSession.service.handleCallback(inviteUrl, missingSession.replaceUrl)).rejects.toMatchObject({ code: 'session_required' });
  });

  it('does not resurrect a pending action after cancellation while verification is in flight', async () => {
    let resolveVerification!: (value: { data: typeof authData; error: null }) => void;
    const { client, service, replaceUrl, sessionStorage } = setup({
      verifyOtp: vi.fn(() => new Promise<{ data: typeof authData; error: null }>((resolve) => { resolveVerification = resolve; })),
    });
    const result = service.handleCallback(inviteUrl, replaceUrl);
    await vi.waitFor(() => expect(client.verifyOtp).toHaveBeenCalledOnce());
    await service.clearPendingAction();
    resolveVerification({ data: authData, error: null });
    await expect(result).rejects.toMatchObject({ code: 'session_required' });
    expect(client.getUser).not.toHaveBeenCalled();
    expect(service.peekPendingAction()).toBeNull();
    expect(sessionStorage.values.size).toBe(0);
  });

  it('does not resurrect a pending action after cancellation during server user verification', async () => {
    let resolveUser!: (value: { data: { user: { id: string } }; error: null }) => void;
    const { client, service, replaceUrl, sessionStorage } = setup({
      getUser: vi.fn(() => new Promise<{ data: { user: { id: string } }; error: null }>((resolve) => { resolveUser = resolve; })),
    });
    const result = service.handleCallback(inviteUrl, replaceUrl);
    await vi.waitFor(() => expect(client.getUser).toHaveBeenCalledOnce());
    await service.clearPendingAction();
    resolveUser({ data: { user: { id: userId } }, error: null });
    await expect(result).rejects.toMatchObject({ code: 'session_required' });
    expect(service.peekPendingAction()).toBeNull();
    expect(sessionStorage.values.size).toBe(0);
  });
});

describe('pending email actions and password setup', () => {
  it('restores only the nonsecret action marker on reload and verifies its user', async () => {
    const { client, sessionStorage, service, replaceUrl } = setup();
    await service.handleCallback(inviteUrl, replaceUrl);
    const reloaded = createEmailActionService({ auth: client, storage: sessionStorage, callbackOrigin: origin, updatePasswordForSession: client.updateUser });
    expect(reloaded.peekPendingAction()).toBeNull();
    await expect(reloaded.getPendingAction()).resolves.toEqual({ mode: 'invite', userId });
    expect(reloaded.peekPendingAction()).toEqual({ mode: 'invite', userId });
    expect([...sessionStorage.values.keys()]).toEqual([EMAIL_ACTION_STORAGE_KEY]);
  });

  it.each([
    JSON.stringify({ mode: 'invite', userId, access_token: 'private-token' }),
    JSON.stringify({ mode: 'signup', userId }),
    JSON.stringify({ mode: 'recovery', userId: 'untrusted-user' }),
    '{invalid-json',
  ])('discards malformed persisted markers without using provider APIs', async (stored) => {
    const { client, sessionStorage, service } = setup();
    sessionStorage.values.set(EMAIL_ACTION_STORAGE_KEY, stored);
    await expect(service.getPendingAction()).resolves.toBeNull();
    expect(client.getUser).not.toHaveBeenCalled();
    expect(sessionStorage.values.has(EMAIL_ACTION_STORAGE_KEY)).toBe(false);
  });

  it.each([
    { data: { user: null }, error: { status: 401 } },
    { data: { user: { id: otherUserId } }, error: null },
  ])('clears the action when the session expires or belongs to another account', async (userResult) => {
    const { client, sessionStorage, service, replaceUrl } = setup();
    await service.handleCallback(inviteUrl, replaceUrl);
    client.getUser = vi.fn(async () => userResult);
    await expect(service.updatePassword({ password, confirmPassword: password })).rejects.toMatchObject({ code: 'session_required' });
    expect(client.updateUser).not.toHaveBeenCalled();
    expect(service.peekPendingAction()).toBeNull();
    expect(sessionStorage.values.has(EMAIL_ACTION_STORAGE_KEY)).toBe(false);
  });

  it('keeps a valid action for retry when server validation has a temporary failure', async () => {
    const { client, service, replaceUrl } = setup();
    await service.handleCallback(inviteUrl, replaceUrl);
    client.getUser = vi.fn(async () => ({ data: { user: null }, error: { status: 503 } }));
    await expect(service.getPendingAction()).rejects.toMatchObject({ code: 'unavailable' });
    expect(service.peekPendingAction()).toEqual({ mode: 'invite', userId });
  });

  it.each([
    ['short', 'short', 'password_too_short'],
    ['😀'.repeat(11), '😀'.repeat(11), 'password_too_short'],
    [password, `${password}!`, 'password_mismatch'],
  ])('requires twelve characters and matching confirmation before changing a password', async (chosen, confirmation, code) => {
    const { client, service } = setup();
    await expect(service.updatePassword({ password: chosen, confirmPassword: confirmation })).rejects.toMatchObject({ code });
    expect(client.getUser).not.toHaveBeenCalled();
    expect(client.updateUser).not.toHaveBeenCalled();
  });

  it('updates the verified user and clears the marker, notifying subscribed gates', async () => {
    const { client, sessionStorage, service, replaceUrl } = setup();
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    await service.handleCallback(inviteUrl, replaceUrl);
    expect(listener).toHaveBeenLastCalledWith({ mode: 'invite', userId });
    const chosen = '😀'.repeat(12);
    await service.updatePassword({ password: chosen, confirmPassword: chosen });
    expect(client.updateUser).toHaveBeenCalledExactlyOnceWith({ session, expectedUserId: userId, password: chosen });
    expect(client.getUser).toHaveBeenCalledTimes(2);
    expect(service.peekPendingAction()).toBeNull();
    expect(sessionStorage.values.size).toBe(0);
    expect(listener).toHaveBeenLastCalledWith(null);
    unsubscribe();
    const calls = listener.mock.calls.length;
    await service.clearPendingAction();
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('passes captured account A credentials to the isolated mutation even if main auth changes to B', async () => {
    const { client, service, replaceUrl } = setup();
    await service.handleCallback(inviteUrl, replaceUrl);
    client.getSession = vi.fn(async () => {
      client.getUser = vi.fn(async () => ({ data: { user: { id: otherUserId } }, error: null }));
      return { data: { session }, error: null };
    });
    await service.updatePassword({ password, confirmPassword: password });
    expect(client.updateUser).toHaveBeenCalledExactlyOnceWith({ session, expectedUserId: userId, password });
    expect(client.getUser).not.toHaveBeenCalled();
  });

  it('refuses to mutate when shared auth changed accounts before session capture', async () => {
    const { client, service, replaceUrl } = setup();
    await service.handleCallback(inviteUrl, replaceUrl);
    client.getSession = vi.fn(async () => ({ data: { session: { ...session, user: { id: otherUserId } } }, error: null }));
    await expect(service.updatePassword({ password, confirmPassword: password })).rejects.toMatchObject({ code: 'session_required' });
    expect(client.updateUser).not.toHaveBeenCalled();
    expect(service.peekPendingAction()).toBeNull();
  });

  it('refuses to mutate if password setup was cancelled while capturing the session', async () => {
    let resolveSession!: (value: { data: { session: typeof session }; error: null }) => void;
    const { client, service, replaceUrl } = setup();
    await service.handleCallback(inviteUrl, replaceUrl);
    client.getSession = vi.fn(() => new Promise<{ data: { session: typeof session }; error: null }>((resolve) => { resolveSession = resolve; }));
    const result = service.updatePassword({ password, confirmPassword: password });
    await vi.waitFor(() => expect(client.getSession).toHaveBeenCalledOnce());
    await service.clearPendingAction();
    resolveSession({ data: { session }, error: null });
    await expect(result).rejects.toMatchObject({ code: 'session_required' });
    expect(client.updateUser).not.toHaveBeenCalled();
  });

  it('preserves the action after a failed password update and exposes no provider details', async () => {
    const { service, replaceUrl } = setup({ updateUser: vi.fn(async () => ({ data: { user: null }, error: { status: 500, message: 'PRIVATE_PASSWORD_DETAIL' } })) });
    await service.handleCallback(inviteUrl, replaceUrl);
    const error = await service.updatePassword({ password, confirmPassword: password }).catch((value: unknown) => value) as EmailActionError;
    expect(error.code).toBe('unavailable');
    expect(error.message).not.toContain('PRIVATE');
    expect(service.peekPendingAction()).toEqual({ mode: 'invite', userId });
  });

  it('keeps setup open when a password policy rejects the chosen password', async () => {
    const { service, replaceUrl } = setup({ updateUser: vi.fn(async () => ({ data: { user: null }, error: { status: 422, message: 'PRIVATE_POLICY_DETAIL' } })) });
    await service.handleCallback(inviteUrl, replaceUrl);
    await expect(service.updatePassword({ password, confirmPassword: password })).rejects.toMatchObject({ code: 'password_rejected' });
    expect(service.peekPendingAction()).toEqual({ mode: 'invite', userId });
  });

  it('clears setup if the password update discovers an expired session', async () => {
    const { service, replaceUrl } = setup({ updateUser: vi.fn(async () => ({ data: { user: null }, error: { status: 401 } })) });
    await service.handleCallback(inviteUrl, replaceUrl);
    await expect(service.updatePassword({ password, confirmPassword: password })).rejects.toMatchObject({ code: 'session_required' });
    expect(service.peekPendingAction()).toBeNull();
  });

  it('supports async storage and remains usable when browser storage is blocked', async () => {
    const client = auth();
    const service = createEmailActionService({ auth: client, callbackOrigin: origin, updatePasswordForSession: client.updateUser, storage: {
      getItem: async () => { throw new Error('blocked'); },
      setItem: async () => { throw new Error('blocked'); },
      removeItem: async () => { throw new Error('blocked'); },
    } });
    await expect(service.getPendingAction()).resolves.toBeNull();
    await service.handleCallback(inviteUrl, vi.fn());
    await expect(service.updatePassword({ password, confirmPassword: password })).resolves.toBeUndefined();
  });
});

describe('password reset requests', () => {
  it('uses an app-owned callback and normalizes the email without persisting it', async () => {
    const { client, service, sessionStorage } = setup();
    await service.requestPasswordReset('  Tester@Example.test  ');
    expect(client.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith('tester@example.test', { redirectTo: `${origin}/auth/callback?type=recovery` });
    expect(sessionStorage.values.size).toBe(0);
    expect(PASSWORD_RESET_SENT_MESSAGE).toContain('If an account exists');
  });

  it.each([{ status: 404, code: 'user_not_found' }, { status: 429, code: 'over_email_send_rate_limit' }, null])('uses the same confirmation outcome for account-specific responses', async (error) => {
    const { service } = setup({ resetPasswordForEmail: vi.fn(async () => ({ error })) });
    await expect(service.requestPasswordReset('tester@example.test')).resolves.toBeUndefined();
  });

  it.each(['', 'bad-email', 'a@ b.test', 'a@b.test\nother@b.test', `${'a'.repeat(255)}@example.test`])('rejects invalid email input before a provider request', async (email) => {
    const { client, service } = setup();
    await expect(service.requestPasswordReset(email)).rejects.toMatchObject({ code: 'invalid_email' });
    expect(client.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it.each([undefined, 'https://evil.test/redirect', 'https://example.test?next=evil', 'javascript:alert(1)', 'http://untrusted.test'])('fails closed without a trusted web callback origin', async (callbackOrigin) => {
    const client = auth();
    const service = createEmailActionService({ auth: client, callbackOrigin, updatePasswordForSession: client.updateUser });
    await expect(service.requestPasswordReset('tester@example.test')).rejects.toMatchObject({ code: 'unavailable' });
    expect(client.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
