import { authorizeKeyReplacement } from '../_shared/aiConfig.ts';
import {
  EdgeRequestError,
  prepareEdgeHttpRequest,
  readBoundedJson,
} from '../_shared/http.ts';

type RepositoryResult<T extends Record<string, unknown>> = T & { error?: unknown };

export interface ManageAiKeyRepository {
  authenticate: (authHeader: string) => Promise<RepositoryResult<{ userId?: string }>>;
  getAdminStatus: (userId: string) => Promise<RepositoryResult<{ isAdmin?: boolean }>>;
  getKeyConfigured: () => Promise<RepositoryResult<{ configured?: boolean }>>;
  replaceKey: (apiKey: string) => Promise<{ error?: unknown }>;
}

export function createManageAiKeyHandler(
  repository: ManageAiKeyRepository,
  allowedOrigins: string,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const http = prepareEdgeHttpRequest(request, allowedOrigins);
    if (http.response) return http.response;

    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return http.json({ error: 'Unauthorized' }, 401);

    const authentication = await repository.authenticate(authHeader);
    if (authentication.error || !authentication.userId) {
      return http.json({ error: 'Unauthorized' }, 401);
    }

    const adminStatus = await repository.getAdminStatus(authentication.userId);
    if (adminStatus.error) {
      return http.json({ error: 'Unable to verify administrator access' }, 500);
    }
    if (!adminStatus.isAdmin) {
      return http.json({ error: 'Administrator access is required' }, 403);
    }

    let body: unknown;
    try {
      body = await readBoundedJson(request, 2_048);
    } catch (error) {
      const status = error instanceof EdgeRequestError ? error.status : 400;
      return http.json({ error: 'Invalid request' }, status);
    }

    const action = body && typeof body === 'object' && 'action' in body
      ? (body as { action?: unknown }).action
      : undefined;
    if (action === 'status') {
      const result = await repository.getKeyConfigured();
      if (result.error) return http.json({ error: 'Unable to load AI key status' }, 500);
      return http.json({ configured: Boolean(result.configured) });
    }

    const authorization = authorizeKeyReplacement(body, true);
    if (!authorization.allowed) {
      return http.json({ error: authorization.error }, authorization.status);
    }

    const apiKey = (body as { apiKey: string }).apiKey.trim();
    const result = await repository.replaceKey(apiKey);
    if (result.error) return http.json({ error: 'Unable to save the AI key' }, 500);

    return http.json({ configured: true });
  };
}
