const ALLOWED_METHODS = 'POST, OPTIONS';
const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';

function originHeaders(origin: string | null): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Expose-Headers': 'Retry-After',
  });
  if (origin !== null) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return headers;
}

function json(
  headers: Headers,
  body: Record<string, unknown>,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  if (extraHeaders) new Headers(extraHeaders).forEach((value, key) => responseHeaders.set(key, value));
  responseHeaders.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export interface EdgeHttpContext {
  headers: Headers;
  response?: Response;
  json: (body: Record<string, unknown>, status?: number, extraHeaders?: HeadersInit) => Response;
}

export class EdgeRequestError extends Error {
  readonly status: number;
  constructor(status: number) { super('Invalid request'); this.status = status; }
}

/** Reads JSON with a streaming byte cap so Content-Length cannot be bypassed. */
export async function readBoundedJson(request: Request, maxBytes = 4_096): Promise<unknown> {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') throw new EdgeRequestError(415);
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new EdgeRequestError(413);
  if (!request.body) throw new EdgeRequestError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) throw new EdgeRequestError(413);
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new EdgeRequestError(400); }
}

/** Applies one origin/method policy to Edge functions while allowing native no-Origin calls. */
export function prepareEdgeHttpRequest(request: Request, allowedOrigins: string): EdgeHttpContext {
  const origin = request.headers.get('Origin');
  const allowed = new Set(allowedOrigins.split(',').map((value) => value.trim()).filter(Boolean));
  if (origin !== null && !allowed.has(origin)) {
    const headers = originHeaders(null);
    headers.set('Vary', 'Origin');
    return { headers, response: json(headers, { error: 'Origin not allowed' }, 403), json: (body, status, extraHeaders) => json(headers, body, status, extraHeaders) };
  }

  const headers = originHeaders(origin);
  const makeJson = (body: Record<string, unknown>, status = 200, extraHeaders?: HeadersInit) => json(headers, body, status, extraHeaders);
  if (request.method === 'OPTIONS') {
    return { headers, response: new Response(null, { status: 204, headers }), json: makeJson };
  }
  if (request.method !== 'POST') {
    return { headers, response: makeJson({ error: 'Method not allowed' }, 405), json: makeJson };
  }
  return { headers, json: makeJson };
}
