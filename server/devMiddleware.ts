import { getRequestListener } from '@hono/node-server';
import type { Plugin } from 'vite';

import { createApiApp } from './app';

// Mounts the API inside Vite's dev server.
//
// The alternative was a second process on a second port with a proxy in front,
// which meant two terminals, a hand-set environment variable, and a server that
// crashed unless the client had already been built. One command is worth the
// twelve lines.
//
// getRequestListener comes from @hono/node-server, so dev and production go
// through the same node-to-Web request translation rather than two versions of
// it that can drift.
export function apiDevServer(): Plugin {
  return {
    name: 'hunkyard-api',
    configureServer(server) {
      const listener = getRequestListener(createApiApp().fetch);
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/') !== true) {
          next();
          return;
        }
        void listener(req, res);
      });
    },
  };
}
