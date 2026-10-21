import { describe, expect, it, vi } from 'vitest';
import { AuthCaptchaError, captchaOptions, createAuthCaptchaController, isCaptchaRejection, resolveAuthCaptchaConfig } from '../src/features/auth/captcha';

const required = resolveAuthCaptchaConfig('true', '1x00000000000000000000AA');
function setup() {
  let now = 1_000;
  const controller = createAuthCaptchaController(required, () => now);
  controller.activate();
  return { controller, advance: (ms: number) => { now += ms; } };
}

describe('optional auth CAPTCHA configuration and tokens', () => {
  it.each([undefined, '', 'false', 'TRUE'])('stays off unless explicitly enabled: %s', flag => {
    expect(resolveAuthCaptchaConfig(flag, '1x00000000000000000000AA')).toEqual({ mode: 'off', siteKey: null });
  });
  it.each([undefined, '', 'short', ' site-key-invalid ', 'x'.repeat(129), 'https://other.example/key'])('fails closed when enabled with invalid key %s', key => {
    expect(resolveAuthCaptchaConfig('true', key)).toEqual({ mode: 'unavailable', siteKey: null });
  });
  it('omits the token option when off and bounds opaque tokens without exposing them', () => {
    expect(captchaOptions(undefined)).toEqual({});
    expect(captchaOptions('SYNTHETIC_TOKEN')).toEqual({ captchaToken: 'SYNTHETIC_TOKEN' });
    for (const token of ['', 'secret\nvalue', 'secret value', 'x'.repeat(2049)]) expect(() => captchaOptions(token)).toThrow(AuthCaptchaError);
    expect(captchaOptions('x'.repeat(2048)).captchaToken).toHaveLength(2048);
    expect(isCaptchaRejection({ code: 'captcha_failed', message: 'PRIVATE_PROVIDER_DETAIL' })).toBe(true);
    expect(isCaptchaRejection(null)).toBe(false);
  });
});

describe('per-form, single-use CAPTCHA lifecycle', () => {
  it('runs unchanged requests when disabled and never requires a widget', async () => {
    const controller = createAuthCaptchaController({ mode: 'off', siteKey: null });
    controller.activate();
    controller.verify('IGNORED_TOKEN', controller.getGeneration());
    const operation = vi.fn(async token => { expect(token).toBeUndefined(); return 'ok'; });
    await expect(controller.run(operation)).resolves.toBe('ok');
    expect(controller.getSnapshot()).toMatchObject({ status: 'disabled', canSubmit: true });
  });
  it('blocks unverified and unavailable requests before any auth operation', async () => {
    const { controller } = setup();
    const operation = vi.fn(async () => {});
    await expect(controller.run(operation)).rejects.toMatchObject({ code: 'required' });
    const unavailable = createAuthCaptchaController({ mode: 'unavailable', siteKey: null }); unavailable.activate();
    await expect(unavailable.run(operation)).rejects.toMatchObject({ code: 'unavailable' });
    expect(operation).not.toHaveBeenCalled();
  });
  it('rejects a malformed widget callback instead of presenting a verified state', () => {
    const { controller } = setup();
    controller.verify(undefined as unknown as string, controller.getGeneration());
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', canSubmit: false });
  });
  it('consumes one token atomically and rejects parallel requests', async () => {
    const { controller } = setup();
    controller.verify('SYNTHETIC_TOKEN', controller.getGeneration());
    let complete!: () => void;
    const operation = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
    const first = controller.run(operation);
    expect(controller.getSnapshot()).toMatchObject({ status: 'submitting', canSubmit: false });
    await expect(controller.run(operation)).rejects.toMatchObject({ code: 'busy' });
    expect(operation).toHaveBeenCalledExactlyOnceWith('SYNTHETIC_TOKEN');
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('SYNTHETIC_TOKEN');
    complete(); await first;
    await expect(controller.run(operation)).rejects.toMatchObject({ code: 'required' });
  });
  it('clears a token after failed requests and requires a newly rendered challenge', async () => {
    const { controller } = setup(); const generation = controller.getGeneration();
    controller.verify('SYNTHETIC_TOKEN', generation);
    await expect(controller.run(async () => { throw new Error('NETWORK_FAILURE'); })).rejects.toThrow('NETWORK_FAILURE');
    expect(controller.getGeneration()).toBeGreaterThan(generation);
    controller.verify('STALE_TOKEN', generation);
    expect(controller.getSnapshot().status).toBe('loading');
  });
  it.each(['expired', 'error', 'unavailable'] as const)('invalidates callbacks and tokens after %s until retry', async status => {
    const { controller } = setup(); const generation = controller.getGeneration();
    controller.verify('SYNTHETIC_TOKEN', generation); controller.fail(status, generation);
    controller.verify('STALE_TOKEN', generation);
    expect(controller.getSnapshot()).toMatchObject({ status, canSubmit: false });
    controller.refresh(); const fresh = controller.getGeneration();
    controller.ready(fresh); controller.verify('FRESH_TOKEN', fresh);
    await expect(controller.run(async token => token)).resolves.toBe('FRESH_TOKEN');
  });
  it.each([290_000, -1])('rejects expired or backwards-clock tokens at age %s', async age => {
    const { controller, advance } = setup(); controller.verify('SYNTHETIC_TOKEN', controller.getGeneration()); advance(age);
    const operation = vi.fn(async () => {});
    await expect(controller.run(operation)).rejects.toMatchObject({ code: 'expired' });
    expect(operation).not.toHaveBeenCalled();
  });
  it('drops tokens and late callbacks on blur and permits a fresh check after refocus', async () => {
    const { controller } = setup(); const generation = controller.getGeneration();
    controller.verify('SYNTHETIC_TOKEN', generation); controller.deactivate(); controller.verify('LATE_TOKEN', generation);
    await expect(controller.run(async () => {})).rejects.toMatchObject({ code: 'unavailable' });
    controller.activate(); await expect(controller.run(async () => {})).rejects.toMatchObject({ code: 'required' });
  });
  it('does not let stale ready/error callbacks replace newer verified state', () => {
    const { controller } = setup(); const old = controller.getGeneration(); controller.refresh();
    controller.verify('FRESH_TOKEN', controller.getGeneration()); controller.ready(old); controller.fail('error', old);
    expect(controller.getSnapshot()).toMatchObject({ status: 'verified', canSubmit: true });
  });
  it('notifies status listeners and supports unsubscribe without exposing token storage', () => {
    const { controller } = setup(); const listener = vi.fn(); const remove = controller.subscribe(listener);
    controller.verify('SYNTHETIC_TOKEN', controller.getGeneration()); expect(listener).toHaveBeenCalledOnce();
    remove(); controller.refresh(); expect(listener).toHaveBeenCalledOnce();
    expect(Object.keys(controller.getSnapshot()).sort()).toEqual(['canSubmit', 'revision', 'status']);
  });
});
