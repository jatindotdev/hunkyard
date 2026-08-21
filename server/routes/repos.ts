import { Hono } from 'hono';

import { resolveFallbackRepo } from '../../lib/git/repo';
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
    // With nothing registered, report the directory the server was started in,
    // which is what the diff routes fall back to. `bun dev` has no CLI
    // invocation to have registered anything.
    const repos =
      registered.length > 0
        ? registered
        : [await resolveFallbackRepo()].filter((repo) => repo != null);

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
