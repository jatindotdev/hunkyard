import { homedir } from 'node:os';

import { Hono } from 'hono';

import { REPO_ROOT_ENV, resolveFallbackRepo } from '../../lib/git/repo';
import { forgetRepos, registerRepo, tidyRepos } from '../../lib/repos/registry';
import { isOurWrite } from '../guard';

// Registering used to need a token from the state directory, on the reasoning
// that it told the daemon to read a directory. It no longer grants anything:
// `?repo=<path>` already names any repository on the machine, so registering
// only writes the recents list. What keeps a foreign page out of that list is
// isOurWrite -- an Origin that is present and ours -- which is also what keeps
// `curl -X POST` out of it.
export function createReposApp(): Hono {
  const app = new Hono();

  // Which repositories you have opened, and which one to fall back to. Tidied
  // rather than merely listed: a temp directory from a test run is gone, and an
  // entry for it is a row in the UI that cannot be opened.
  app.get('/api/repos', async (c) => {
    const registered = await tidyRepos();
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
        // lastUsedAt is what orders the list, so the client needs it too.
        repos: repos.map((repo) => ({
          id: repo.id,
          root: repo.root,
          lastUsedAt: repo.lastUsedAt,
        })),
        defaultId: repos[0]?.id ?? null,
        // Where the filesystem browser should start, and the prefix the recents
        // list shortens away. Knowing it here saves the opener a request just to
        // find out where home is.
        home: homedir(),
      },
      { headers: new Headers({ 'Cache-Control': 'no-store' }) }
    );
  });

  app.post('/api/repos', async (c) => {
    if (!isOurWrite(c.req.raw)) {
      return c.text('Registering a repository needs a request from the app.', 403);
    }

    const body = (await c.req.json().catch(() => null)) as {
      path?: string;
    } | null;
    if (body?.path == null || body.path.trim() === '') {
      return c.text('A path is required.', 400);
    }

    try {
      const repo = await registerRepo(body.path);
      return c.json({ id: repo.id, root: repo.root, lastUsedAt: repo.lastUsedAt });
    } catch (error) {
      return c.text(error instanceof Error ? error.message : 'Failed.', 400);
    }
  });

  // Forgetting is a write to the same list, and the repository itself is
  // untouched.
  app.delete('/api/repos/:id', async (c) => {
    if (!isOurWrite(c.req.raw)) {
      return c.text('Forgetting a repository needs a request from the app.', 403);
    }
    const removed = await forgetRepos(c.req.param('id'));
    return c.json({ removed });
  });

  return app;
}
