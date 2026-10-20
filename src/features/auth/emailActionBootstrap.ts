const CALLBACK_PATH = '/auth/callback';
const ACTION_KEYS = new Set(['token_hash', 'token', 'access_token', 'refresh_token', 'code', 'error', 'error_code', 'error_description']);

/** Called before Expo Router or Supabase initializes. The snapshot stays in memory. */
export function captureInitialEmailActionUrl(href: string, replaceUrl: (path: string) => void): string | null {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const hasCredentials = [...url.searchParams.keys(), ...fragment.keys()].some(key => ACTION_KEYS.has(key.toLowerCase()));
  if (url.pathname !== CALLBACK_PATH && !hasCredentials) return null;
  replaceUrl(CALLBACK_PATH);
  // An oversized link is scrubbed but is never retained or passed to Auth.
  return href.length > 20_000 ? `${url.origin}${CALLBACK_PATH}` : href;
}

let initialEmailActionUrl: string | null = typeof window === 'undefined' ? null
  : captureInitialEmailActionUrl(window.location.href, path => window.history.replaceState(null, '', path));

/** Consume once, releasing the initial credential URL after the service captures it. */
export function getInitialEmailActionUrl(): string | null {
  const value = initialEmailActionUrl;
  initialEmailActionUrl = null;
  return value;
}

/** Expo interprets //host paths as external links, even when read from this host. */
export function safeInternalPath(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u0020\u007f]/u.test(path)) return '/';
  try {
    const url = new URL(path, 'https://internal.invalid');
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.origin !== 'https://internal.invalid' || decodedPath.startsWith('//') || /[\\\u0000-\u0020\u007f]/u.test(decodedPath)) return '/';
    return `${url.pathname}${url.search}`;
  } catch { return '/'; }
}
