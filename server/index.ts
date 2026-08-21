import { createApiApp } from './app';
import { clientRoutes, loadClientAssets } from './clientAssets';
import { rejectUntrustedRequest } from './guard';

export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 4865;

export interface RunningServer {
  port: number;
  clientSource: string;
  stop(): void;
}

export function startServer(options: { port?: number } = {}): RunningServer {
  const port = options.port ?? Number(process.env.PORT ?? DEFAULT_PORT);
  const assets = loadClientAssets();
  const app = createApiApp();

  const server = Bun.serve({
    hostname: HOST,
    port,
    routes: {
      // The whole client, one static route per file, so serving it never enters
      // JavaScript. The API is a route too, because the '/*' fallback would
      // otherwise answer /api/... with the app's HTML.
      ...clientRoutes(assets),
      '/api/*': (request: Request) =>
        rejectUntrustedRequest(request) ?? app.fetch(request),
    },
    // A local diff of a large repository can take a while to stream, and the
    // watch endpoint holds its connection open for as long as the tab is there.
    idleTimeout: 0,
  });

  return {
    port: server.port ?? port,
    clientSource: assets.describe(),
    stop: () => void server.stop(true),
  };
}
