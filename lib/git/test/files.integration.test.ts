import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../exec';
import {
  PathEscapesRepoError,
  assertPathInsideRepo,
  loadLocalDiffFiles,
} from '../files';
import { resolveGitTarget } from '../targets';

let repo: string;
const run = (args: readonly string[]) => git(args, { cwd: repo });

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'hunkyard-files-'));
  await run(['init', '-q', '-b', 'main']);
  await run(['config', 'user.email', 'test@example.com']);
  await run(['config', 'user.name', 'Test']);
  await run(['config', 'commit.gpgsign', 'false']);

  writeFileSync(join(repo, 'app.ts'), 'const a = 1;\nconst b = 2;\n');
  writeFileSync(join(repo, 'old-name.ts'), 'export const moved = true;\n');
  await run(['add', '-A']);
  await run(['commit', '-q', '-m', 'first']);

  await run(['checkout', '-q', '-b', 'feature']);
  writeFileSync(join(repo, 'app.ts'), 'const a = 1;\nconst b = 3;\n');
  await run(['mv', 'old-name.ts', 'new-name.ts']);
  await run(['add', '-A']);
  await run(['commit', '-q', '-m', 'second']);

  await run(['checkout', '-q', 'main']);
  writeFileSync(join(repo, 'on-main.ts'), 'export const x = 1;\n');
  await run(['add', '-A']);
  await run(['commit', '-q', '-m', 'main moves on']);
  await run(['checkout', '-q', 'feature']);
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('path confinement', () => {
  // The agent is reachable from a browser, so a path arriving in a request is
  // untrusted even though the repo root is not.
  test('rejects traversal out of the repository', () => {
    for (const bad of [
      '../outside.ts',
      '../../etc/passwd',
      'src/../../escape.ts',
      'a/b/../../../../etc/hosts',
    ]) {
      expect(() => assertPathInsideRepo(repo, bad)).toThrow(
        PathEscapesRepoError
      );
    }
  });

  test('rejects absolute paths', () => {
    expect(() => assertPathInsideRepo(repo, '/etc/passwd')).toThrow(
      PathEscapesRepoError
    );
  });

  test('rejects embedded NUL, which would truncate the real path', () => {
    expect(() => assertPathInsideRepo(repo, 'app.ts\0.png')).toThrow(
      PathEscapesRepoError
    );
  });

  test('allows ordinary nested paths, including harmless internal dots', () => {
    expect(() => assertPathInsideRepo(repo, 'src/app.ts')).not.toThrow();
    expect(() => assertPathInsideRepo(repo, 'src/a/../b.ts')).not.toThrow();
    expect(() => assertPathInsideRepo(repo, './app.ts')).not.toThrow();
  });

  test('a sibling directory sharing the root prefix is still outside', () => {
    // `/tmp/repo-evil` must not pass a naive startsWith check against
    // `/tmp/repo`.
    expect(() => assertPathInsideRepo(repo, '../' + repo.split('/').pop() + '-evil/x.ts')).toThrow(
      PathEscapesRepoError
    );
  });
});

describe('loading both sides', () => {
  test('a modified file returns both sides with content-addressed keys', async () => {
    const loaded = await loadLocalDiffFiles({
      repoRoot: repo,
      target: resolveGitTarget('main...feature'),
      name: 'app.ts',
      type: 'change',
    });
    expect(loaded.oldFile).not.toBeNull();
    expect(loaded.newFile).not.toBeNull();
    expect(loaded.oldFile?.contents).toContain('const b = 2;');
    expect(loaded.newFile?.contents).toContain('const b = 3;');
    // Keys differ because the blob ids differ.
    expect(loaded.oldFile?.cacheKey).not.toBe(loaded.newFile?.cacheKey);
    expect(loaded.newFile?.cacheKey).toMatch(/^git:[0-9a-f]{40}:app\.ts$/);
  });

  test('a three-dot range reads the old side at the merge base', async () => {
    // main has moved on, so reading the old side at `main` rather than at the
    // merge base would be a different tree.
    const loaded = await loadLocalDiffFiles({
      repoRoot: repo,
      target: resolveGitTarget('main...feature'),
      name: 'app.ts',
      type: 'change',
    });
    const atMergeBase = await run(['show', `${(await run(['merge-base', 'main', 'feature'])).trim()}:app.ts`]);
    expect(loaded.oldFile?.contents).toBe(atMergeBase);
  });

  test('a pure rename omits the old side, as the loader requires', async () => {
    const loaded = await loadLocalDiffFiles({
      repoRoot: repo,
      target: resolveGitTarget('main...feature'),
      name: 'new-name.ts',
      prevName: 'old-name.ts',
      type: 'rename-pure',
    });
    // The client validates this exact shape and rejects anything else.
    expect(loaded.oldFile).toBeNull();
    expect(loaded.newFile?.name).toBe('new-name.ts');
  });

  test('a renamed-and-changed file reads the old side under its old name', async () => {
    const loaded = await loadLocalDiffFiles({
      repoRoot: repo,
      target: resolveGitTarget('main...feature'),
      name: 'new-name.ts',
      prevName: 'old-name.ts',
      type: 'rename-changed',
    });
    expect(loaded.oldFile?.name).toBe('old-name.ts');
    expect(loaded.oldFile?.contents).toContain('moved');
  });

  test('working-tree targets read the new side from disk', async () => {
    writeFileSync(join(repo, 'app.ts'), 'const a = 1;\nconst b = 999;\n');
    const loaded = await loadLocalDiffFiles({
      repoRoot: repo,
      target: resolveGitTarget(undefined),
      name: 'app.ts',
      type: 'change',
    });
    expect(loaded.newFile?.contents).toContain('999');
    // Still a real blob id: git hashes the file on disk.
    expect(loaded.newFile?.cacheKey).toMatch(/^git:[0-9a-f]{40}:app\.ts$/);
  });

  test('the working-tree key changes as the file changes', async () => {
    writeFileSync(join(repo, 'app.ts'), 'const a = 1;\nconst b = 1000;\n');
    const first = await loadLocalDiffFiles({
      repoRoot: repo,
      target: resolveGitTarget(undefined),
      name: 'app.ts',
      type: 'change',
    });
    writeFileSync(join(repo, 'app.ts'), 'const a = 1;\nconst b = 1001;\n');
    const second = await loadLocalDiffFiles({
      repoRoot: repo,
      target: resolveGitTarget(undefined),
      name: 'app.ts',
      type: 'change',
    });
    expect(first.newFile?.cacheKey).not.toBe(second.newFile?.cacheKey);
  });

  test('a missing path fails loudly rather than returning empty content', async () => {
    await expect(
      loadLocalDiffFiles({
        repoRoot: repo,
        target: resolveGitTarget('main...feature'),
        name: 'does-not-exist.ts',
        type: 'change',
      })
    ).rejects.toThrow(/Could not read/);
  });
});
