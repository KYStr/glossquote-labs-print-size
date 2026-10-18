import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, ASSETS, HEADERS, verifyBuild, checkSource } from './lib.mjs';

const MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8' });

export async function createPreviewServer({ source = false } = {}) {
  if (source) await checkSource();
  else await verifyBuild();
  // Read once at startup. Every served byte belongs to the verified build.
  const contents = new Map(await Promise.all(ASSETS.map(async path => [path, await readFile(join(ROOT, source ? 'public' : 'dist', path))])));
  return createServer((request, response) => {
    let status = 200;
    const route = request.url === '/' ? '/index.html' : request.url;
    let path = typeof route === 'string' && ASSETS.includes(route.slice(1)) ? route.slice(1) : '404.html';
    if (path === '404.html') status = 404;
    if (!['GET', 'HEAD'].includes(request.method)) {
      request.resume();
      response.writeHead(405, { ...HEADERS, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Method not allowed.');
      return;
    }
    const extension = path.slice(path.lastIndexOf('.'));
    const body = contents.get(path);
    response.writeHead(status, { ...HEADERS, 'Content-Type': MIME[extension], 'Content-Length': body.byteLength });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createPreviewServer();
  server.once('error', error => {
    process.stderr.write(error.code === 'EADDRINUSE' ? 'Port 4211 is in use. Existing services were preserved.\n' : 'Preview failed to start.\n');
    process.exitCode = 1;
  });
  server.listen(4211, '127.0.0.1', () => process.stdout.write('M1 preview: http://127.0.0.1:4211/index.html (loopback only)\n'));
}
