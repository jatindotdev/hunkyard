import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApiApp } from './app';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4865;

// The built client sits next to the built server, so this resolves the same way
// whether it runs from a checkout or from an installed package.
function resolveClientRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, '..', 'client'),
    join(here, '..', '..', 'dist', 'client'),
  ]) {
    if (existsSync(join(candidate, 'index.html'))) return resolve(candidate);
  }
  throw new Error(
    'Could not find the built client. Run `pnpm build` before starting the server.'
  );
}

export function startServer(options: { port?: number } = {}): {
  port: number;
  close(): void;
} {
  const port = options.port ?? Number(process.env.PORT ?? DEFAULT_PORT);
  const clientRoot = resolveClientRoot();
  const app = createApiApp();

  // Static assets, then a single-page fallback: the client owns routing, so any
  // path that is not an API call or a real file renders the app.
  app.use('/*', serveStatic({ root: clientRoot }));
  app.get('/*', serveStatic({ path: 'index.html', root: clientRoot }));

  const server = serve({ fetch: app.fetch, hostname: HOST, port });
  return { port, close: () => server.close() };
}

// Started directly rather than imported: the CLI spawns this file.
if (process.argv[1] != null && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=\/)/, ''))) {
  const { port } = startServer();
  process.stdout.write(`listening on http://${HOST}:${port}\n`);
}
