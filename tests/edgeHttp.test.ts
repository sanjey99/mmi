import { describe, expect, it } from 'vitest';
import { prepareEdgeHttpRequest } from '../supabase/functions/_shared/http';

describe('prepareEdgeHttpRequest', () => {
  it('reflects an exactly allowlisted browser origin and applies shared headers to JSON responses', () => {
    const context = prepareEdgeHttpRequest(
      new Request('https://functions.example.test/score-answer', {
        method: 'POST',
        headers: { Origin: 'https://app.example.test' },
      }),
      'https://app.example.test, https://admin.example.test',
    );
    const response = context.json({ ok: true });

    expect(context.response).toBeUndefined();
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('authorization, x-client-info, apikey, content-type');
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('rejects a browser request whose origin is not exactly allowlisted before endpoint logic', async () => {
    const context = prepareEdgeHttpRequest(
      new Request('https://functions.example.test/score-answer', {
        method: 'POST',
        headers: { Origin: 'https://evil.example.test' },
      }),
      'https://app.example.test',
    );

    expect(context.response?.status).toBe(403);
    expect(context.response?.headers.get('Vary')).toBe('Origin');
    await expect(context.response?.json()).resolves.toEqual({ error: 'Origin not allowed' });
  });

  it('allows native requests without an Origin header and handles OPTIONS without business logic', () => {
    const native = prepareEdgeHttpRequest(
      new Request('https://functions.example.test/score-answer', { method: 'POST' }),
      'https://app.example.test',
    );
    const preflight = prepareEdgeHttpRequest(
      new Request('https://functions.example.test/score-answer', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.test' },
      }),
      'https://app.example.test',
    );

    expect(native.response).toBeUndefined();
    expect(native.headers.get('Vary')).toBeNull();
    expect(preflight.response?.status).toBe(204);
    expect(preflight.response?.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test');
  });

  it('produces a method error with the same shared headers', () => {
    const context = prepareEdgeHttpRequest(
      new Request('https://functions.example.test/score-answer', {
        method: 'GET',
        headers: { Origin: 'https://app.example.test' },
      }),
      'https://app.example.test',
    );

    expect(context.response?.status).toBe(405);
    expect(context.response?.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test');
    expect(context.response?.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
  });
});
