import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';

import { streamGit } from './exec';
import {
  LIST_UNTRACKED_ARGS,
  type GitTarget,
  untrackedDiffArgs,
} from './targets';
import { runGit } from './exec';

// Only targets whose content can change under a fixed name are worth watching.
// A commit or a fully-pinned range is immutable.
export function isWatchableTarget(target: GitTarget): boolean {
  return (
    target.kind === 'worktree' ||
    target.kind === 'staged' ||
    target.kind === 'all'
  );
}

// Paths whose churn says nothing about the diff. `.git` is the important one:
// git rewrites index.lock and refs constantly, and watching it would fire in a
// loop while we are reading.
const IGNORED_SEGMENTS = new Set(['.git', 'node_modules', '.next', '.hunkyard']);

function isIgnoredPath(path: string | null): boolean {
  if (path == null) return false;
  return path
    .split('/')
    .some((segment) => IGNORED_SEGMENTS.has(segment));
}

// A fingerprint of what we would currently serve.
//
// Filesystem events are only a hint: editors write temp files, formatters
// rewrite a file to identical bytes, and a save can fire several events. So the
// diff itself is hashed and compared, and a client is only told to reload when
// the bytes it would receive have actually changed. The diff is streamed
// through the hash rather than buffered, so a large working tree does not cost
// memory to fingerprint.
export async function fingerprintTarget(
  target: GitTarget,
  repoRoot: string
): Promise<string> {
  const hash = createHash('sha1');

  const sources: (readonly string[])[] = [target.diffArgs];
  if (target.includeUntracked) {
    const listed = await runGit([...LIST_UNTRACKED_ARGS], { cwd: repoRoot });
    for (const path of listed.stdout
      .toString('utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')) {
      sources.push(untrackedDiffArgs(path));
    }
  }

  for (const args of sources) {
    const { stream, done } = streamGit(args, { cwd: repoRoot });
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        if (value != null) hash.update(value);
      }
      await done;
    } catch {
      // A transient failure mid-write (a file vanishing under us) should not
      // kill the watcher; the next event will produce a fresh fingerprint.
      return `error:${Date.now()}`;
    } finally {
      reader.releaseLock();
    }
  }

  return hash.digest('hex');
}

export interface WatchHandle {
  close(): void;
}

// Calls `onChange` when the diff for this target actually changes.
export function watchTarget(
  target: GitTarget,
  repoRoot: string,
  onChange: () => void,
  options: { debounceMs?: number } = {}
): WatchHandle {
  const debounceMs = options.debounceMs ?? 250;
  let timer: NodeJS.Timeout | undefined;
  let lastFingerprint: string | undefined;
  let checking = false;
  let closed = false;
  let watcher: FSWatcher | undefined;

  const check = async () => {
    if (closed || checking) return;
    checking = true;
    try {
      const next = await fingerprintTarget(target, repoRoot);
      if (lastFingerprint == null) {
        lastFingerprint = next;
      } else if (next !== lastFingerprint) {
        lastFingerprint = next;
        if (!closed) onChange();
      }
    } finally {
      checking = false;
    }
  };

  const schedule = () => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void check(), debounceMs);
  };

  // Establish the baseline without notifying, so a client that just connected
  // is not immediately told to reload what it already has.
  void check();

  try {
    watcher = watch(repoRoot, { recursive: true }, (_event, filename) => {
      if (isIgnoredPath(filename)) return;
      schedule();
    });
  } catch {
    // Recursive watching is not available everywhere. Without it the client
    // simply never gets told to reload, which is a missing feature rather than
    // a broken page.
    watcher = undefined;
  }

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      watcher?.close();
    },
  };
}
