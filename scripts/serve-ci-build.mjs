import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// This server is a local test helper. It never proxies requests to a backend.
if (process.env.EXPO_PUBLIC_SUPABASE_URL !== 'https://e2e.supabase.co'
  || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'synthetic-publishable-key'
  || process.env.EXPO_PUBLIC_AI_MODEL_PROFILE !== 'default') {
  throw new Error('The CI preview requires synthetic Supabase configuration.');
}

const directory = await realpath(fileURLToPath(new URL('../dist/', import.meta.url)));
await stat(resolve(directory, 'index.html'));
const origin = 'http://127.0.0.1:4173';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  try {
    const url = new URL(request.url ?? '/', origin);
    const pathname = decodeURIComponent(url.pathname);
    if (url.origin !== origin || pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.'))) {
      response.writeHead(400);
      response.end();
      return;
    }
    let file = resolve(directory, `.${pathname}`);
    if (file !== directory && !file.startsWith(`${directory}${sep}`)) throw new Error('invalid path');
    let details;
    try { details = await stat(file); } catch {
      if (extname(pathname)) throw new Error('missing asset');
      file = resolve(directory, 'index.html');
      details = await stat(file);
    }
    if (details.isDirectory()) file = resolve(directory, 'index.html');
    file = await realpath(file);
    if (!file.startsWith(`${directory}${sep}`)) throw new Error('invalid path');
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

server.listen(4173, '127.0.0.1', () => {
  console.log(`Synthetic static preview ready on ${origin}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(() => process.exit(0)); });
}
