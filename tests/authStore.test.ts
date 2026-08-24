import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: authMocks.signOut,
    },
  },
}));

import { useAuthStore } from '../src/stores/authStore';

describe('authStore.signOut', () => {
  beforeEach(() => {
    authMocks.signOut.mockReset();
    useAuthStore.setState({ session: { access_token: 'test' } as never, profile: null, loading: false });
  });

  it('keeps local authentication state when Supabase sign-out fails', async () => {
    authMocks.signOut.mockResolvedValue({ error: new Error('network unavailable') });

    await expect(useAuthStore.getState().signOut()).rejects.toThrow('network unavailable');
    expect(useAuthStore.getState().session).not.toBeNull();
  });

  it('clears local authentication state after Supabase confirms sign-out', async () => {
    authMocks.signOut.mockResolvedValue({ error: null });

    await useAuthStore.getState().signOut();

    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().profile).toBeNull();
  });
});
