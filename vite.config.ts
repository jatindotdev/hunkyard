import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // Note: Next ran this app through the React Compiler. @vitejs/plugin-react
    // v6 uses oxc rather than babel and has no hook for it, so auto-memoisation
    // is gone. The hot paths memoise explicitly (useMemo for CodeViewOptions,
    // useStableCallback for the render callbacks), so this should be a wash --
    // verified against a 27-file diff rather than assumed.
    react(),
    tailwindcss(),
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
    proxy: {
      '/api': { target: 'http://127.0.0.1:4866', changeOrigin: false },
    },
  },
});
