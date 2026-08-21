import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../exec';
import {
  NoRepositoryError,
  resolveRequestRepoRoot,
  UnknownRepositoryError,
} from '../repo';

let repoRoot: string;
let notARepo: string;
let previousStateHome: string | undefined;

async function requestFor(repo: string | undefined): Promise<Request> {
  const url = new URL('http://hunkyard.localhost:4865/api/local-diff');
  if (repo != null) url.searchParams.set('repo', repo);
  return new Request(url);
}

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'hunk-scope-'));
  // The registry lives under the state directory, and resolution consults it
  // before any fallback. Without redirecting it these assertions would read
  // whichever repositories the developer happens to have opened.
  previousStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(base, 'state');
  repoRoot = join(base, 'repo');
  notARepo = join(base, 'plain');
  await mkdir(repoRoot, { recursive: true });
  await mkdir(join(repoRoot, 'nested', 'deep'), { recursive: true });
  await mkdir(notARepo, { recursive: true });
  await runGit(['init'], { cwd: repoRoot });
  await writeFile(join(repoRoot, 'a.txt'), 'a\n');
});

afterAll(async () => {
  if (previousStateHome == null) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousStateHome;
  await rm(repoRoot, { recursive: true, force: true });
});

describe('resolveRequestRepoRoot', () => {
  test('accepts a path to any repository, not only a registered one', async () => {
    expect(await resolveRequestRepoRoot(await requestFor(repoRoot))).toBe(
      await realRoot(repoRoot)
    );
  });

  // A path anywhere inside the work tree names the repository, which is what
  // makes running the CLI from a subdirectory work.
  test('resolves a subdirectory to its work tree', async () => {
    expect(
      await resolveRequestRepoRoot(await requestFor(join(repoRoot, 'nested', 'deep')))
    ).toBe(await realRoot(repoRoot));
  });

  test('refuses a directory that is not a repository', async () => {
    await expect(
      resolveRequestRepoRoot(await requestFor(notARepo))
    ).rejects.toThrow(UnknownRepositoryError);
  });

  test('refuses an id that resolves to nothing', async () => {
    await expect(
      resolveRequestRepoRoot(await requestFor('nope-12345678'))
    ).rejects.toThrow(UnknownRepositoryError);
  });

  // Distinct from the above: nothing was named at all, and there is no registry
  // entry and no usable fallback either.
  test('reports no repository when the fallback is not one', async () => {
    const previous = process.env.HUNKYARD_REPO_ROOT;
    process.env.HUNKYARD_REPO_ROOT = notARepo;
    try {
      await expect(
        resolveRequestRepoRoot(await requestFor(undefined))
      ).rejects.toThrow(NoRepositoryError);
    } finally {
      if (previous == null) delete process.env.HUNKYARD_REPO_ROOT;
      else process.env.HUNKYARD_REPO_ROOT = previous;
    }
  });
});

// macOS puts temp directories behind /private, which git reports resolved.
async function realRoot(path: string): Promise<string> {
  const result = await runGit(['rev-parse', '--show-toplevel'], { cwd: path });
  return result.stdout.toString('utf8').trim();
}
