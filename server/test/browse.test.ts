import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../../lib/git/exec';
import { createApiApp } from '../app';
import type { DirectoryListing } from '../../lib/fs/browse';

let base: string;
let repo: string;
let refused: string;
let previousStateHome: string | undefined;
const app = createApiApp();

async function call(path: string): Promise<Response> {
  return await app.fetch(
    new Request(`http://hunkyard.localhost${path}`, {
      headers: { host: 'hunkyard.localhost' },
    })
  );
}

function browse(path: string, extra = ''): Promise<Response> {
  return call(`/api/browse?path=${encodeURIComponent(path)}${extra}`);
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'hunk-browse-route-'));
  previousStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(base, 'state');

  repo = join(base, 'repo');
  await mkdir(repo, { recursive: true });
  await runGit(['init'], { cwd: repo });
  await mkdir(join(base, 'plain'), { recursive: true });
  await writeFile(join(base, 'file.txt'), 'not a directory\n');

  refused = join(base, 'refused');
  await mkdir(refused, { recursive: true });
  await chmod(refused, 0o000);
});

afterAll(async () => {
  await chmod(refused, 0o755).catch(() => {});
  if (previousStateHome == null) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousStateHome;
  await rm(base, { recursive: true, force: true });
});

describe('GET /api/browse', () => {
  test('answers with the listing', async () => {
    const response = await browse(base);
    expect(response.status).toBe(200);
    const body = (await response.json()) as DirectoryListing;
    expect(body.entries.map((entry) => entry.name)).toContain('repo');
    expect(body.entries.map((entry) => entry.name)).not.toContain('file.txt');
    expect(body.home).not.toBe('');
  });

  // Working-tree content changes under a stable URL, so a cached listing would
  // keep showing a folder that is gone.
  test('is never cached', async () => {
    expect((await browse(base)).headers.get('Cache-Control')).toBe('no-store');
  });

  test('filters and reveals hidden entries on request', async () => {
    const filtered = (await (await browse(base, '&filter=REP')).json()) as
      DirectoryListing;
    expect(filtered.entries.map((entry) => entry.name)).toEqual(['repo']);
  });

  // The client reads a failing body as the user-visible message, so these are
  // plain text with a status that says which kind of failure it was.
  test('400 for a path that is not absolute', async () => {
    const response = await browse('dev');
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('absolute');
  });

  test('400 for a path that is not a directory', async () => {
    expect((await browse(join(base, 'file.txt'))).status).toBe(400);
  });

  test('404 for a directory that is not there', async () => {
    expect((await browse(join(base, 'nowhere'))).status).toBe(404);
  });

  // A GUI agent does not inherit the Full Disk Access a terminal has, so this
  // is the everyday case on macOS rather than an exotic one.
  test('403 explains an unreadable directory in words', async () => {
    const response = await browse(refused);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain('Full Disk Access');
  });
});

describe('GET /api/repo-survey', () => {
  test('surveys a repository named by path', async () => {
    const response = await call(
      `/api/repo-survey?repo=${encodeURIComponent(repo)}`
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { root: string; status: unknown };
    expect(body.root).toEndWith('repo');
    expect(body.status).not.toBeNull();
  });

  // The picker paints its ref lists first and fills the counts in separately,
  // because status is the only call whose cost tracks the working tree.
  test('runs only the parts it was asked for', async () => {
    const body = (await (
      await call(
        `/api/repo-survey?parts=refs&repo=${encodeURIComponent(repo)}`
      )
    ).json()) as { status: unknown; commits: unknown[] };
    expect(body.status).toBeNull();
    expect(body.commits).toEqual([]);
  });

  // repoIdFor is one way, so a bookmark to a forgotten repository has to be
  // told apart from a server with nothing registered at all.
  test('404 for a repository id it cannot resolve', async () => {
    expect((await call('/api/repo-survey?repo=gone-12345678')).status).toBe(404);
  });
});
