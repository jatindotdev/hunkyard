import { Hono } from 'hono';

import {
  listRepos,
  readControlToken,
  registerRepo,
} from '../../lib/repos/registry';

// Registering a repository tells the daemon to read a directory, so it is gated
// on a secret only local processes can read. The browser client never registers
// anything: it addresses repositories a `hunk` invocation already added.
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
    const repos = await listRepos();
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
