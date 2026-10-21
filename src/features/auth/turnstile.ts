import { AuthCaptchaError } from './captcha';

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export type TurnstileOptions = Readonly<{
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
  'error-callback': () => void;
  'unsupported-callback': () => void;
  'response-field': false;
  size: 'flexible';
  language: 'auto';
  tabindex: 0;
  retry: 'never';
  'refresh-expired': 'manual';
}>;
export type TurnstileApi = Readonly<{
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
}>;
type Browser = Window & { turnstile?: TurnstileApi };
const loads = new WeakMap<Document, Promise<TurnstileApi>>();
const isApi = (value: TurnstileApi | undefined): value is TurnstileApi => !!value && typeof value.render === 'function' && typeof value.remove === 'function' && typeof value.reset === 'function';

/** Called only by a focused, explicitly enabled web widget. No import-time I/O. */
export function loadTurnstile(browser: Browser): Promise<TurnstileApi> {
  if (isApi(browser.turnstile)) return Promise.resolve(browser.turnstile);
  const document = browser.document;
  const pending = loads.get(document);
  if (pending) return pending;
  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true; clearTimeout(timer); script.onload = null; script.onerror = null;
      script.remove(); loads.delete(document); reject(new AuthCaptchaError('unavailable'));
    };
    const timer = setTimeout(fail, 15_000);
    script.async = true; script.defer = true; script.src = TURNSTILE_SCRIPT_URL;
    script.referrerPolicy = 'no-referrer';
    script.onload = () => {
      if (settled) return;
      if (!isApi(browser.turnstile)) { fail(); return; }
      settled = true; clearTimeout(timer); script.onload = null; script.onerror = null;
      resolve(browser.turnstile);
    };
    script.onerror = fail;
    try { document.head.appendChild(script); } catch { fail(); }
  });
  loads.set(document, promise);
  // Also clear a synchronously rejected append failure after the cache is set.
  void promise.catch(() => { if (loads.get(document) === promise) loads.delete(document); });
  return promise;
}
