import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';


// Mounts the API inside Vite's dev server.
//
// The app is loaded with ssrLoadModule rather than imported here, for two
// reasons. Vite's config loader cannot follow extensionless relative imports,
// and importing the server would drag the whole route tree into config
// resolution. Going through Vite's own pipeline also means editing a route
// takes effect on the next request instead of needing a restart.
function apiDevServer(): Plugin {
  return {
    name: 'hunkyard-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/') !== true) {
          next();
          return;
        }
        void (async () => {
          try {
            const [{ createApiApp }, { getRequestListener }] = await Promise.all(
              [
                server.ssrLoadModule('/server/app.ts') as Promise<
                  typeof import('./server/app.ts')
                >,
                // Vite's dev middleware is node-shaped (req, res), so the
                // bridge to a Web Request is too. Production is Bun.serve and
                // needs none of this, which is why it is a dev dependency.
                import('@hono/node-server'),
              ]
            );
            getRequestListener(createApiApp().fetch)(req, res);
          } catch (error) {
            server.config.logger.error(String(error));
            res.statusCode = 500;
            res.end(error instanceof Error ? error.message : 'API error');
          }
        })();
      });
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  // The server bundle needs no static assets: the client build already copied
  // public/ next to index.html, and that is the directory the server serves
  // from. Left on, the SSR build copies the fonts a second time.
  publicDir: isSsrBuild ? false : undefined,
  plugins: [
    // Note: Next ran this app through the React Compiler. @vitejs/plugin-react
    // v6 uses oxc rather than babel and has no hook for it, so auto-memoisation
    // is gone. The hot paths memoise explicitly (useMemo for CodeViewOptions,
    // useStableCallback for the render callbacks), so this should be a wash --
    // verified against a 27-file diff rather than assumed.
    react(),
    tailwindcss(),
    apiDevServer(),
  ],
  define: {
    // Some dependency in the highlighter/theming chain reaches for Node's
    // `global`. Next polyfilled it silently; Vite does not, and the result is a
    // blank page with `ReferenceError: global is not defined`.
    global: 'globalThis',
  },
  resolve: {
    alias: { '@': resolve(import.meta.dirname, '.') },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    // The Shiki grammars are large and chunk-split naturally; the default
    // warning is noise here rather than a signal.
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 4865,
    host: '127.0.0.1',
    // Everything local is served from this hostname so the origin is stable.
    allowedHosts: ['hunkyard.localhost'],
  },
}));
