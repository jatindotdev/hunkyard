import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GitError,
  findRepoRoot,
  git,
  isGitSuccess,
  runGit,
  streamGit,
  verifyRev,
} from '../exec';
import {
  LIST_UNTRACKED_ARGS,
  resolveGitTarget,
  untrackedDiffArgs,
} from '../targets';

// These run against a real repository rather than a fixture, because the point
// of this layer is that the arguments match what git actually emits.
let repo: string;

async function run(args: readonly string[]): Promise<string> {
  return git(args, { cwd: repo });
}

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'hunkyard-git-'));
  await run(['init', '-q', '-b', 'main']);
  await run(['config', 'user.email', 'test@example.com']);
  await run(['config', 'user.name', 'Test']);
  await run(['config', 'commit.gpgsign', 'false']);

  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  await run(['add', '-A']);
  await run(['commit', '-q', '-m', 'first']);

  await run(['checkout', '-q', '-b', 'feature']);
  writeFileSync(join(repo, 'a.txt'), 'one\nTWO\nthree\n');
  writeFileSync(join(repo, 'added.txt'), 'new file\n');
  await run(['add', '-A']);
  await run(['commit', '-q', '-m', 'second']);

  // Advance main past the branch point so two-dot and three-dot differ.
  await run(['checkout', '-q', 'main']);
  writeFileSync(join(repo, 'only-on-main.txt'), 'unrelated\n');
  await run(['add', '-A']);
  await run(['commit', '-q', '-m', 'on main']);
  await run(['checkout', '-q', 'feature']);
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('exit code handling', () => {
  test('a diff with no changes succeeds', async () => {
    const result = await runGit(['diff', '--no-color'], { cwd: repo });
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBe(0);
  });

  test('--no-index exits 1 when files differ, which is not a failure', async () => {
    writeFileSync(join(repo, 'untracked.txt'), 'hello\n');
    const result = await runGit(untrackedDiffArgs('untracked.txt'), {
      cwd: repo,
    });
    expect(result.code).toBe(1);
    expect(isGitSuccess(result.code)).toBe(true);
    expect(result.stdout.toString('utf8')).toContain('diff --git');
  });

  test('an unresolvable revspec throws with git’s own message', async () => {
    await expect(
      git(['diff', '--no-color', 'no-such-ref...main'], { cwd: repo })
    ).rejects.toThrow(GitError);
    try {
      await git(['diff', '--no-color', 'no-such-ref...main'], { cwd: repo });
    } catch (error) {
      expect((error as GitError).code).toBe(128);
      expect((error as GitError).message).toContain('no-such-ref');
    }
  });
});

describe('target resolution against real git output', () => {
  test('three-dot range equals an explicit merge-base diff', async () => {
    const mergeBase = (
      await run(['merge-base', 'main', 'feature'])
    ).trim();
    const viaTarget = await run([
      ...resolveGitTarget('main...feature').diffArgs,
    ]);
    const viaMergeBase = await run([
      'diff',
      '--no-color',
      '--find-renames',
      '-U3',
      `${mergeBase}..feature`,
    ]);
    expect(viaTarget).toBe(viaMergeBase);
    // The commit that landed on main after the branch point must not appear.
    expect(viaTarget).not.toContain('only-on-main.txt');
  });

  test('two-dot range includes the other side’s commits as deletions', async () => {
    const out = await run([...resolveGitTarget('main..feature').diffArgs]);
    // main has a file feature does not, so a direct comparison deletes it.
    expect(out).toContain('only-on-main.txt');
  });

  test('a bare revspec emits no commit header', async () => {
    const out = await run([...resolveGitTarget('HEAD').diffArgs]);
    expect(out.startsWith('diff --git')).toBe(true);
    expect(out).not.toContain('Author:');
    expect(out).not.toContain('commit ');
  });

  test('staged and worktree targets are distinguishable', async () => {
    appendFileSync(join(repo, 'a.txt'), 'unstaged\n');
    writeFileSync(join(repo, 'staged.txt'), 'staged\n');
    await run(['add', 'staged.txt']);

    const worktree = await run([...resolveGitTarget(undefined).diffArgs]);
    const staged = await run([...resolveGitTarget('--staged').diffArgs]);
    const all = await run([...resolveGitTarget('--all').diffArgs]);

    expect(worktree).toContain('a.txt');
    expect(worktree).not.toContain('staged.txt');
    expect(staged).toContain('staged.txt');
    expect(staged).not.toContain('unstaged');
    // --all sees both sides.
    expect(all).toContain('a.txt');
    expect(all).toContain('staged.txt');
  });

  test('untracked files are invisible to git diff but listable', async () => {
    const diff = await run([...resolveGitTarget(undefined).diffArgs]);
    expect(diff).not.toContain('untracked.txt');

    const listed = await run([...LIST_UNTRACKED_ARGS]);
    expect(listed).toContain('untracked.txt');

    // Synthesising it produces the same header shape as a tracked addition,
    // which is what lets one parser handle both.
    const synthesised = await runGit(untrackedDiffArgs('untracked.txt'), {
      cwd: repo,
    });
    expect(synthesised.stdout.toString('utf8')).toContain(
      'diff --git a/untracked.txt b/untracked.txt'
    );
    expect(synthesised.stdout.toString('utf8')).toContain('new file mode');
  });

  test('listing untracked honours gitignore', async () => {
    writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(repo, 'ignored.txt'), 'nope\n');
    const listed = await run([...LIST_UNTRACKED_ARGS]);
    expect(listed).not.toContain('ignored.txt');
  });
});

describe('streaming', () => {
  test('streams a patch and resolves when git exits cleanly', async () => {
    const { stream, done } = streamGit(
      [...resolveGitTarget('main...feature').diffArgs],
      { cwd: repo }
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    await done;
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toContain('diff --git');
    expect(text).toContain('added.txt');
  });

  test('a bad revspec errors the stream instead of yielding a truncated patch', async () => {
    const { stream, done } = streamGit(
      ['diff', '--no-color', 'no-such-ref...main'],
      { cwd: repo }
    );
    const reader = stream.getReader();
    // The failure must surface to whoever is reading the body, not just to
    // `done` -- otherwise a consumer that ignores `done` would treat an empty
    // read as "no changes".
    await expect(reader.read()).rejects.toThrow(GitError);
    await expect(done).rejects.toThrow(GitError);
  });

  test('a reader never hangs when git fails before writing a byte', async () => {
    // Regression: the child exiting and stdout ending race each other, and an
    // earlier version settled only on stdout's end, so a fast failure left the
    // reader waiting forever.
    const { stream, done } = streamGit(['diff', '--no-color', 'bogus-ref'], {
      cwd: repo,
    });
    const settled = await Promise.race([
      stream
        .getReader()
        .read()
        .then(
          () => 'resolved',
          () => 'rejected'
        ),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 3000)),
    ]);
    expect(settled).not.toBe('hung');
    await expect(done).rejects.toThrow(GitError);
  });

  test('verifyRev resolves real revisions and rejects bogus ones', async () => {
    expect(await verifyRev('HEAD', { cwd: repo })).toMatch(/^[0-9a-f]{40}$/);
    expect(await verifyRev('main', { cwd: repo })).toMatch(/^[0-9a-f]{40}$/);
    // This is what lets the route answer 400 before committing a 200.
    expect(await verifyRev('no-such-ref', { cwd: repo })).toBeNull();
  });

  test('findRepoRoot locates the work tree and refuses non-repos', async () => {
    const root = await findRepoRoot(repo);
    expect(root).not.toBeNull();
    // macOS reports /private/var for /var, so compare resolved basenames.
    expect(root?.endsWith(repo.split('/').pop() ?? '')).toBe(true);
    expect(await findRepoRoot('/')).toBeNull();
  });
});
