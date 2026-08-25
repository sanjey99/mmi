import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';
import { usePracticeStore } from './practiceStore';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => {
  let authEpoch = 0;

  const isCurrentProfileRequest = (requestEpoch: number, userId: string) => (
    authEpoch === requestEpoch && get().session?.user.id === userId
  );

  return {
    session: null,
    profile: null,
    loading: true,

    init: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const currentUserId = get().session?.user.id;
      if (!session || currentUserId !== session.user.id) {
        authEpoch += 1;
        usePracticeStore.getState().reset();
        set({ session, profile: null });
      } else {
        set({ session });
      }
      const initEpoch = authEpoch;
      if (session) await get().refreshProfile();
      if (authEpoch === initEpoch && get().session?.user.id === session?.user.id) {
        set({ loading: false });
      }

      supabase.auth.onAuthStateChange((_event, session) => {
        if (session) {
          if (get().session?.user.id !== session.user.id) {
            authEpoch += 1;
            usePracticeStore.getState().reset();
            set({ session, profile: null, loading: true });
          } else {
            set({ session, loading: true });
          }
          const transitionEpoch = authEpoch;
          setTimeout(() => {
            const completeTransition = () => {
              if (authEpoch === transitionEpoch && get().session?.user.id === session.user.id) {
                set({ loading: false });
              }
            };
            void get().refreshProfile().then(completeTransition, completeTransition);
          }, 0);
        } else {
          authEpoch += 1;
          usePracticeStore.getState().reset();
          set({ session: null, profile: null, loading: false });
        }
      });
    },

    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },

    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      authEpoch += 1;
      usePracticeStore.getState().reset();
      set({ session: null, profile: null });
    },

    refreshProfile: async () => {
      const requestEpoch = authEpoch;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !isCurrentProfileRequest(requestEpoch, user.id)) return;
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, university_target, entry_year, daily_goal, streak_current, streak_longest, streak_last_date, onboarding_complete, is_admin, created_at, updated_at')
        .eq('id', user.id)
        .single();
      if (data && isCurrentProfileRequest(requestEpoch, user.id)) {
        set({ profile: data as Profile });
      }
    },

    updateProfile: async (updates) => {
      const requestEpoch = authEpoch;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !isCurrentProfileRequest(requestEpoch, user.id)) return;
      const { data, error } = await supabase
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', user.id)
        .select('id, full_name, avatar_url, university_target, entry_year, daily_goal, streak_current, streak_longest, streak_last_date, onboarding_complete, is_admin, created_at, updated_at')
        .single();
      if (error) throw error;
      if (data && isCurrentProfileRequest(requestEpoch, user.id)) {
        set({ profile: data as Profile });
      }
    },
  };
});
