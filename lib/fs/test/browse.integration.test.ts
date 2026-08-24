import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../../git/exec';
import { browseDirectory } from '../browse';
import {
  BROWSE_ROOT_ENV,
  BrowseNotFoundError,
  BrowsePermissionError,
  InvalidBrowsePathError,
} from '../browsePath';

let base: string;
let refused: string;

function namesIn(entries: { name: string }[]): string[] {
  return entries.map((entry) => entry.name);
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'hunk-browse-'));

  await mkdir(join(base, 'repo'), { recursive: true });
  await runGit(['init'], { cwd: join(base, 'repo') });

  await mkdir(join(base, 'plain'), { recursive: true });
  await writeFile(join(base, 'plain.txt'), 'not a directory\n');

  // A linked worktree and a submodule both have a `.git` file rather than a
  // directory, and both are repositories worth offering.
  await mkdir(join(base, 'worktree'), { recursive: true });
  await writeFile(join(base, 'worktree', '.git'), 'gitdir: ../repo/.git\n');

  await mkdir(join(base, '.dotfolder'), { recursive: true });
  await symlink(join(base, 'repo'), join(base, 'link-to-repo'));

  await mkdir(join(base, 'many'), { recursive: true });
  await Promise.all(
    Array.from({ length: 600 }, (_, index) =>
      mkdir(join(base, 'many', `child-${String(index).padStart(4, '0')}`))
    )
  );

  refused = join(base, 'refused');
  await mkdir(refused, { recursive: true });
  await chmod(refused, 0o000);
});

afterAll(async () => {
  await chmod(refused, 0o755).catch(() => {});
  delete process.env[BROWSE_ROOT_ENV];
  await rm(base, { recursive: true, force: true });
});

describe('browseDirectory', () => {
  test('lists directories and flags the repositories among them', async () => {
    const listing = await browseDirectory({ path: base });
    const byName = new Map(listing.entries.map((e) => [e.name, e]));
    expect(byName.get('repo')?.isRepository).toBe(true);
    expect(byName.get('plain')?.isRepository).toBe(false);
    // A worktree's `.git` is a file, and a stat of it says so.
    expect(byName.get('worktree')?.isRepository).toBe(true);
  });

  test('leaves files out entirely', () => {
    expect(
      browseDirectory({ path: base }).then((l) => namesIn(l.entries))
    ).resolves.not.toContain('plain.txt');
  });

  test('follows a symlink that points at a directory', async () => {
    const listing = await browseDirectory({ path: base });
    expect(namesIn(listing.entries)).toContain('link-to-repo');
  });

  test('hides dotfolders unless asked for them', async () => {
    expect(namesIn((await browseDirectory({ path: base })).entries)).not.toContain(
      '.dotfolder'
    );
    expect(
      namesIn((await browseDirectory({ path: base, hidden: true })).entries)
    ).toContain('.dotfolder');
  });

  test('filters case-insensitively before the cap', async () => {
    const listing = await browseDirectory({ path: base, filter: 'REPO' });
    expect(namesIn(listing.entries)).toEqual(['link-to-repo', 'repo']);
  });

  test('truncates a very wide directory and says so', async () => {
    const listing = await browseDirectory({ path: join(base, 'many') });
    expect(listing.entries).toHaveLength(500);
    expect(listing.truncated).toBe(true);
  });

  test('reports the directory itself, its parent and home', async () => {
    const listing = await browseDirectory({ path: join(base, 'repo') });
    expect(listing.isRepository).toBe(true);
    expect(listing.enclosingRepository).toBe(listing.path);
    expect(listing.parent).not.toBeNull();
    expect(listing.home).not.toBe('');
  });

  test('finds the repository a subdirectory sits inside', async () => {
    const nested = join(base, 'repo', 'src', 'deep');
    await mkdir(nested, { recursive: true });
    const listing = await browseDirectory({ path: nested });
    expect(listing.isRepository).toBe(false);
    expect(listing.enclosingRepository).toMatch(/repo$/);
  });

  test('has nowhere to go up to at the filesystem root', async () => {
    expect((await browseDirectory({ path: '/' })).parent).toBeNull();
  });

  // findRepoRoot returns git's resolved path and repoIdFor hashes it, so a
  // listing that kept the symlinked spelling would register one repository
  // under two identities.
  test('resolves the listed directory to its real path', async () => {
    const listing = await browseDirectory({ path: '/tmp' });
    expect(listing.path).toBe('/private/tmp');
  });

  test('refuses a relative path or a NUL', async () => {
    expect(browseDirectory({ path: 'dev' })).rejects.toBeInstanceOf(
      InvalidBrowsePathError
    );
    expect(browseDirectory({ path: '/dev\0/null' })).rejects.toBeInstanceOf(
      InvalidBrowsePathError
    );
  });

  test('refuses a path that is not a directory', async () => {
    expect(
      browseDirectory({ path: join(base, 'plain.txt') })
    ).rejects.toBeInstanceOf(InvalidBrowsePathError);
  });

  test('says a missing directory is missing', async () => {
    expect(
      browseDirectory({ path: join(base, 'nowhere') })
    ).rejects.toBeInstanceOf(BrowseNotFoundError);
  });

  test('says an unreadable directory is unreadable, in words', async () => {
    const error = await browseDirectory({ path: refused }).catch(
      (thrown: unknown) => thrown
    );
    expect(error).toBeInstanceOf(BrowsePermissionError);
    expect((error as Error).message).toContain('Full Disk Access');
  });
});

describe('browseDirectory confinement', () => {
  test('refuses to list outside the configured root', async () => {
    process.env[BROWSE_ROOT_ENV] = join(base, 'repo');
    try {
      expect(browseDirectory({ path: base })).rejects.toBeInstanceOf(
        BrowsePermissionError
      );
      // The root itself has no parent, so there is no way to walk out of it.
      const listing = await browseDirectory({ path: join(base, 'repo') });
      expect(listing.parent).toBeNull();
    } finally {
      delete process.env[BROWSE_ROOT_ENV];
    }
  });
});
