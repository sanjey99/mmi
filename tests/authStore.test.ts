import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  listener: undefined as undefined | ((event: string, session: never) => Promise<void>),
}));

const practiceMocks = vi.hoisted(() => ({
  reset: vi.fn(),
}));

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: authMocks.signOut,
      getSession: authMocks.getSession,
      getUser: authMocks.getUser,
      onAuthStateChange: authMocks.onAuthStateChange,
    },
  },
}));

vi.mock('../src/stores/practiceStore', () => ({
  usePracticeStore: {
    getState: () => ({ reset: practiceMocks.reset }),
  },
}));

import { useAuthStore } from '../src/stores/authStore';

describe('authStore.signOut', () => {
  beforeEach(() => {
    authMocks.signOut.mockReset();
    authMocks.getSession.mockReset();
    authMocks.getUser.mockReset();
    authMocks.onAuthStateChange.mockReset();
    authMocks.listener = undefined;
    authMocks.getSession.mockResolvedValue({ data: { session: null } });
    authMocks.getUser.mockResolvedValue({ data: { user: null } });
    authMocks.onAuthStateChange.mockImplementation((listener) => {
      authMocks.listener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    practiceMocks.reset.mockReset();
    useAuthStore.setState({ session: { access_token: 'test' } as never, profile: null, loading: false });
  });

  it('keeps local authentication state when Supabase sign-out fails', async () => {
    authMocks.signOut.mockResolvedValue({ error: new Error('network unavailable') });

    await expect(useAuthStore.getState().signOut()).rejects.toThrow('network unavailable');
    expect(useAuthStore.getState().session).not.toBeNull();
    expect(practiceMocks.reset).not.toHaveBeenCalled();
  });

  it('clears local authentication state after Supabase confirms sign-out', async () => {
    authMocks.signOut.mockResolvedValue({ error: null });

    await useAuthStore.getState().signOut();

    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().profile).toBeNull();
    expect(practiceMocks.reset).toHaveBeenCalledOnce();
  });

  it('clears practice state when the authenticated account changes but not on same-user refresh', async () => {
    const sessionA = { user: { id: 'user-a' }, access_token: 'a' } as never;
    const sessionB = { user: { id: 'user-b' }, access_token: 'b' } as never;
    useAuthStore.setState({ session: sessionA, profile: null, loading: false });
    authMocks.getSession.mockResolvedValue({ data: { session: sessionA } });

    await useAuthStore.getState().init();
    practiceMocks.reset.mockClear();

    await authMocks.listener?.('TOKEN_REFRESHED', sessionA);
    expect(practiceMocks.reset).not.toHaveBeenCalled();

    await authMocks.listener?.('SIGNED_IN', sessionB);
    expect(practiceMocks.reset).toHaveBeenCalledOnce();
  });

  it('clears practice state on an auth transition to no session', async () => {
    const sessionA = { user: { id: 'user-a' }, access_token: 'a' } as never;
    useAuthStore.setState({ session: sessionA, profile: null, loading: false });
    authMocks.getSession.mockResolvedValue({ data: { session: sessionA } });

    await useAuthStore.getState().init();
    practiceMocks.reset.mockClear();
    await authMocks.listener?.('SIGNED_OUT', null as never);

    expect(practiceMocks.reset).toHaveBeenCalledOnce();
  });
});
