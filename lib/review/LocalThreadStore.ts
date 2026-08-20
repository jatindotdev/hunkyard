import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parseReview, serializeReview } from './markdown';
import type { SubmitOptions, ThreadStore } from './ThreadStore';
import type { Thread, ThreadAnchor } from './types';

export const REVIEW_DIR = '.hunkyard';
export const REVIEW_FILE = 'review.md';

function reviewPath(repoRoot: string): string {
  return join(repoRoot, REVIEW_DIR, REVIEW_FILE);
}

function nextId(prefix: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  for (let n = 1; ; n++) {
    const candidate = `${prefix}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

// Threads for a local review, stored as markdown in the repository.
//
// A file rather than a database, because the point of a local review is often to
// hand the result to someone: a person reading the diff, or an agent being told
// what to change. `.hunkyard/review.md` can be read, edited, committed and
// diffed. A SQLite file could do none of that.
//
// Writes go straight through. There is nothing to submit, so `batches` is false
// and `submit` does nothing.
export class LocalThreadStore implements ThreadStore {
  readonly batches = false;
  readonly supportsResolve = true;

  constructor(
    private readonly repoRoot: string,
    private readonly target: string,
    private readonly author: string
  ) {}

  async list(): Promise<Thread[]> {
    try {
      const text = await readFile(reviewPath(this.repoRoot), 'utf8');
      return parseReview(text).threads;
    } catch (error) {
      // A review that has not been started yet is the common case, not an error.
      if ((error as { code?: string }).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async write(threads: Thread[]): Promise<void> {
    const path = reviewPath(this.repoRoot);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      serializeReview({ target: this.target, threads }),
      'utf8'
    );
  }

  async add(input: {
    anchor: ThreadAnchor;
    body: string;
    replyToThreadId?: string;
  }): Promise<Thread> {
    const threads = await this.list();
    const now = new Date().toISOString();

    if (input.replyToThreadId != null) {
      const thread = threads.find((t) => t.id === input.replyToThreadId);
      if (thread == null) {
        throw new Error(`No thread ${input.replyToThreadId} to reply to.`);
      }
      thread.comments.push({
        id: nextId('c', thread.comments.map((c) => c.id)),
        author: { login: this.author },
        body: input.body,
        createdAt: now,
        pending: false,
      });
      await this.write(threads);
      return thread;
    }

    const thread: Thread = {
      id: nextId('t', threads.map((t) => t.id)),
      anchor: input.anchor,
      comments: [
        {
          id: 'c_1',
          author: { login: this.author },
          body: input.body,
          createdAt: now,
          pending: false,
        },
      ],
      resolved: false,
      outdated: false,
    };
    // Ordered by file then line, so the file reads in the order someone would
    // walk the diff rather than in the order comments happened to be written.
    const next = [...threads, thread].sort(
      (a, b) =>
        a.anchor.path.localeCompare(b.anchor.path) ||
        a.anchor.line - b.anchor.line
    );
    await this.write(next);
    return thread;
  }

  async remove(threadId: string, commentId: string): Promise<void> {
    const threads = await this.list();
    const thread = threads.find((t) => t.id === threadId);
    if (thread == null) return;
    thread.comments = thread.comments.filter(
      (comment) => comment.id !== commentId
    );
    // A thread with no comments left is not a thread.
    await this.write(threads.filter((t) => t.comments.length > 0));
  }

  async setResolved(threadId: string, resolved: boolean): Promise<void> {
    const threads = await this.list();
    const thread = threads.find((t) => t.id === threadId);
    if (thread == null) return;
    thread.resolved = resolved;
    await this.write(threads);
  }

  async submit(_options: SubmitOptions): Promise<void> {
    // Nothing is held back, so there is nothing to publish.
  }
}
