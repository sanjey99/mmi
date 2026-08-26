import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  listener: undefined as undefined | ((event: string, session: never) => void | Promise<void>),
}));

const profileMocks = vi.hoisted(() => ({
  from: vi.fn(),
  single: vi.fn(),
}));

const practiceMocks = vi.hoisted(() => ({
  reset: vi.fn(),
}));

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    from: profileMocks.from,
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function settleDeferredAuthWork() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

function createProfile(id: string, isAdmin: boolean) {
  return {
    id,
    full_name: id === 'user-a' ? 'Admin A' : 'Partner B',
    avatar_url: null,
    university_target: 'ucl',
    entry_year: 2027,
    daily_goal: 5,
    streak_current: 2,
    streak_longest: 4,
    streak_last_date: '2026-08-24',
    onboarding_complete: true,
    is_admin: isAdmin,
    created_at: '2026-08-25T00:00:00.000Z',
    updated_at: '2026-08-25T00:00:00.000Z',
  };
}

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
    profileMocks.from.mockReset();
    profileMocks.single.mockReset();
    profileMocks.from.mockImplementation(() => {
      const query = {
        eq: vi.fn(() => query),
        select: vi.fn(() => query),
        single: profileMocks.single,
        update: vi.fn(() => query),
      };
      return query;
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
    await settleDeferredAuthWork();
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

  it('clears the previous profile and ignores its delayed refresh when the account changes', async () => {
    const userA = { id: 'user-a' } as never;
    const userB = { id: 'user-b' } as never;
    const sessionA = { user: userA, access_token: 'a' } as never;
    const sessionB = { user: userB, access_token: 'b' } as never;
    const profileA = createProfile('user-a', true);
    const delayedA = createDeferred<{ data: typeof profileA }>();
    const startedB = createDeferred<void>();
    useAuthStore.setState({ session: sessionA, profile: profileA, loading: false });
    authMocks.getSession.mockResolvedValue({ data: { session: sessionA } });

    await useAuthStore.getState().init();
    authMocks.getUser
      .mockResolvedValueOnce({ data: { user: userA } })
      .mockResolvedValueOnce({ data: { user: userB } });
    profileMocks.single
      .mockReturnValueOnce(delayedA.promise)
      .mockImplementationOnce(() => {
        startedB.resolve();
        return Promise.resolve({ data: null });
      });

    const refreshA = useAuthStore.getState().refreshProfile();
    await vi.waitFor(() => expect(profileMocks.single).toHaveBeenCalledOnce());
    authMocks.listener?.('SIGNED_IN', sessionB);

    expect(useAuthStore.getState().profile).toBeNull();
    delayedA.resolve({ data: profileA });
    await refreshA;
    expect(useAuthStore.getState().profile).toBeNull();

    await startedB.promise;
    await vi.waitFor(() => {
      expect(useAuthStore.getState().profile).toBeNull();
      expect(useAuthStore.getState().loading).toBe(false);
    });
    expect(profileMocks.single).toHaveBeenCalledTimes(2);
  });

  it('ignores a delayed profile update after sign-out', async () => {
    const userA = { id: 'user-a' } as never;
    const sessionA = { user: userA, access_token: 'a' } as never;
    const profileA = createProfile('user-a', true);
    const updatedProfileA = { ...profileA, full_name: 'Updated Admin A' };
    const delayedUpdate = createDeferred<{ data: typeof updatedProfileA; error: null }>();
    useAuthStore.setState({ session: sessionA, profile: profileA, loading: false });
    authMocks.getSession.mockResolvedValue({ data: { session: sessionA } });

    await useAuthStore.getState().init();
    authMocks.getUser.mockResolvedValueOnce({ data: { user: userA } });
    profileMocks.single.mockReturnValueOnce(delayedUpdate.promise);

    const updateA = useAuthStore.getState().updateProfile({ full_name: 'Updated Admin A' });
    await authMocks.listener?.('SIGNED_OUT', null as never);
    delayedUpdate.resolve({ data: updatedProfileA, error: null });
    await updateA;

    expect(useAuthStore.getState().profile).toBeNull();
  });

  it('returns from the auth callback before starting the profile request', async () => {
    const userA = { id: 'user-a' } as never;
    const userB = { id: 'user-b' } as never;
    const sessionA = { user: userA, access_token: 'a' } as never;
    const sessionB = { user: userB, access_token: 'b' } as never;
    const profileA = createProfile('user-a', true);
    const profileB = createProfile('user-b', false);
    useAuthStore.setState({ session: sessionA, profile: profileA, loading: false });
    authMocks.getSession.mockResolvedValue({ data: { session: sessionA } });

    await useAuthStore.getState().init();
    authMocks.getUser.mockResolvedValueOnce({ data: { user: userB } });
    profileMocks.single.mockResolvedValueOnce({ data: profileB });
    vi.useFakeTimers();

    try {
      const callbackResult = authMocks.listener?.('SIGNED_IN', sessionB);

      expect(callbackResult).toBeUndefined();
      expect(useAuthStore.getState().profile).toBeNull();
      expect(profileMocks.from).not.toHaveBeenCalled();

      await vi.runAllTimersAsync();
      expect(useAuthStore.getState().profile).toEqual(profileB);
      expect(useAuthStore.getState().loading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
