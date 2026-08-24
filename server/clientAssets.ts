import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX = 'index.html';

// Vite's asset filenames carry a content hash, so they can be cached forever.
// The entry document must not be, or a new build would never be picked up.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

export interface ClientAssets {
  // Every file in the built client, keyed by the URL path that serves it.
  files: ReadonlyMap<string, Blob>;
  describe(): string;
}

// Reads the client out of the executable itself. `--asset` preserves the path it
// was given, so the prefix is discovered from wherever index.html landed rather
// than hardcoded to match a build flag.
function embeddedAssets(): ClientAssets | null {
  // Every entry carries the path `--asset` was given, which is the whole point
  // of reading them this way, but @types/bun declares the array as plain Blob.
  // Bun's own documentation for this API uses `.name`, so the type is behind the
  // runtime rather than the property being unsupported.
  const embedded = Bun.embeddedFiles as readonly (Blob & { name?: string })[];
  if (embedded.length === 0) return null;

  const index = embedded.find((file) => file.name?.endsWith(`/${INDEX}`));
  if (index?.name == null) return null;
  const prefix = index.name.slice(0, -INDEX.length);

  const files = new Map<string, Blob>();
  for (const file of embedded) {
    if (file.name == null || !file.name.startsWith(prefix)) continue;
    files.set(`/${file.name.slice(prefix.length)}`, file);
  }

  return {
    files,
    describe: () => `${files.size} files embedded in the executable`,
  };
}

// Reads the client from dist/client, for running the server straight from a
// checkout rather than from a compiled binary. Bun.file is lazy, so this walks
// the tree without reading any of it.
function diskAssets(): ClientAssets {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = [
    join(here, '..', 'client'),
    join(here, '..', 'dist', 'client'),
    join(here, '..', '..', 'dist', 'client'),
  ].find((candidate) => existsSync(join(candidate, INDEX)));

  if (root == null) {
    throw new Error(
      'Could not find the built client. Run `bun run build:client` first.'
    );
  }

  const resolved = resolve(root);
  const files = new Map<string, Blob>();
  for (const path of new Bun.Glob('**/*').scanSync({
    cwd: resolved,
    absolute: true,
    onlyFiles: true,
  })) {
    files.set(`/${relative(resolved, path)}`, Bun.file(path));
  }

  return { files, describe: () => resolved };
}

export function loadClientAssets(): ClientAssets {
  return embeddedAssets() ?? diskAssets();
}

// The entry document on its own, for the one route that has to enter JavaScript
// -- a document request is the only kind that can be redirected to the
// canonical origin, and a static Response cannot look at a Host header.
export function indexDocument(assets: ClientAssets): () => Response {
  const index = assets.files.get(`/${INDEX}`);
  if (index == null) {
    throw new Error(`The built client has no ${INDEX}.`);
  }
  return () =>
    new Response(index, {
      headers: { 'Cache-Control': NO_CACHE, 'Content-Type': 'text/html' },
    });
}

// The client as a Bun.serve route table. A Response value in `routes` is served
// straight from the server without entering JavaScript, which is the point of
// building the whole client as routes rather than answering each request from a
// handler. Enumerating the files also means no request path is ever joined onto
// a filesystem path, so there is nothing to traverse out of.
export function clientRoutes(
  assets: ClientAssets
): Record<string, Response> & { '/*': Response } {
  const routes: Record<string, Response> = {};
  for (const [path, file] of assets.files) {
    routes[path] = new Response(file, {
      headers: {
        'Cache-Control': path.startsWith('/assets/') ? IMMUTABLE : NO_CACHE,
      },
    });
  }

  const index = assets.files.get(`/${INDEX}`);
  if (index == null) {
    throw new Error(`The built client has no ${INDEX}.`);
  }

  return {
    ...routes,
    // A hashed asset that is not here is genuinely gone, usually a stale script
    // reference after a rebuild. Letting it fall through to the entry document
    // would answer a script request with HTML and a 200, which surfaces as a
    // syntax error in the console rather than a missing file.
    '/assets/*': new Response('Not found', { status: 404 }),
    // Anything else renders the app: the client owns routing.
    '/*': new Response(index, {
      headers: { 'Cache-Control': NO_CACHE, 'Content-Type': 'text/html' },
    }),
  };
}
