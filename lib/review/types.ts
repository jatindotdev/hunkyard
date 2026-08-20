import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs';

// Which side of a diff a comment is attached to, in GitHub's vocabulary.
// @pierre/diffs says 'additions'/'deletions'; GitHub says RIGHT/LEFT. The
// translation happens once, here, rather than at every call site.
export type ThreadSide = 'LEFT' | 'RIGHT';

export function toThreadSide(side: AnnotationSide | undefined): ThreadSide {
  return side === 'deletions' ? 'LEFT' : 'RIGHT';
}

export function toAnnotationSide(side: ThreadSide): AnnotationSide {
  return side === 'LEFT' ? 'deletions' : 'additions';
}

// Where a thread is pinned.
//
// `path` is the repository-relative path, never a viewer item id: the
// accumulator mints ids like `Commit 3/src/foo.ts?previous`, so the path has to
// be resolved through its own map.
//
// `commitId` is the revision the comment was written against. GitHub requires it
// on every review comment; a local review keeps it so a thread written against
// one state of the working tree can be told apart from a later one.
export interface ThreadAnchor {
  path: string;
  side: ThreadSide;
  // The end of the selection, matching how the viewer reports a drag.
  line: number;
  // Present only for a multi-line selection.
  startLine?: number;
  startSide?: ThreadSide;
  commitId: string;
}

export interface CommentAuthor {
  login: string;
  avatarUrl?: string;
}

export interface Comment {
  id: string;
  author: CommentAuthor;
  body: string;
  createdAt: string;
  updatedAt?: string;
  // A comment that exists only locally, in a review not yet submitted. The
  // demo layer had no way to express this, which is why writing several
  // comments before submitting was impossible.
  pending: boolean;
}

export interface Thread {
  id: string;
  anchor: ThreadAnchor;
  comments: Comment[];
  resolved: boolean;
  // The lines a thread was written against no longer exist in the diff being
  // shown. Kept rather than hidden, because a stale comment is information.
  outdated: boolean;
}

// All an annotation carries. The library gives annotations no id of their own
// and requires `metadata` once it is parameterised, so an id is the only link
// between what is rendered and what is stored -- which is also the library's own
// advice: key annotation state by a stable id, never by line number.
export type ReviewAnnotationMetadata =
  | { kind: 'thread'; threadId: string }
  | { kind: 'draft'; draftId: string };

// A thread being written that has no comment yet.
export interface Draft {
  id: string;
  anchor: ThreadAnchor;
  // Set when replying rather than starting a new thread.
  replyToThreadId?: string;
  body: string;
}

export function anchorFromSelection(
  range: SelectedLineRange,
  path: string,
  commitId: string
): ThreadAnchor {
  const endSide = toThreadSide(range.endSide ?? range.side);
  const startSide = toThreadSide(range.side ?? range.endSide);
  const isRange = range.start !== range.end;
  return {
    path,
    // A single-line selection reports the same number twice; the end is what
    // GitHub treats as the comment's line.
    line: range.end,
    side: endSide,
    ...(isRange ? { startLine: range.start, startSide } : {}),
    commitId,
  };
}

// The annotation coordinates for an anchor. Multi-line selections still render
// one annotation, at the end of the range, which is where the viewer puts the
// comment box.
export function annotationForAnchor(anchor: ThreadAnchor): {
  side: AnnotationSide;
  lineNumber: number;
} {
  return { side: toAnnotationSide(anchor.side), lineNumber: anchor.line };
}
