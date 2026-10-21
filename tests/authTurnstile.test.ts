import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTurnstile, TURNSTILE_SCRIPT_URL, type TurnstileApi } from '../src/features/auth/turnstile';

function setup() {
  const scripts: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null; remove: ReturnType<typeof vi.fn> }> = [];
  const document = { createElement: vi.fn(() => { const script = { src: '', onload: null, onerror: null, remove: vi.fn() }; scripts.push(script); return script; }), head: { appendChild: vi.fn() } };
  const browser = { document, turnstile: undefined as TurnstileApi | undefined };
  const load = () => loadTurnstile(browser as unknown as Parameters<typeof loadTurnstile>[0]);
  return { browser, document, scripts, load };
}
const api = (): TurnstileApi => ({ render: vi.fn(() => 'synthetic-widget'), remove: vi.fn(), reset: vi.fn() });
afterEach(() => { vi.useRealTimers(); });

describe('Turnstile browser script lifecycle', () => {
  it('performs no I/O at import and loads only the fixed provider URL when explicitly called', async () => {
    const { document, browser, scripts, load } = setup();
    expect(document.createElement).not.toHaveBeenCalled();
    const promise = load();
    expect(scripts[0].src).toBe(TURNSTILE_SCRIPT_URL);
    expect(document.head.appendChild).toHaveBeenCalledExactlyOnceWith(scripts[0]);
    browser.turnstile = api(); scripts[0].onload?.();
    await expect(promise).resolves.toBe(browser.turnstile);
  });
  it('deduplicates concurrent loads within one document and reuses a valid API', async () => {
    const { browser, scripts, document, load } = setup(); const first = load(); const second = load();
    expect(first).toBe(second); expect(document.head.appendChild).toHaveBeenCalledOnce();
    browser.turnstile = api(); scripts[0].onload?.(); await first;
    await expect(load()).resolves.toBe(browser.turnstile); expect(document.head.appendChild).toHaveBeenCalledOnce();
  });
  it('removes a failed script and supports a clean retry without provider diagnostics', async () => {
    const { browser, scripts, load } = setup(); const first = load(); const rejected = expect(first).rejects.toMatchObject({ code: 'unavailable' });
    scripts[0].onerror?.(); await rejected; expect(scripts[0].remove).toHaveBeenCalledOnce();
    const retry = load(); browser.turnstile = api(); scripts[1].onload?.(); await expect(retry).resolves.toBe(browser.turnstile);
  });
  it('bounds script loading and ignores late completion after timeout', async () => {
    vi.useFakeTimers(); const { scripts, browser, load } = setup(); const first = load(); const late = scripts[0].onload;
    const rejected = expect(first).rejects.toMatchObject({ code: 'unavailable' });
    await vi.advanceTimersByTimeAsync(15_000); await rejected;
    browser.turnstile = api(); late?.(); expect(scripts[0].remove).toHaveBeenCalledOnce();
  });
  it('rejects malformed APIs and synchronous DOM failures', async () => {
    const first = setup(); const promise = first.load(); const rejected = expect(promise).rejects.toMatchObject({ code: 'unavailable' });
    first.scripts[0].onload?.(); await rejected;
    const second = setup(); second.document.head.appendChild.mockImplementation(() => { throw new Error('PRIVATE_DOM_DETAIL'); });
    await expect(second.load()).rejects.toMatchObject({ code: 'unavailable' });
  });
});
