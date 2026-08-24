import { createApiApp } from './app';
import { clientRoutes, indexDocument, loadClientAssets } from './clientAssets';
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
  const document = indexDocument(assets);
  // Read back rather than passed in: an activated server asks for port 0 and
  // only learns which one it got once it is listening.
  let bound = port;
  const app = createApiApp({ port: () => bound });

  const server = Bun.serve({
    hostname: HOST,
    port,
    routes: {
      // The whole client, one static route per file, so serving it never enters
      // JavaScript. The API is a route too, because the '/*' fallback would
      // otherwise answer /api/... with the app's HTML.
      ...clientRoutes(assets),
      // The entry document renders the app. There is no canonical redirect any
      // more: the service manager holds the one URL, and the only server ever
      // reachable on a port is a --foreground one -- sending that to the bare
      // host would hand you a different process than the one you started.
      '/*': () => document(),
      '/api/*': (request: Request) =>
        rejectUntrustedRequest(request) ?? app.fetch(request),
    },
    // A local diff of a large repository can take a while to stream, and the
    // watch endpoint holds its connection open for as long as the tab is there.
    idleTimeout: 0,
  });

  bound = server.port ?? port;

  return {
    port: bound,
    clientSource: assets.describe(),
    stop: () => void server.stop(true),
  };
}
