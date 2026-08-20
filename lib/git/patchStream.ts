import { runGit, streamGit, verifyRev } from './exec';
import {
  LIST_UNTRACKED_ARGS,
  type GitTarget,
  untrackedDiffArgs,
} from './targets';

export class EmptyPatchError extends Error {
  constructor(target: GitTarget) {
    super(emptyPatchMessage(target));
    this.name = 'EmptyPatchError';
  }
}

export class UnknownRevisionError extends Error {
  constructor(rev: string) {
    super(`Unknown revision: ${rev}`);
    this.name = 'UnknownRevisionError';
  }
}

function emptyPatchMessage(target: GitTarget): string {
  switch (target.kind) {
    case 'worktree':
      return 'No unstaged changes. Try --staged, or pass a branch or commit.';
    case 'staged':
      return 'Nothing staged. Stage something, or run without --staged.';
    case 'all':
      return 'No uncommitted changes.';
    default:
      return `No changes in ${target.title}.`;
  }
}

// Revisions a target needs before it can be diffed. The working tree and the
// index are not revisions, so they are not checked here.
function revsToVerify(target: GitTarget): readonly string[] {
  if (target.kind === 'commit') {
    // Only the commit itself. Its `oldRev` is a synthesised `<rev>^`, which
    // does not exist for a root commit -- and `git show` renders a root commit
    // as all additions without help, so verifying the parent would reject a
    // case git handles fine.
    return target.newRev == null ? [] : [target.newRev];
  }
  if (target.kind === 'range') {
    const revs: string[] = [];
    // A three-dot old side is the range itself, which rev-parse cannot verify
    // as a single object; the endpoints are what catch a typo'd branch name.
    if (!target.oldRev.includes('..')) revs.push(target.oldRev);
    if (target.newRev != null) revs.push(target.newRev);
    return revs;
  }
  return [];
}

export async function verifyTarget(
  target: GitTarget,
  repoRoot: string
): Promise<void> {
  for (const rev of revsToVerify(target)) {
    if ((await verifyRev(rev, { cwd: repoRoot })) == null) {
      // `HEAD~3^` on a shallow or young history fails here rather than
      // producing a confusing empty diff.
      throw new UnknownRevisionError(rev);
    }
  }
}

async function listUntracked(repoRoot: string): Promise<readonly string[]> {
  const result = await runGit([...LIST_UNTRACKED_ARGS], { cwd: repoRoot });
  return result.stdout
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Concatenates several git invocations into one patch stream.
//
// Untracked files have to be appended because `git diff` cannot see them, and
// each one costs a separate `--no-index` invocation. They are streamed in
// sequence rather than gathered up front so a large working tree starts
// rendering immediately.
//
// Emptiness is decided by whether any byte was produced, and it is a hard
// error: the client's patch parser has no empty-result branch, so a zero-byte
// body leaves the viewer on a "streaming" spinner forever.
export function createPatchStream(
  target: GitTarget,
  repoRoot: string,
  untracked: readonly string[]
): { stream: ReadableStream<Uint8Array>; wroteBytes: () => boolean } {
  const sources: (readonly string[])[] = [
    target.diffArgs,
    ...untracked.map((path) => untrackedDiffArgs(path)),
  ];

  let wrote = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // One source at a time; `pull` is re-entered until the queue drains.
      const args = sources.shift();
      if (args == null) {
        if (!wrote) {
          controller.error(new EmptyPatchError(target));
          return;
        }
        controller.close();
        return;
      }

      const { stream: source, done } = streamGit(args, { cwd: repoRoot });
      const reader = source.getReader();
      try {
        for (;;) {
          const { done: finished, value } = await reader.read();
          if (finished) break;
          if (value != null && value.byteLength > 0) {
            wrote = true;
            controller.enqueue(value);
          }
        }
        await done;
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });

  return { stream, wroteBytes: () => wrote };
}

export interface ResolvedPatch {
  stream: ReadableStream<Uint8Array>;
}

export async function openPatchStream(
  target: GitTarget,
  repoRoot: string
): Promise<ResolvedPatch> {
  await verifyTarget(target, repoRoot);
  const untracked = target.includeUntracked
    ? await listUntracked(repoRoot)
    : [];
  const { stream } = createPatchStream(target, repoRoot, untracked);
  return { stream };
}

// Buffers the whole patch. Used to answer "is there anything to show" before
// committing an HTTP status, and by tests.
export async function readPatch(
  target: GitTarget,
  repoRoot: string
): Promise<string> {
  const { stream } = await openPatchStream(target, repoRoot);
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value != null) chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
