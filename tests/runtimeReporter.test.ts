import { describe, expect, it, vi } from 'vitest';
import { createRuntimeReporter, installRuntimeMonitoring, runtimeArea } from '../src/features/operations/runtimeReporter';
import type { RuntimeArea, RuntimeKind } from '../src/features/operations/types';

function setup() {
  let time = 0;
  const client = {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'private-credential' } }, error: null as unknown })) },
    rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ error: null })),
  };
  return { client, report: createRuntimeReporter(client, () => time), advance: () => { time += 60_000; } };
}

describe('privacy-safe runtime counters', () => {
  it.each([
    ['/login?email=secret@example.test', 'login'],
    ['/auth/callback#access_token=private', 'account_link'],
    ['/set-password', 'account_link'], ['/onboarding', 'onboarding'],
    ['/practice/mmi-station?answer=private', 'practice'], ['/practice/feedback', 'feedback'],
    ['/progress', 'progress'], ['/profile', 'profile'], ['/admin/usage?user=private', 'admin'],
    ['/private-personal-path', 'other'], ['x'.repeat(1_025), 'other'], [null, 'other'],
  ])('categorizes %s without retaining its contents', (path, area) => expect(runtimeArea(path)).toBe(area));

  it('sends only fixed categories, with identity left to the authenticated server', async () => {
    const { report, client } = setup();
    await report('runtime_error', runtimeArea('/practice/answer-secret#access_token=secret'));
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('record_app_runtime_event', { p_kind: 'runtime_error', p_area: 'practice' });
    expect(JSON.stringify(client.rpc.mock.calls)).not.toMatch(/answer-secret|access_token|private-credential/u);
  });

  it('never ingests anonymous events', async () => {
    const client = { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) }, rpc: vi.fn() };
    await createRuntimeReporter(client)('render_error', 'other');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects non-allowlisted values and tolerates unavailable authentication', async () => {
    const { report, client } = setup();
    await report('raw-exception-with-secret' as RuntimeKind, 'other');
    await report('runtime_error', '/secret-url' as RuntimeArea);
    expect(client.auth.getSession).not.toHaveBeenCalled();
    client.auth.getSession.mockResolvedValueOnce({ data: { session: { access_token: 'private' } }, error: new Error('private-provider-message') });
    await report('runtime_error', 'other');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('caps attempts at four per minute and does not buffer or retry', async () => {
    const { report, client, advance } = setup();
    for (let index = 0; index < 10; index++) await report('runtime_error', 'practice');
    expect(client.rpc).toHaveBeenCalledTimes(4);
    advance();
    await report('runtime_error', 'practice');
    expect(client.rpc).toHaveBeenCalledTimes(5);
  });

  it('drops concurrent errors while one report is in flight', async () => {
    const { client } = setup();
    let finish: ((value: { data: { session: { access_token: string } }; error: unknown }) => void) | undefined;
    client.auth.getSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const report = createRuntimeReporter(client);
    const first = report('runtime_error', 'other');
    await report('unhandled_rejection', 'other');
    expect(client.auth.getSession).toHaveBeenCalledTimes(1);
    finish?.({ data: { session: { access_token: 'private' } }, error: null });
    await first;
  });

  it('swallows both authentication and ingestion failures without recursive reporting', async () => {
    const { report, client } = setup();
    client.auth.getSession.mockRejectedValueOnce(new Error('secret A'));
    await expect(report('runtime_error', 'practice')).resolves.toBeUndefined();
    client.rpc.mockRejectedValueOnce(new Error('secret B'));
    await expect(report('runtime_error', 'practice')).resolves.toBeUndefined();
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('ignores raw browser event objects and removes listeners cleanly', async () => {
    const { report, client } = setup();
    const handlers = new Map<string, () => void>();
    const surface = {
      location: { pathname: '/auth/callback#token=private' },
      addEventListener: (kind: string, listener: () => void) => { handlers.set(kind, listener); },
      removeEventListener: (kind: string, _listener: () => void) => { handlers.delete(kind); },
    };
    const stop = installRuntimeMonitoring(surface, report);
    handlers.get('error')?.();
    await vi.waitFor(() => expect(client.rpc).toHaveBeenCalledWith('record_app_runtime_event', { p_kind: 'runtime_error', p_area: 'account_link' }));
    handlers.get('unhandledrejection')?.();
    await vi.waitFor(() => expect(client.rpc).toHaveBeenCalledWith('record_app_runtime_event', { p_kind: 'unhandled_rejection', p_area: 'account_link' }));
    stop();
    expect(handlers.size).toBe(0);
  });
});
