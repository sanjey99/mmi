import { createClient } from '@supabase/supabase-js';
import { createPublicSignupService } from './publicSignup';

// Registration may send an email but cannot replace a signed-in account or
// install an unconfirmed session in the shared application client.
const signupClient = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { storageKey: 'interview-station:registration', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

export const publicSignupService = createPublicSignupService({
  auth: signupClient.auth,
  callbackOrigin: typeof window === 'undefined' ? undefined : window.location.origin,
});
