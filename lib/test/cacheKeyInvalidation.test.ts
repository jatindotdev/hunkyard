import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processFile } from '@pierre/diffs';

import { contentAddressedCacheKey } from '../diffCacheKey';
import { git } from '../git/exec';
import { readPatch } from '../git/patchStream';
import { resolveGitTarget } from '../git/targets';

// End-to-end proof of the invalidation this exists for: the same working-tree
// target, at the same URL, must produce different highlight cache keys once the
// file on disk changes.
let repo: string;

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'hunkyard-cachekey-'));
  const run = (args: readonly string[]) => git(args, { cwd: repo });
  await run(['init', '-q', '-b', 'main']);
  await run(['config', 'user.email', 'test@example.com']);
  await run(['config', 'user.name', 'Test']);
  await run(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'app.ts'), 'export const a = 1;\n');
  await run(['add', '-A']);
  await run(['commit', '-q', '-m', 'first']);
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

async function keyForCurrentWorktree(): Promise<string> {
  const patch = await readPatch(resolveGitTarget(undefined), repo);
  const fileDiff = processFile(patch, { isGitDiff: true });
  if (fileDiff == null) throw new Error('patch did not parse');
  // The seed is what a URL-derived key would have been: identical across edits.
  return contentAddressedCacheKey(fileDiff, '%2Flocal%2Fworktree-0-0');
}

describe('working-tree cache key invalidation', () => {
  test('editing a file changes its key even though the path is unchanged', async () => {
    writeFileSync(join(repo, 'app.ts'), 'export const a = 2;\n');
    const first = await keyForCurrentWorktree();

    writeFileSync(join(repo, 'app.ts'), 'export const a = 3;\n');
    const second = await keyForCurrentWorktree();

    // Before this change both loads produced `%2Flocal%2Fworktree-0-0`, so the
    // worker pool served the first file's highlights for the second's content.
    expect(first).not.toBe(second);
    expect(first).not.toContain('local%2Fworktree');
    expect(second).not.toContain('local%2Fworktree');
  });

  test('reverting to previous content restores the previous key', async () => {
    writeFileSync(join(repo, 'app.ts'), 'export const a = 7;\n');
    const seven = await keyForCurrentWorktree();
    writeFileSync(join(repo, 'app.ts'), 'export const a = 8;\n');
    expect(await keyForCurrentWorktree()).not.toBe(seven);
    writeFileSync(join(repo, 'app.ts'), 'export const a = 7;\n');
    // Content-addressed means a revert is a cache hit, not a miss.
    expect(await keyForCurrentWorktree()).toBe(seven);
  });

  test('git hashes working-tree content, so the key needs no staging', async () => {
    writeFileSync(join(repo, 'app.ts'), 'export const a = 99;\n');
    const key = await keyForCurrentWorktree();
    // A real blob id on the new side, from an unstaged edit.
    expect(key).toMatch(/^[0-9a-f]+\.\.[0-9a-f]+:app\.ts$/);
  });
});
