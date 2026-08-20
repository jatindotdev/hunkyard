// A review target is "what should we diff". Each one resolves to the git
// arguments that produce a unified patch for it, plus the two sides needed to
// read whole files back for hunk expansion.
export type GitTargetKind =
  | 'worktree' // unstaged changes
  | 'staged' // index vs HEAD
  | 'all' // worktree + index vs HEAD
  | 'range' // a..b / a...b / any two-endpoint revspec
  | 'commit'; // a single commit

export interface GitTarget {
  kind: GitTargetKind;
  // Human label for the header, e.g. "main...my-branch" or "working tree".
  title: string;
  // Args that emit the unified patch, appended to `git`.
  diffArgs: readonly string[];
  // Revisions to read file contents from when expanding hunks. `null` on the
  // new side means "read from the working tree" rather than from a revision.
  oldRev: string;
  newRev: string | null;
  // Whether untracked files should be synthesised into the patch. Only
  // meaningful when the new side is the working tree.
  includeUntracked: boolean;
}

// Rename detection and a wide-enough context to make expansion useful. Colour
// is suppressed because the output is parsed, not shown.
const BASE_DIFF_ARGS = ['diff', '--no-color', '--find-renames'] as const;

export const DEFAULT_CONTEXT_LINES = 3;

function withContext(
  args: readonly string[],
  contextLines: number
): readonly string[] {
  return [...args, `-U${contextLines}`];
}

// Two-endpoint revspecs. Three-dot is git's merge-base form, which is what
// GitHub anchors a pull request against, so `main...branch` locally and the
// eventual PR agree on line numbers. Two-dot is a direct comparison and is
// left as the user wrote it.
// The left side may be empty (`..main`), so it is `*` not `+`. Lazy matching
// keeps a dotted ref intact: `v1.2.3` has no run of two dots and stays a
// single revspec, while `v1.0...v2.0` splits on the three-dot run.
const RANGE_PATTERN = /^(.*?)(\.{2,3})(.*)$/;

export interface ResolveTargetOptions {
  contextLines?: number;
}

// Parses a CLI-style target into git arguments. `spec` is undefined for the
// default (unstaged working tree), or one of `--staged` / `--all`, or any
// revspec git understands.
export function resolveGitTarget(
  spec: string | undefined,
  options: ResolveTargetOptions = {}
): GitTarget {
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const base = withContext(BASE_DIFF_ARGS, contextLines);

  if (spec == null || spec === '' || spec === '--worktree') {
    return {
      kind: 'worktree',
      title: 'working tree',
      diffArgs: base,
      oldRev: 'HEAD',
      newRev: null,
      includeUntracked: true,
    };
  }

  if (spec === '--staged' || spec === '--cached') {
    return {
      kind: 'staged',
      title: 'staged changes',
      diffArgs: [...base, '--cached'],
      oldRev: 'HEAD',
      // The index is neither a revision nor the working tree; `git show :path`
      // reads it, which the file reader handles via this sentinel.
      newRev: ':',
      includeUntracked: false,
    };
  }

  if (spec === '--all') {
    return {
      kind: 'all',
      title: 'all uncommitted changes',
      diffArgs: [...base, 'HEAD'],
      oldRev: 'HEAD',
      newRev: null,
      includeUntracked: true,
    };
  }

  const range = RANGE_PATTERN.exec(spec);
  if (range != null) {
    const [, left, dots, right] = range;
    // `main..` and `..main` are legal git shorthand for HEAD on the empty side.
    const from = left === '' ? 'HEAD' : left;
    const to = right === '' ? 'HEAD' : right;
    return {
      kind: 'range',
      title: `${from}${dots}${to}`,
      diffArgs: [...base, `${from}${dots}${to}`],
      // For a three-dot range the old side is the merge base, which git
      // resolves itself; naming the left endpoint here would read the wrong
      // side when expanding hunks.
      oldRev: dots === '...' ? `${from}...${to}` : from,
      newRev: to,
      includeUntracked: false,
    };
  }

  // A bare revspec means that commit against its first parent, matching
  // `git show`. Suppressing the format keeps the commit header out of the
  // patch so the stream is uniformly `diff --git` records.
  return {
    kind: 'commit',
    title: spec,
    diffArgs: ['show', '--no-color', '--find-renames', '--format=', `-U${contextLines}`, spec],
    oldRev: `${spec}^`,
    newRev: spec,
    includeUntracked: false,
  };
}

// Args that render one untracked file as an addition. Kept separate because it
// must never mutate the index: `git add -N` would be simpler but writes to the
// user's repository just to render a view.
export function untrackedDiffArgs(
  path: string,
  contextLines = DEFAULT_CONTEXT_LINES
): readonly string[] {
  return [
    'diff',
    '--no-color',
    `-U${contextLines}`,
    '--no-index',
    '--',
    '/dev/null',
    path,
  ];
}

export const LIST_UNTRACKED_ARGS = [
  'ls-files',
  '--others',
  '--exclude-standard',
] as const;
