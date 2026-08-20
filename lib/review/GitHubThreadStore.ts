import {
  deleteComment,
  getPullHeadSha,
  listReviewComments,
  listThreadNodes,
  replyToComment,
  setThreadResolved,
  submitReview,
  type GitHubRepoRef,
  type GitHubReviewComment,
  type NewReviewComment,
} from './github';
import { PendingCommentStore } from './pendingStore';
import type { SubmitOptions, ThreadStore } from './ThreadStore';
import type { Comment, Thread, ThreadAnchor, ThreadSide } from './types';

function side(value: 'LEFT' | 'RIGHT' | null): ThreadSide {
  return value === 'LEFT' ? 'LEFT' : 'RIGHT';
}

function toComment(raw: GitHubReviewComment): Comment {
  return {
    id: String(raw.id),
    author: {
      login: raw.user?.login ?? 'unknown',
      avatarUrl: raw.user?.avatar_url,
    },
    body: raw.body,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    pending: false,
  };
}

function toAnchor(raw: GitHubReviewComment): ThreadAnchor {
  // `line` is null once a comment is outdated; `original_line` is where it was
  // written. Falling back keeps an outdated thread anchored somewhere real
  // rather than at line 0.
  const line = raw.line ?? raw.original_line ?? 0;
  return {
    path: raw.path,
    line,
    side: side(raw.side),
    ...(raw.start_line == null ? {} : { startLine: raw.start_line }),
    ...(raw.start_side == null ? {} : { startSide: side(raw.start_side) }),
    commitId: raw.commit_id,
  };
}

export function pendingToThread(comment: {
  id: string;
  anchor: ThreadAnchor;
  body: string;
  createdAt: string;
}): Thread {
  return {
    id: comment.id,
    anchor: comment.anchor,
    comments: [
      {
        id: comment.id,
        author: { login: 'you' },
        body: comment.body,
        createdAt: comment.createdAt,
        // The flag that lets the UI show this as queued rather than sent.
        pending: true,
      },
    ],
    resolved: false,
    outdated: false,
  };
}

// GitHub returns review comments as a flat list. A thread is a root comment plus
// everything whose in_reply_to_id chains back to it, so the chain has to be
// walked rather than assuming one level of nesting.
export function groupCommentsIntoThreads(
  raw: GitHubReviewComment[],
  resolvedByCommentId: Map<number, boolean> = new Map()
): Thread[] {
  const byId = new Map(raw.map((comment) => [comment.id, comment]));

  const rootIdFor = (comment: GitHubReviewComment): number => {
    let current = comment;
    // A malformed chain must not spin forever, and a parent missing from the
    // page means the chain stops there.
    const seen = new Set<number>();
    while (current.in_reply_to_id != null && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.in_reply_to_id);
      if (parent == null) break;
      current = parent;
    }
    return current.id;
  };

  const threads = new Map<number, Thread>();
  for (const comment of raw) {
    const rootId = rootIdFor(comment);
    const root = byId.get(rootId) ?? comment;
    let thread = threads.get(rootId);
    if (thread == null) {
      thread = {
        id: String(rootId),
        anchor: toAnchor(root),
        comments: [],
        resolved: resolvedByCommentId.get(rootId) ?? false,
        // GitHub nulls `line` once it can no longer place the comment.
        outdated: root.line == null,
      };
      threads.set(rootId, thread);
    }
    thread.comments.push(toComment(comment));
  }

  for (const thread of threads.values()) {
    thread.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return [...threads.values()];
}

// Threads on a pull request.
//
// New threads queue locally and go up as one review on submit, because GitHub
// creates a review with its full comment list and offers no way to add to a
// pending one. Replies post immediately: `in_reply_to` inside a review's
// comments[] is rejected with 422, verified against the API.
export class GitHubThreadStore implements ThreadStore {
  readonly batches = true;
  readonly supportsResolve = true;

  private readonly pending: PendingCommentStore;

  constructor(
    private readonly ref: GitHubRepoRef,
    private readonly token: string
  ) {
    this.pending = new PendingCommentStore(
      `${ref.owner}/${ref.repo}/${ref.pull}`
    );
  }

  async list(): Promise<Thread[]> {
    const [raw, nodes, pending] = await Promise.all([
      listReviewComments(this.ref, this.token),
      // Resolved state is GraphQL-only, so it arrives separately and is joined
      // by comment id. A GraphQL failure degrades to "nothing resolved" rather
      // than losing every thread.
      listThreadNodes(this.ref, this.token).catch(() => []),
      this.pending.list(),
    ]);

    const resolvedByCommentId = new Map<number, boolean>();
    for (const node of nodes) {
      for (const comment of node.comments.nodes) {
        if (comment.databaseId != null) {
          resolvedByCommentId.set(comment.databaseId, node.isResolved);
        }
      }
    }

    return [
      ...groupCommentsIntoThreads(raw, resolvedByCommentId),
      ...pending.map(pendingToThread),
    ];
  }

  async add(input: {
    anchor: ThreadAnchor;
    body: string;
    replyToThreadId?: string;
  }): Promise<Thread> {
    if (input.replyToThreadId != null) {
      const rootId = Number(input.replyToThreadId);
      if (!Number.isFinite(rootId)) {
        throw new Error(`Cannot reply to ${input.replyToThreadId}.`);
      }
      const created = await replyToComment(
        this.ref,
        this.token,
        rootId,
        input.body
      );
      const threads = await this.list();
      return (
        threads.find((thread) => thread.id === String(rootId)) ?? {
          id: String(rootId),
          anchor: toAnchor(created),
          comments: [toComment(created)],
          resolved: false,
          outdated: false,
        }
      );
    }

    const queued = await this.pending.add({
      anchor: input.anchor,
      body: input.body,
    });
    return pendingToThread(queued);
  }

  async remove(threadId: string, commentId: string): Promise<void> {
    // A queued comment has never been sent, so removing it is local.
    if (commentId.startsWith('p_')) {
      await this.pending.remove(commentId);
      return;
    }
    const id = Number(commentId);
    if (!Number.isFinite(id)) return;
    await deleteComment(this.ref, this.token, id);
  }

  async setResolved(threadId: string, resolved: boolean): Promise<void> {
    const rootId = Number(threadId);
    if (!Number.isFinite(rootId)) return;
    const nodes = await listThreadNodes(this.ref, this.token);
    const node = nodes.find((candidate) =>
      candidate.comments.nodes.some((comment) => comment.databaseId === rootId)
    );
    if (node == null) {
      throw new Error(`No review thread found for comment ${threadId}.`);
    }
    await setThreadResolved(node.id, resolved, this.token);
  }

  async submit(options: SubmitOptions): Promise<void> {
    const queued = await this.pending.list();
    const event = options.event ?? 'COMMENT';

    // An approval with no comments is a legitimate review, so an empty queue is
    // only a no-op when there is nothing to say either.
    if (queued.length === 0 && (options.body == null || options.body === '')) {
      if (event === 'COMMENT') return;
    }

    const comments: NewReviewComment[] = queued.map((comment) => ({
      path: comment.anchor.path,
      body: comment.body,
      line: comment.anchor.line,
      side: comment.anchor.side,
      ...(comment.anchor.startLine == null
        ? {}
        : { start_line: comment.anchor.startLine }),
      ...(comment.anchor.startSide == null
        ? {}
        : { start_side: comment.anchor.startSide }),
    }));

    // The commit has to be the current head: GitHub rejects a review against a
    // stale sha, and the queue may have been sitting since before a push.
    const commitId = await getPullHeadSha(this.ref, this.token);
    await submitReview(this.ref, this.token, {
      commitId,
      event,
      body: options.body,
      comments,
    });
    await this.pending.clear();
  }
}
