import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../../lib/git/exec';
import { listRepos, registerRepo } from '../../lib/repos/registry';
import { createReposApp } from '../routes/repos';

let base: string;
let repoRoot: string;
let previousStateHome: string | undefined;
let previousRepoRootEnv: string | undefined;
const app = createReposApp();

async function call(
  path: string,
  init: RequestInit & { origin?: string | null } = {}
): Promise<Response> {
  const { origin = 'http://hunkyard.localhost', ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('host', 'hunkyard.localhost');
  if (origin != null) headers.set('origin', origin);
  return await app.fetch(
    new Request(`http://hunkyard.localhost${path}`, { ...rest, headers })
  );
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'hunk-repos-'));
  previousStateHome = process.env.XDG_STATE_HOME;
  previousRepoRootEnv = process.env.HUNKYARD_REPO_ROOT;
  process.env.XDG_STATE_HOME = join(base, 'state');
  // Otherwise the fallback repository is whichever directory the test runner
  // started in, and it lands in every listing.
  process.env.HUNKYARD_REPO_ROOT = '';
  repoRoot = join(base, 'repo');
  await mkdir(repoRoot, { recursive: true });
  await runGit(['init'], { cwd: repoRoot });
});

afterAll(async () => {
  if (previousStateHome == null) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousStateHome;
  if (previousRepoRootEnv == null) delete process.env.HUNKYARD_REPO_ROOT;
  else process.env.HUNKYARD_REPO_ROOT = previousRepoRootEnv;
  await rm(base, { recursive: true, force: true });
});

describe('POST /api/repos', () => {
  test('registers a repository for a request from our own page', async () => {
    const response = await call('/api/repos', {
      method: 'POST',
      body: JSON.stringify({ path: repoRoot }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; root: string };
    expect(body.id).toStartWith('repo-');
    expect((await listRepos()).map((repo) => repo.id)).toContain(body.id);
  });

  test('refuses a foreign Origin', async () => {
    const response = await call('/api/repos', {
      method: 'POST',
      origin: 'https://evil.example.com',
      body: JSON.stringify({ path: repoRoot }),
    });
    expect(response.status).toBe(403);
  });

  // The token this replaced was unguessable; an absent Origin is what `curl`
  // sends, so it cannot be treated as trusted.
  test('refuses a request with no Origin', async () => {
    const response = await call('/api/repos', {
      method: 'POST',
      origin: null,
      body: JSON.stringify({ path: repoRoot }),
    });
    expect(response.status).toBe(403);
  });

  test('refuses a path that is not a repository', async () => {
    const response = await call('/api/repos', {
      method: 'POST',
      body: JSON.stringify({ path: base }),
    });
    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/repos/:id', () => {
  test('removes one from the list', async () => {
    const repo = await registerRepo(repoRoot);
    const response = await call(`/api/repos/${repo.id}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: 1 });
    expect((await listRepos()).map((entry) => entry.id)).not.toContain(repo.id);
  });

  test('refuses a foreign Origin', async () => {
    const repo = await registerRepo(repoRoot);
    const response = await call(`/api/repos/${repo.id}`, {
      method: 'DELETE',
      origin: 'https://evil.example.com',
    });
    expect(response.status).toBe(403);
    expect((await listRepos()).map((entry) => entry.id)).toContain(repo.id);
  });
});

describe('GET /api/repos', () => {
  test('prunes an entry whose directory is gone', async () => {
    const gone = join(base, 'gone');
    await mkdir(gone, { recursive: true });
    await runGit(['init'], { cwd: gone });
    const doomed = await registerRepo(gone);
    await rm(gone, { recursive: true, force: true });

    const body = (await (await call('/api/repos')).json()) as {
      repos: { id: string; lastUsedAt?: string }[];
    };
    expect(body.repos.map((repo) => repo.id)).not.toContain(doomed.id);
    expect(await listRepos()).not.toContainEqual(
      expect.objectContaining({ id: doomed.id })
    );
  });

  test('reports when each repository was last used', async () => {
    const repo = await registerRepo(repoRoot);
    const body = (await (await call('/api/repos')).json()) as {
      repos: { id: string; lastUsedAt?: string }[];
      defaultId: string | null;
    };
    expect(body.defaultId).toBe(repo.id);
    expect(
      body.repos.find((entry) => entry.id === repo.id)?.lastUsedAt
    ).toBe(repo.lastUsedAt);
  });
});
