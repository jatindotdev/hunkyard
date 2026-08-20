import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../exec';
import { resolveGitTarget } from '../targets';
import { fingerprintTarget, isWatchableTarget, watchTarget } from '../watch';

let repo: string;
const run = (args: readonly string[]) => git(args, { cwd: repo });

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'hunkyard-watch-'));
  await run(['init', '-q', '-b', 'main']);
  await run(['config', 'user.email', 'test@example.com']);
  await run(['config', 'user.name', 'Test']);
  await run(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'a.ts'), 'const a = 1;\n');
  await run(['add', '-A']);
  await run(['commit', '-q', '-m', 'first']);
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('isWatchableTarget', () => {
  test('only targets whose content can change are watched', () => {
    expect(isWatchableTarget(resolveGitTarget(undefined))).toBe(true);
    expect(isWatchableTarget(resolveGitTarget('--staged'))).toBe(true);
    expect(isWatchableTarget(resolveGitTarget('--all'))).toBe(true);
    // A commit cannot change, so holding a connection open for it is waste.
    expect(isWatchableTarget(resolveGitTarget('HEAD'))).toBe(false);
    expect(isWatchableTarget(resolveGitTarget('main...HEAD'))).toBe(false);
  });
});

describe('fingerprintTarget', () => {
  test('is stable while nothing changes', async () => {
    const target = resolveGitTarget(undefined);
    const first = await fingerprintTarget(target, repo);
    expect(await fingerprintTarget(target, repo)).toBe(first);
  });

  test('changes when the content changes', async () => {
    const target = resolveGitTarget(undefined);
    writeFileSync(join(repo, 'a.ts'), 'const a = 2;\n');
    const changed = await fingerprintTarget(target, repo);
    writeFileSync(join(repo, 'a.ts'), 'const a = 3;\n');
    expect(await fingerprintTarget(target, repo)).not.toBe(changed);
  });

  test('is unchanged by a rewrite of identical bytes', async () => {
    // Formatters and editors rewrite files constantly; a reviewer should not
    // have the page reload underneath them for nothing.
    const target = resolveGitTarget(undefined);
    writeFileSync(join(repo, 'a.ts'), 'const a = 4;\n');
    const before = await fingerprintTarget(target, repo);
    writeFileSync(join(repo, 'a.ts'), 'const a = 4;\n');
    expect(await fingerprintTarget(target, repo)).toBe(before);
  });

  test('covers untracked files for working-tree targets', async () => {
    const target = resolveGitTarget(undefined);
    const before = await fingerprintTarget(target, repo);
    writeFileSync(join(repo, 'brand-new.ts'), 'export const x = 1;\n');
    // Untracked files are part of what the working-tree view shows, so they
    // must be part of what decides a reload.
    expect(await fingerprintTarget(target, repo)).not.toBe(before);
  });
});

describe('watchTarget', () => {
  test('notifies once the diff actually changes', async () => {
    let changes = 0;
    const handle = watchTarget(
      resolveGitTarget(undefined),
      repo,
      () => {
        changes++;
      },
      { debounceMs: 50 }
    );
    try {
      // Let the baseline settle; connecting must not itself report a change.
      await new Promise((r) => setTimeout(r, 400));
      expect(changes).toBe(0);

      writeFileSync(join(repo, 'a.ts'), 'const a = 99;\n');
      await new Promise((r) => setTimeout(r, 1200));
      expect(changes).toBeGreaterThan(0);
    } finally {
      handle.close();
    }
  });

  test('stops notifying after close', async () => {
    let changes = 0;
    const handle = watchTarget(
      resolveGitTarget(undefined),
      repo,
      () => {
        changes++;
      },
      { debounceMs: 50 }
    );
    await new Promise((r) => setTimeout(r, 400));
    handle.close();
    const after = changes;
    writeFileSync(join(repo, 'a.ts'), 'const a = 1000;\n');
    await new Promise((r) => setTimeout(r, 800));
    expect(changes).toBe(after);
  });
});
