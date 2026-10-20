import { createClient } from '@supabase/supabase-js';
import { createEmailActionService, EMAIL_ACTION_CALLBACK_PATH, type EmailActionSession } from './emailActions';
import { getInitialEmailActionUrl } from './emailActionBootstrap';
import { authStorage } from '../../lib/authStorage';
import { supabase } from '../../lib/supabase';

let passwordOperationId = 0;

async function updatePasswordForSession({ session, expectedUserId, password }: Readonly<{
  session: EmailActionSession;
  expectedUserId: string;
  password: string;
}>) {
  const scoped = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        storageKey: `interview-station:password-operation:${++passwordOperationId}`,
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const binding = await scoped.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (binding.error) return { data: { user: null }, error: binding.error };
  const verified = await scoped.auth.getUser();
  if (verified.error || verified.data.user?.id !== expectedUserId) {
    return { data: { user: null }, error: { status: 401 } };
  }
  return scoped.auth.updateUser({ password });
}

export const emailActionService = createEmailActionService({
  auth: supabase.auth,
  storage: authStorage,
  callbackOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
  updatePasswordForSession,
});

let bootstrapEmailAction: ReturnType<typeof emailActionService.handleCallback> | null = null;

export function getBootstrapEmailAction() {
  return bootstrapEmailAction;
}

export function captureBootstrapEmailAction() {
  if (bootstrapEmailAction !== null || typeof window === 'undefined') return bootstrapEmailAction;
  const url = new URL(getInitialEmailActionUrl() ?? window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const actionKeys = new Set(['token_hash', 'token', 'access_token', 'refresh_token', 'code', 'error', 'error_code', 'error_description']);
  const hasCredentials = [...url.searchParams.keys(), ...fragment.keys()].some((key) => actionKeys.has(key.toLowerCase()));
  if (url.pathname !== EMAIL_ACTION_CALLBACK_PATH && !hasCredentials) return null;
  url.pathname = EMAIL_ACTION_CALLBACK_PATH;
  bootstrapEmailAction = emailActionService.handleCallback(url.href, (path) => {
    window.history.replaceState(null, '', path);
  });
  void bootstrapEmailAction.catch(() => undefined);
  return bootstrapEmailAction;
}
