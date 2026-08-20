import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../exec';
import {
  EmptyPatchError,
  UnknownRevisionError,
  readPatch,
  verifyTarget,
} from '../patchStream';
import { resolveGitTarget } from '../targets';

let repo: string;
const run = (args: readonly string[]) => git(args, { cwd: repo });

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'hunkyard-patch-'));
  await run(['init', '-q', '-b', 'main']);
  await run(['config', 'user.email', 'test@example.com']);
  await run(['config', 'user.name', 'Test']);
  await run(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'tracked.txt'), 'one\ntwo\n');
  await run(['add', '-A']);
  await run(['commit', '-q', '-m', 'first']);
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('emptiness is an error, not an empty render', () => {
  // The client's parser has no empty-result branch: a zero-byte body leaves
  // the viewer on a "streaming" spinner forever. So this must throw.
  test('a clean working tree throws rather than yielding nothing', async () => {
    await expect(
      readPatch(resolveGitTarget(undefined), repo)
    ).rejects.toThrow(EmptyPatchError);
  });

  test('an empty index throws with staging-specific guidance', async () => {
    try {
      await readPatch(resolveGitTarget('--staged'), repo);
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EmptyPatchError);
      expect((error as Error).message).toContain('Nothing staged');
    }
  });

  test('a range with no differences throws naming the range', async () => {
    try {
      await readPatch(resolveGitTarget('HEAD..HEAD'), repo);
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).toContain('HEAD..HEAD');
    }
  });
});

describe('untracked files', () => {
  test('are included in working-tree targets', async () => {
    writeFileSync(join(repo, 'brand-new.ts'), 'export const x = 1;\n');
    const patch = await readPatch(resolveGitTarget(undefined), repo);
    expect(patch).toContain('diff --git a/brand-new.ts b/brand-new.ts');
    expect(patch).toContain('new file mode');
    expect(patch).toContain('+export const x = 1;');
  });

  test('are excluded from staged targets', async () => {
    // Nothing is staged, so this is still empty despite the untracked file.
    await expect(readPatch(resolveGitTarget('--staged'), repo)).rejects.toThrow(
      EmptyPatchError
    );
  });

  test('rendering them does not stage them', async () => {
    await readPatch(resolveGitTarget(undefined), repo);
    const status = await run(['status', '--porcelain']);
    // Still `??`, not `A `: reading the diff must not touch the index.
    expect(status).toContain('?? brand-new.ts');
    expect(status).not.toContain('A  brand-new.ts');
  });

  test('are honoured alongside tracked edits in one stream', async () => {
    writeFileSync(join(repo, 'tracked.txt'), 'one\nTWO\n');
    const patch = await readPatch(resolveGitTarget(undefined), repo);
    // One stream, both files, each with its own `diff --git` record -- which is
    // the only shape the existing parser splits on.
    const records = patch.split('diff --git ').length - 1;
    expect(records).toBe(2);
    expect(patch).toContain('tracked.txt');
    expect(patch).toContain('brand-new.ts');
  });

  test('gitignored files are not synthesised', async () => {
    writeFileSync(join(repo, '.gitignore'), 'secret.env\n');
    writeFileSync(join(repo, 'secret.env'), 'TOKEN=hunter2\n');
    const patch = await readPatch(resolveGitTarget(undefined), repo);
    // The name appears as a line inside .gitignore itself, so assert on the
    // file record and the contents rather than the bare string.
    expect(patch).not.toContain('diff --git a/secret.env');
    expect(patch).not.toContain('hunter2');
    // .gitignore is itself untracked here, so it should be synthesised.
    expect(patch).toContain('diff --git a/.gitignore b/.gitignore');
  });
});

describe('revision validation', () => {
  test('a bogus revspec is rejected before streaming starts', async () => {
    await expect(
      verifyTarget(resolveGitTarget('no-such-branch'), repo)
    ).rejects.toThrow(UnknownRevisionError);
  });

  test('a three-dot range verifies the side it can', async () => {
    await expect(
      verifyTarget(resolveGitTarget('main...no-such-branch'), repo)
    ).rejects.toThrow(UnknownRevisionError);
  });

  test('a valid target passes validation', async () => {
    await verifyTarget(resolveGitTarget('HEAD'), repo);
    await verifyTarget(resolveGitTarget(undefined), repo);
    await verifyTarget(resolveGitTarget('--staged'), repo);
  });
});

describe('binary files', () => {
  test('appear as a header with no hunks', async () => {
    // @pierre/diffs has no binary handling at all, so the app has to detect
    // this shape itself; pin the shape git actually emits.
    writeFileSync(join(repo, 'blob.bin'), Buffer.from([0x00, 0xff, 0x00, 0x1a]));
    await run(['add', 'blob.bin']);
    const patch = await readPatch(resolveGitTarget('--staged'), repo);
    expect(patch).toContain('diff --git a/blob.bin b/blob.bin');
    expect(patch).toContain('Binary files');
    expect(patch).not.toContain('@@');
  });
});

describe('root commit', () => {
  test('a repository’s first commit renders as all additions', async () => {
    // Regression: the commit target derives `<rev>^` for its old side, which
    // does not exist for a root commit. git show handles it; validation must
    // not reject it.
    const root = mkdtempSync(join(tmpdir(), 'hunkyard-root-'));
    try {
      await git(['init', '-q', '-b', 'main'], { cwd: root });
      await git(['config', 'user.email', 'test@example.com'], { cwd: root });
      await git(['config', 'user.name', 'Test'], { cwd: root });
      await git(['config', 'commit.gpgsign', 'false'], { cwd: root });
      writeFileSync(join(root, 'first.txt'), 'hello\n');
      await git(['add', '-A'], { cwd: root });
      await git(['commit', '-q', '-m', 'root'], { cwd: root });

      const target = resolveGitTarget('HEAD');
      await verifyTarget(target, root);
      const patch = await readPatch(target, root);
      expect(patch).toContain('diff --git a/first.txt b/first.txt');
      expect(patch).toContain('new file mode');
      expect(patch).toContain('+hello');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
