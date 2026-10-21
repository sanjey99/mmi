import { describe, expect, it, vi } from 'vitest';
import { createPublicSignupService } from '../src/features/auth/publicSignup';
import { createEmailActionService, type EmailActionAuth } from '../src/features/auth/emailActions';

const sdk = vi.hoisted(() => ({ signInWithPassword: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: sdk } }));
vi.mock('../src/stores/practiceStore', () => ({ usePracticeStore: { getState: () => ({ reset: vi.fn() }) } }));
import { useAuthStore } from '../src/stores/authStore';
const origin = 'https://app.example.test';
const password = 'synthetic-password-12';
const token = 'SYNTHETIC_CAPTCHA_TOKEN';

function resetService(error: unknown = null) {
  const auth: EmailActionAuth = {
    verifyOtp: vi.fn(), setSession: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn(), getSession: vi.fn(),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error })),
  };
  const service = createEmailActionService({ auth, storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, callbackOrigin: origin, updatePasswordForSession: vi.fn() });
  return { service, auth };
}
describe('CAPTCHA forwarding keeps existing auth boundaries', () => {
  it('preserves the exact disabled login payload and uses the central store for an optional token', async () => {
    sdk.signInWithPassword.mockResolvedValue({ error: null }); sdk.signInWithPassword.mockClear();
    await useAuthStore.getState().signIn('candidate@example.test', password);
    expect(sdk.signInWithPassword).toHaveBeenLastCalledWith({ email: 'candidate@example.test', password });
    await useAuthStore.getState().signIn('candidate@example.test', password, token);
    expect(sdk.signInWithPassword).toHaveBeenLastCalledWith({ email: 'candidate@example.test', password, options: { captchaToken: token } });
    expect(sdk.signInWithPassword).toHaveBeenCalledTimes(2);
  });
  it('preserves provider rejection semantics in the central login wrapper', async () => {
    const error = { code: 'captcha_failed', message: 'PRIVATE_PROVIDER_DETAIL' }; sdk.signInWithPassword.mockResolvedValue({ error });
    await expect(useAuthStore.getState().signIn('candidate@example.test', password, token)).rejects.toBe(error);
  });
  it('forwards signup/resend tokens without adding profile or role metadata', async () => {
    const auth = { signUp: vi.fn(async () => ({ data: { session: null }, error: null })), resend: vi.fn(async () => ({ error: null })) };
    const signup = createPublicSignupService({ auth, callbackOrigin: origin });
    await signup.register({ email: 'candidate@example.test', password, confirmPassword: password, captchaToken: token });
    expect(auth.signUp).toHaveBeenCalledExactlyOnceWith({ email: 'candidate@example.test', password, options: { emailRedirectTo: `${origin}/auth/callback?type=signup`, captchaToken: token } });
    await createPublicSignupService({ auth, callbackOrigin: origin }).resendConfirmation('candidate@example.test', token);
    expect(auth.resend).toHaveBeenCalledExactlyOnceWith({ type: 'signup', email: 'candidate@example.test', options: { emailRedirectTo: `${origin}/auth/callback?type=signup`, captchaToken: token } });
  });
  it('never treats a signup/resend CAPTCHA rejection as email delivery', async () => {
    const auth = { signUp: vi.fn(async () => ({ data: { session: null }, error: { code: 'captcha_failed', message: 'PRIVATE_PROVIDER_DETAIL' } })), resend: vi.fn(async () => ({ error: { code: 'captcha_failed' } })) };
    await expect(createPublicSignupService({ auth, callbackOrigin: origin }).register({ email: 'candidate@example.test', password, confirmPassword: password, captchaToken: token })).rejects.toMatchObject({ code: 'captcha_failed' });
    await expect(createPublicSignupService({ auth, callbackOrigin: origin }).resendConfirmation('candidate@example.test', token)).rejects.toMatchObject({ code: 'captcha_failed' });
  });
  it('forwards recovery tokens with the app-owned callback and keeps disabled options unchanged', async () => {
    const { service, auth } = resetService();
    await service.requestPasswordReset(' Candidate@Example.Test ');
    expect(auth.resetPasswordForEmail).toHaveBeenLastCalledWith('candidate@example.test', { redirectTo: `${origin}/auth/callback?type=recovery` });
    await service.requestPasswordReset('candidate@example.test', token);
    expect(auth.resetPasswordForEmail).toHaveBeenLastCalledWith('candidate@example.test', { redirectTo: `${origin}/auth/callback?type=recovery`, captchaToken: token });
  });
  it('does not claim a recovery request succeeded when server CAPTCHA is enabled but the frontend is not ready', async () => {
    const { service } = resetService({ code: 'captcha_failed', message: 'PRIVATE_PROVIDER_DETAIL' });
    await expect(service.requestPasswordReset('candidate@example.test')).rejects.toMatchObject({ code: 'captcha_failed', message: 'The security check failed or expired. Please complete a new check and try again.' });
  });
});
