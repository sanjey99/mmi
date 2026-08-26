import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EdgeRequestError, prepareEdgeHttpRequest, readBoundedJson } from '../supabase/functions/_shared/http';

describe('prepareEdgeHttpRequest', () => {
  it('rejects streaming JSON over the limit even without Content-Length', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode('x'.repeat(64)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const request = new Request('https://functions.example.test/attempt', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      duplex: 'half' as never,
    } as RequestInit & { duplex: string });
    await expect(readBoundedJson(request, 32)).rejects.toMatchObject({ status: 413 } as EdgeRequestError);
  });

  it('parses bounded JSON and rejects invalid JSON with a safe status', async () => {
    await expect(readBoundedJson(new Request('https://functions.example.test/attempt', {
      method: 'POST', body: '{"attemptId":"abc"}', headers: { 'Content-Type': 'application/json' },
    }), 64)).resolves.toEqual({ attemptId: 'abc' });
    await expect(readBoundedJson(new Request('https://functions.example.test/attempt', {
      method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' },
    }), 64)).rejects.toMatchObject({ status: 400 } as EdgeRequestError);
  });

  it('rejects missing and non-JSON content types before parsing the body', async () => {
    await expect(readBoundedJson(new Request('https://functions.example.test/attempt', {
      method: 'POST', body: '{"attemptId":"abc"}',
    }), 64)).rejects.toMatchObject({ status: 415 } as EdgeRequestError);
    await expect(readBoundedJson(new Request('https://functions.example.test/attempt', {
      method: 'POST', body: '{"attemptId":"abc"}', headers: { 'Content-Type': 'text/plain' },
    }), 64)).rejects.toMatchObject({ status: 415 } as EdgeRequestError);
  });
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

  it('preserves a documented Retry-After value on a rate-limit response', () => {
    const context = prepareEdgeHttpRequest(
      new Request('https://functions.example.test/score-answer', { method: 'POST' }),
      '',
    );
    const response = context.json(
      { error: 'Rate limit exceeded' },
      429,
      { 'Retry-After': '3600' },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3600');
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
  });

  it('uses the shared Retry-After response path for score-answer rate limits', async () => {
    const source = await readFile(join(process.cwd(), 'supabase/functions/score-answer/index.ts'), 'utf8');

    expect(source).toContain("{ 'Retry-After': '3600' }");
  });
});
