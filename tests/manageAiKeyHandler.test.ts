import { describe, expect, it, vi } from 'vitest';
import {
  createManageAiKeyHandler,
  type ManageAiKeyRepository,
} from '../supabase/functions/manage-ai-key/handler.ts';

const allowedOrigin = 'https://preview.example.test';

function repository(overrides: Partial<ManageAiKeyRepository> = {}): ManageAiKeyRepository {
  return {
    authenticate: vi.fn(async () => ({ userId: 'admin-1' })),
    getAdminStatus: vi.fn(async () => ({ isAdmin: true })),
    getKeyConfigured: vi.fn(async () => ({ configured: true })),
    replaceKey: vi.fn(async () => ({})),
    ...overrides,
  };
}

function request(
  body: string | undefined = JSON.stringify({ action: 'status' }),
  init: { method?: string; origin?: string | null; contentType?: string; authorization?: string } = {},
): Request {
  const headers = new Headers();
  if (init.origin !== null) headers.set('Origin', init.origin ?? allowedOrigin);
  if (init.contentType !== '') headers.set('Content-Type', init.contentType ?? 'application/json');
  if (init.authorization !== '') headers.set('Authorization', init.authorization ?? 'Bearer valid-token');
  return new Request('http://localhost/functions/v1/manage-ai-key', {
    method: init.method ?? 'POST',
    headers,
    body: init.method === 'GET' || init.method === 'OPTIONS' ? undefined : body,
  });
}

describe('manage-ai-key handler', () => {
  it('accepts an exact configured origin and never returns the stored key', async () => {
    const repo = repository();
    const response = await createManageAiKeyHandler(repo, allowedOrigin)(request());
    const responseBody = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowedOrigin);
    expect(JSON.parse(responseBody)).toEqual({ configured: true });
    expect(responseBody).not.toContain('secret');
  });

  it('rejects an unlisted origin before authentication', async () => {
    const repo = repository();
    const response = await createManageAiKeyHandler(repo, allowedOrigin)(
      request(undefined, { origin: 'https://attacker.example' }),
    );

    expect(response.status).toBe(403);
    expect(repo.authenticate).not.toHaveBeenCalled();
  });

  it('allows native requests without an Origin header', async () => {
    const response = await createManageAiKeyHandler(repository(), allowedOrigin)(
      request(undefined, { origin: null }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it.each([
    ['OPTIONS', 204],
    ['GET', 405],
  ])('handles %s before authentication', async (method, status) => {
    const repo = repository();
    const response = await createManageAiKeyHandler(repo, allowedOrigin)(request(undefined, { method }));

    expect(response.status).toBe(status);
    expect(repo.authenticate).not.toHaveBeenCalled();
  });

  it('rejects missing and invalid bearer credentials', async () => {
    const missingRepo = repository();
    const missing = await createManageAiKeyHandler(missingRepo, allowedOrigin)(
      request(undefined, { authorization: '' }),
    );
    expect(missing.status).toBe(401);
    expect(missingRepo.authenticate).not.toHaveBeenCalled();

    const invalidRepo = repository({ authenticate: vi.fn(async () => ({ error: true })) });
    const invalid = await createManageAiKeyHandler(invalidRepo, allowedOrigin)(request());
    expect(invalid.status).toBe(401);
  });

  it('checks live admin status before reading or writing the body', async () => {
    const repo = repository({ getAdminStatus: vi.fn(async () => ({ isAdmin: false })) });
    const response = await createManageAiKeyHandler(repo, allowedOrigin)(
      request('not-json', { contentType: 'text/plain' }),
    );

    expect(response.status).toBe(403);
    expect(repo.replaceKey).not.toHaveBeenCalled();
  });

  it('returns a secret-safe error when admin verification fails', async () => {
    const repo = repository({ getAdminStatus: vi.fn(async () => ({ error: true })) });
    const response = await createManageAiKeyHandler(repo, allowedOrigin)(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unable to verify administrator access' });
  });

  it.each([
    [undefined, { contentType: '' }, 415],
    ['{}', { contentType: 'text/plain' }, 415],
    ['{', {}, 400],
    [JSON.stringify({ apiKey: 'x'.repeat(2_100) }), {}, 413],
  ] as const)('rejects invalid request bodies', async (body, init, status) => {
    const response = await createManageAiKeyHandler(repository(), allowedOrigin)(request(body, init));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Invalid request' });
  });

  it('accepts JSON with a charset and saves only the trimmed key', async () => {
    const repo = repository();
    const submitted = '  private-provider-key  ';
    const response = await createManageAiKeyHandler(repo, allowedOrigin)(
      request(JSON.stringify({ apiKey: submitted }), { contentType: 'application/json; charset=utf-8' }),
    );

    expect(response.status).toBe(200);
    expect(repo.replaceKey).toHaveBeenCalledWith('private-provider-key');
    expect(JSON.stringify(await response.json())).not.toContain(submitted.trim());
  });

  it('does not write invalid replacement input', async () => {
    const repo = repository();
    const response = await createManageAiKeyHandler(repo, allowedOrigin)(request('{}'));

    expect(response.status).toBe(400);
    expect(repo.replaceKey).not.toHaveBeenCalled();
  });

  it('returns safe errors for status and write failures', async () => {
    const submittedValue = ['never', 'return', 'this'].join('-');
    const statusResponse = await createManageAiKeyHandler(
      repository({ getKeyConfigured: vi.fn(async () => ({ error: true })) }),
      allowedOrigin,
    )(request());
    expect(statusResponse.status).toBe(500);
    expect(await statusResponse.json()).toEqual({ error: 'Unable to load AI key status' });

    const writeResponse = await createManageAiKeyHandler(
      repository({ replaceKey: vi.fn(async () => ({ error: true })) }),
      allowedOrigin,
    )(request(JSON.stringify({ apiKey: submittedValue })));
    expect(writeResponse.status).toBe(500);
    expect(JSON.stringify(await writeResponse.json())).not.toContain(submittedValue);
  });
});
