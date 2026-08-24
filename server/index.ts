import { createApiApp } from './app';
import { clientRoutes, indexDocument, loadClientAssets } from './clientAssets';
import { rejectUntrustedRequest } from './guard';
import {
  canonicalRedirect,
  ensureBareUrlProbe,
} from '../lib/proxy/canonical';

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
      // The entry document is the one route that enters JavaScript, so that a
      // page opened on the port can be moved to the canonical bare host. Never
      // /api/*: the CLI's own health check and any curl would be redirected
      // with it.
      '/*': (request: Request) => canonicalRedirect(request, port) ?? document(),
      '/api/*': (request: Request) =>
        rejectUntrustedRequest(request) ?? app.fetch(request),
    },
    // A local diff of a large repository can take a while to stream, and the
    // watch endpoint holds its connection open for as long as the tab is there.
    idleTimeout: 0,
  });

  // Asked once here so the first page load already knows the answer. It is
  // deliberately not awaited: the socket is listening, and the forwarder
  // answering or not must never delay startup.
  void ensureBareUrlProbe(port);

  bound = server.port ?? port;

  return {
    port: bound,
    clientSource: assets.describe(),
    stop: () => void server.stop(true),
  };
}
