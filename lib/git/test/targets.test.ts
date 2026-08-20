import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_CONTEXT_LINES,
  LIST_UNTRACKED_ARGS,
  resolveGitTarget,
  untrackedDiffArgs,
} from '../targets';

describe('resolveGitTarget', () => {
  test('defaults to the unstaged working tree', () => {
    for (const spec of [undefined, '', '--worktree']) {
      const target = resolveGitTarget(spec);
      expect(target.kind).toBe('worktree');
      expect(target.diffArgs).toEqual([
        'diff',
        '--no-color',
        '--find-renames',
        '-U3',
      ]);
      // The new side is the working tree, so there is no revision to read.
      expect(target.newRev).toBeNull();
      expect(target.includeUntracked).toBe(true);
    }
  });

  test('staged reads the index, not the working tree', () => {
    const target = resolveGitTarget('--staged');
    expect(target.diffArgs).toContain('--cached');
    expect(target.newRev).toBe(':');
    // Untracked files are not in the index, so they cannot appear here.
    expect(target.includeUntracked).toBe(false);
  });

  test('--cached is accepted as an alias for --staged', () => {
    expect(resolveGitTarget('--cached').kind).toBe('staged');
  });

  test('--all compares both index and working tree against HEAD', () => {
    const target = resolveGitTarget('--all');
    expect(target.diffArgs).toContain('HEAD');
    expect(target.diffArgs).not.toContain('--cached');
    expect(target.includeUntracked).toBe(true);
  });

  test('three-dot ranges keep merge-base semantics on the old side', () => {
    const target = resolveGitTarget('main...feature');
    expect(target.kind).toBe('range');
    expect(target.diffArgs).toContain('main...feature');
    // Naming only `main` here would read the wrong side once main moves on,
    // so the old side stays the range and lets git resolve the merge base.
    expect(target.oldRev).toBe('main...feature');
    expect(target.newRev).toBe('feature');
  });

  test('two-dot ranges compare endpoints directly', () => {
    const target = resolveGitTarget('main..feature');
    expect(target.diffArgs).toContain('main..feature');
    expect(target.oldRev).toBe('main');
    expect(target.newRev).toBe('feature');
  });

  test('open-ended ranges fill the missing side with HEAD', () => {
    expect(resolveGitTarget('main..').title).toBe('main..HEAD');
    expect(resolveGitTarget('..main').title).toBe('HEAD..main');
    expect(resolveGitTarget('HEAD~3..').diffArgs).toContain('HEAD~3..HEAD');
  });

  test('a bare revspec becomes a single commit against its first parent', () => {
    const target = resolveGitTarget('HEAD~3');
    expect(target.kind).toBe('commit');
    expect(target.oldRev).toBe('HEAD~3^');
    expect(target.newRev).toBe('HEAD~3');
    // The commit header must be suppressed so the stream stays a uniform
    // sequence of `diff --git` records.
    expect(target.diffArgs).toContain('--format=');
    expect(target.diffArgs[0]).toBe('show');
  });

  test('context lines are configurable and default to 3', () => {
    expect(resolveGitTarget(undefined).diffArgs).toContain('-U3');
    expect(
      resolveGitTarget(undefined, { contextLines: 20 }).diffArgs
    ).toContain('-U20');
    expect(DEFAULT_CONTEXT_LINES).toBe(3);
  });

  test('every target requests rename detection', () => {
    for (const spec of [undefined, '--staged', '--all', 'a...b', 'abc123']) {
      expect(resolveGitTarget(spec).diffArgs).toContain('--find-renames');
    }
  });
});

describe('untrackedDiffArgs', () => {
  test('renders an untracked file without touching the index', () => {
    const args = untrackedDiffArgs('src/new.ts');
    expect(args).toContain('--no-index');
    expect(args).toContain('/dev/null');
    expect(args).toContain('src/new.ts');
    // `git add -N` would be shorter but writes to the user's repository.
    expect(args).not.toContain('add');
  });

  test('separates paths from revisions so a file named like a ref is safe', () => {
    const args = untrackedDiffArgs('main');
    expect(args.indexOf('--')).toBeLessThan(args.indexOf('/dev/null'));
  });

  test('untracked listing respects gitignore', () => {
    expect(LIST_UNTRACKED_ARGS).toContain('--exclude-standard');
  });
});

describe('revspec parsing edge cases', () => {
  test('a dotted tag name is not mistaken for a range', () => {
    // `v1.2.3` has no run of two or more dots, so it must stay a single
    // revspec rather than splitting into `v1` and `2.3`.
    expect(resolveGitTarget('v1.2.3').kind).toBe('commit');
    expect(resolveGitTarget('v1.2.3').title).toBe('v1.2.3');
  });

  test('dotted tags on both sides of a range still split correctly', () => {
    const target = resolveGitTarget('v1.0...v2.0');
    expect(target.kind).toBe('range');
    expect(target.title).toBe('v1.0...v2.0');
    expect(target.newRev).toBe('v2.0');
  });

  test('a path-like ref with slashes is preserved', () => {
    const target = resolveGitTarget('origin/main...feature/thing');
    expect(target.title).toBe('origin/main...feature/thing');
    expect(target.newRev).toBe('feature/thing');
  });
});
