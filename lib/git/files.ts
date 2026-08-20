import { readFile } from 'node:fs/promises';
import { isAbsolute, normalize, resolve, sep } from 'node:path';

import { git, runGit, isGitSuccess } from './exec';
import type { GitTarget } from './targets';

// Mirrors @pierre/diffs' FileContents for the fields the loader validates.
export interface LocalFileContents {
  name: string;
  contents: string;
  cacheKey: string;
}

export interface LoadedLocalFiles {
  oldFile: LocalFileContents | null;
  newFile: LocalFileContents | null;
}

// Change types the client actually asks us to hydrate. It refuses `new` and
// `deleted` locally without a request, because one side is empty by definition.
export type HydratableChangeType = 'change' | 'rename-changed' | 'rename-pure';

export class PathEscapesRepoError extends Error {
  constructor(path: string) {
    super(`Refusing to read outside the repository: ${path}`);
    this.name = 'PathEscapesRepoError';
  }
}

// A repo-relative path that cannot climb out of the repository. The agent is
// reachable from a browser, so a path from a request is untrusted input even
// though the repository root itself is not.
export function assertPathInsideRepo(repoRoot: string, path: string): string {
  if (isAbsolute(path)) throw new PathEscapesRepoError(path);
  // Reject NUL early: it terminates C strings and would truncate the path
  // that git and the filesystem actually see.
  if (path.includes('\0')) throw new PathEscapesRepoError(path);
  const root = resolve(repoRoot);
  const target = resolve(root, normalize(path));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new PathEscapesRepoError(path);
  }
  return target;
}

// The index and the working tree are not revisions, so a three-dot range needs
// its merge base resolving before it can name a single side.
async function resolveOldRev(
  target: GitTarget,
  repoRoot: string
): Promise<string> {
  if (!target.oldRev.includes('...')) return target.oldRev;
  const [from, to] = target.oldRev.split('...');
  const base = await git(
    ['merge-base', from === '' ? 'HEAD' : from, to === '' ? 'HEAD' : to],
    { cwd: repoRoot }
  );
  return base.trim();
}

// `git show <rev>:<path>` reads a blob at a revision; `:<path>` reads it from
// the index. Returns null when the path does not exist on that side, which is
// normal for a rename's old name.
async function readAtRev(
  repoRoot: string,
  rev: string,
  path: string
): Promise<{ contents: string; blob: string } | null> {
  const spec = rev === ':' ? `:${path}` : `${rev}:${path}`;
  const show = await runGit(['show', spec], { cwd: repoRoot });
  if (!isGitSuccess(show.code)) return null;

  // The blob id is the content hash, which makes a stable cache key without
  // hashing anything ourselves.
  const id = await runGit(['rev-parse', spec], { cwd: repoRoot });
  const blob = isGitSuccess(id.code)
    ? id.stdout.toString('utf8').trim()
    : 'unknown';
  return { contents: show.stdout.toString('utf8'), blob };
}

// The working tree is read from disk, and hashed by git so the cache key still
// changes with the content rather than with the path.
async function readFromWorkTree(
  repoRoot: string,
  path: string
): Promise<{ contents: string; blob: string } | null> {
  const absolute = assertPathInsideRepo(repoRoot, path);
  let contents: string;
  try {
    contents = await readFile(absolute, 'utf8');
  } catch {
    return null;
  }
  const hashed = await runGit(['hash-object', '--', path], { cwd: repoRoot });
  const blob = isGitSuccess(hashed.code)
    ? hashed.stdout.toString('utf8').trim()
    : 'worktree';
  return { contents, blob };
}

async function readSide(
  repoRoot: string,
  rev: string | null,
  path: string
): Promise<{ contents: string; blob: string } | null> {
  return rev == null
    ? readFromWorkTree(repoRoot, path)
    : readAtRev(repoRoot, rev, path);
}

function toFileContents(
  path: string,
  side: { contents: string; blob: string }
): LocalFileContents {
  // `name` is the path, not a basename: language detection reads the extension
  // and the renderer shows the full path.
  return { name: path, contents: side.contents, cacheKey: `git:${side.blob}:${path}` };
}

// Loads both sides of a file for hunk expansion. The shape matches exactly what
// the client's loader validates: a pure rename must be {oldFile: null, newFile},
// and anything else must have both sides present.
export async function loadLocalDiffFiles(
  options: {
    repoRoot: string;
    target: GitTarget;
    name: string;
    prevName?: string;
    type: HydratableChangeType;
  }
): Promise<LoadedLocalFiles> {
  const { repoRoot, target, name, prevName, type } = options;
  assertPathInsideRepo(repoRoot, name);
  if (prevName != null) assertPathInsideRepo(repoRoot, prevName);

  const newSide = await readSide(repoRoot, target.newRev, name);
  if (newSide == null) {
    throw new Error(`Could not read ${name} from the new side of the diff.`);
  }
  const newFile = toFileContents(name, newSide);

  if (type === 'rename-pure') {
    // Content is identical by definition, so the old side is deliberately
    // omitted rather than read twice.
    return { oldFile: null, newFile };
  }

  const oldRev = await resolveOldRev(target, repoRoot);
  const oldPath = prevName ?? name;
  const oldSide = await readSide(repoRoot, oldRev, oldPath);
  if (oldSide == null) {
    throw new Error(`Could not read ${oldPath} at ${oldRev}.`);
  }
  return { oldFile: toFileContents(oldPath, oldSide), newFile };
}
