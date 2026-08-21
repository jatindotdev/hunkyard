import { Hono } from 'hono';

import { REPO_ROOT_ENV, resolveFallbackRepo } from '../../lib/git/repo';
import {
  listRepos,
  readControlToken,
  registerRepo,
} from '../../lib/repos/registry';

// Registering is no longer a privilege boundary: a request can name any
// repository by path. It still writes the recents list that gives `hunk status`
// and the default repository their contents, so it stays behind a token only
// local processes can read, to keep a web page from filling that list with
// noise. The browser client never registers anything.
async function isControlRequest(request: Request): Promise<boolean> {
  const token = await readControlToken();
  if (token == null) return false;
  const offered = request.headers.get('x-hunkyard-token');
  return offered != null && offered === token;
}

export function createReposApp(): Hono {
  const app = new Hono();

  // Which repositories the client may address, and which one to fall back to.
  // Readable without the token: it is the list the UI needs to render, and it
  // says nothing a page could not learn by asking for each id in turn.
  app.get('/api/repos', async (c) => {
    const registered = await listRepos();
    const fallback = await resolveFallbackRepo();
    // The environment variable is configuration and outranks the recents list,
    // matching how the diff routes resolve a request that names nothing. Under
    // `bun dev` it is unset, so this is the directory the server started in and
    // there is usually nothing registered anyway.
    const configuredFirst =
      process.env[REPO_ROOT_ENV] != null &&
      process.env[REPO_ROOT_ENV]?.trim() !== '' &&
      fallback != null;

    const repos = configuredFirst
      ? [fallback, ...registered.filter((repo) => repo.id !== fallback?.id)]
      : registered.length > 0
        ? registered
        : [fallback].filter((repo) => repo != null);

    return c.json(
      {
        repos: repos.map((repo) => ({ id: repo.id, root: repo.root })),
        defaultId: repos[0]?.id ?? null,
      },
      { headers: new Headers({ 'Cache-Control': 'no-store' }) }
    );
  });

  app.post('/api/repos', async (c) => {
    if (!(await isControlRequest(c.req.raw))) {
      return c.text('Registering a repository needs the local control token.', 403);
    }

    const body = (await c.req.json().catch(() => null)) as {
      path?: string;
    } | null;
    if (body?.path == null || body.path.trim() === '') {
      return c.text('A path is required.', 400);
    }

    try {
      const repo = await registerRepo(body.path);
      return c.json({ id: repo.id, root: repo.root });
    } catch (error) {
      return c.text(error instanceof Error ? error.message : 'Failed.', 400);
    }
  });

  return app;
}
