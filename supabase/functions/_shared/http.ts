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

function json(headers: Headers, body: Record<string, unknown>, status = 200): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export interface EdgeHttpContext {
  headers: Headers;
  response?: Response;
  json: (body: Record<string, unknown>, status?: number) => Response;
}

/** Applies one origin/method policy to Edge functions while allowing native no-Origin calls. */
export function prepareEdgeHttpRequest(request: Request, allowedOrigins: string): EdgeHttpContext {
  const origin = request.headers.get('Origin');
  const allowed = new Set(allowedOrigins.split(',').map((value) => value.trim()).filter(Boolean));
  if (origin !== null && !allowed.has(origin)) {
    const headers = originHeaders(null);
    headers.set('Vary', 'Origin');
    return { headers, response: json(headers, { error: 'Origin not allowed' }, 403), json: (body, status) => json(headers, body, status) };
  }

  const headers = originHeaders(origin);
  const makeJson = (body: Record<string, unknown>, status = 200) => json(headers, body, status);
  if (request.method === 'OPTIONS') {
    return { headers, response: new Response(null, { status: 204, headers }), json: makeJson };
  }
  if (request.method !== 'POST') {
    return { headers, response: makeJson({ error: 'Method not allowed' }, 405), json: makeJson };
  }
  return { headers, json: makeJson };
}
