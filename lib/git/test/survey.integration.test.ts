import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit } from '../exec';
import { parseStatus, surveyRepository } from '../survey';

let base: string;
let repoRoot: string;
let clone: string;
let empty: string;

async function git(args: string[], cwd: string): Promise<void> {
  const result = await runGit(args, { cwd });
  if (result.code > 1) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

async function commit(cwd: string, message: string): Promise<void> {
  await git(['add', '-A'], cwd);
  await git(
    [
      '-c',
      'user.email=t@example.com',
      '-c',
      'user.name=Test',
      'commit',
      '-m',
      message,
    ],
    cwd
  );
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'hunk-survey-'));
  repoRoot = join(base, 'repo');
  clone = join(base, 'clone');
  empty = join(base, 'empty');

  await mkdir(repoRoot, { recursive: true });
  await mkdir(empty, { recursive: true });
  await git(['init', '--initial-branch=main'], repoRoot);
  await git(['init', '--initial-branch=main'], empty);

  await writeFile(join(repoRoot, 'a.txt'), 'one\n');
  await commit(repoRoot, 'first');
  await writeFile(join(repoRoot, 'a.txt'), 'two\n');
  await commit(repoRoot, 'second');

  // A lightweight tag beside an annotated one: the annotated tag has no
  // committerdate at all, so sorting both in one call would strand it.
  await git(['tag', 'v0.0.1'], repoRoot);
  await git(
    [
      '-c',
      'user.email=t@example.com',
      '-c',
      'user.name=Test',
      'tag',
      '-a',
      'v0.1.0',
      '-m',
      'annotated release',
    ],
    repoRoot
  );

  await git(['branch', 'feature'], repoRoot);
  await git(['clone', repoRoot, clone], base);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('surveyRepository', () => {
  test('lists local branches with the checked-out one flagged', async () => {
    const survey = await surveyRepository(repoRoot);
    const names = survey.branches.map((branch) => branch.name);
    expect(names).toContain('main');
    expect(names).toContain('feature');
    expect(survey.branches.find((b) => b.isHead)?.name).toBe('main');
  });

  test('peels an annotated tag to the commit it points at', async () => {
    const survey = await surveyRepository(repoRoot);
    const annotated = survey.tags.find((tag) => tag.name === 'v0.1.0');
    const lightweight = survey.tags.find((tag) => tag.name === 'v0.0.1');
    expect(annotated?.date).not.toBeNull();
    expect(annotated?.oid).toBe(lightweight?.oid ?? '');
    expect(annotated?.subject).toBe('second');
  });

  test('reads the default branch from a clone', async () => {
    const survey = await surveyRepository(clone);
    expect(survey.defaultBranch).toBe('main');
    // origin/HEAD is a pointer, not something you would review.
    expect(survey.remoteBranches.map((ref) => ref.name)).not.toContain(
      'origin/HEAD'
    );
    expect(survey.remoteBranches.map((ref) => ref.name)).toContain(
      'origin/main'
    );
  });

  test('reports the upstream of a tracking branch', async () => {
    const survey = await surveyRepository(clone);
    expect(survey.branches.find((b) => b.name === 'main')?.upstream).toBe(
      'origin/main'
    );
    expect(survey.status?.upstream).toBe('origin/main');
  });

  test('lists recent commits newest first', async () => {
    const survey = await surveyRepository(repoRoot);
    expect(survey.commits.map((entry) => entry.subject)).toEqual([
      'second',
      'first',
    ]);
    expect(survey.commits[0]?.shortOid).not.toBe('');
  });

  // A repository with no commits is what you get seconds after `git init`, and
  // `git log` exits 128 there rather than printing nothing.
  test('survives an unborn HEAD', async () => {
    const survey = await surveyRepository(empty);
    expect(survey.commits).toEqual([]);
    expect(survey.branches).toEqual([]);
    expect(survey.status?.oid).toBeNull();
    expect(survey.status?.branch).toBe('main');
  });

  test('reports a detached HEAD as detached', async () => {
    const detached = join(base, 'detached');
    await git(['clone', repoRoot, detached], base);
    await git(['checkout', '--detach', 'HEAD'], detached);
    const survey = await surveyRepository(detached);
    expect(survey.status?.detached).toBe(true);
    expect(survey.status?.branch).toBeNull();
  });

  // The point of `parts`: status is the only call whose cost tracks the size of
  // the working tree, so the picker paints its ref lists without paying for it.
  test('skips the calls it was not asked for', async () => {
    const refsOnly = await surveyRepository(repoRoot, { parts: ['refs'] });
    expect(refsOnly.status).toBeNull();
    expect(refsOnly.commits).toEqual([]);
    expect(refsOnly.branches.length).toBeGreaterThan(0);

    const statusOnly = await surveyRepository(repoRoot, { parts: ['status'] });
    expect(statusOnly.branches).toEqual([]);
    expect(statusOnly.status).not.toBeNull();
  });

  test('counts staged, unstaged and untracked separately', async () => {
    const counting = join(base, 'counting');
    await git(['clone', repoRoot, counting], base);
    await writeFile(join(counting, 'staged.txt'), 'staged\n');
    await git(['add', 'staged.txt'], counting);
    await writeFile(join(counting, 'a.txt'), 'changed\n');
    await writeFile(join(counting, 'untracked.txt'), 'new\n');

    const survey = await surveyRepository(counting, { parts: ['status'] });
    expect(survey.status?.staged).toBe(1);
    expect(survey.status?.unstaged).toBe(1);
    expect(survey.status?.untracked).toBe(1);
    expect(survey.status?.conflicted).toBe(0);
  });
});

describe('parseStatus', () => {
  test('reads the branch headers', () => {
    const raw = [
      '# branch.oid abc123',
      '# branch.head my-branch',
      '# branch.upstream origin/my-branch',
      '# branch.ab +2 -3',
      '',
    ].join('\0');
    expect(parseStatus(raw)).toMatchObject({
      oid: 'abc123',
      branch: 'my-branch',
      detached: false,
      upstream: 'origin/my-branch',
      ahead: 2,
      behind: 3,
    });
  });

  // A rename record carries a second path after its own NUL, which a naive
  // reader counts as another changed file.
  test('does not count a rename twice', () => {
    const raw = [
      '# branch.head main',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.txt',
      'old.txt',
      '',
    ].join('\0');
    const status = parseStatus(raw);
    expect(status.staged).toBe(1);
    expect(status.unstaged).toBe(0);
  });

  test('counts a conflict as a conflict, not a change', () => {
    const raw = [
      '# branch.head main',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc both.txt',
      '',
    ].join('\0');
    expect(parseStatus(raw)).toMatchObject({
      conflicted: 1,
      staged: 0,
      unstaged: 0,
    });
  });
});
