import type { DiffLineAnnotation } from '@pierre/diffs';

import { annotationForAnchor } from './types';
import type { Draft, ReviewAnnotationMetadata, Thread } from './types';

export type ReviewAnnotation = DiffLineAnnotation<ReviewAnnotationMetadata>;

export interface DraftLike {
  id: string;
  anchor: Draft['anchor'];
}

// Turns review state into the annotations the viewer should show.
//
// Annotations are a projection of threads and drafts, not a second copy of them.
// The layer this replaces stored comments *in* item.annotations and mutated them
// in place, which is why reloading the diff destroyed every comment: the
// annotations were the only record.
//
// Keyed by viewer item id, because that is what CodeView addresses items by. The
// path-to-item mapping has to be supplied: item ids carry decoration like
// `Commit 3/src/a.ts?previous` and cannot be derived from a path.
export function projectAnnotations(
  threads: readonly Thread[],
  drafts: readonly DraftLike[],
  itemIdForPath: (path: string) => string | undefined
): Map<string, ReviewAnnotation[]> {
  const byItem = new Map<string, ReviewAnnotation[]>();

  const push = (path: string, annotation: ReviewAnnotation) => {
    const itemId = itemIdForPath(path);
    // A thread on a file that is not in this diff has nowhere to render. It is
    // still in the store, so nothing is lost by skipping it here.
    if (itemId == null) return;
    const existing = byItem.get(itemId);
    if (existing == null) byItem.set(itemId, [annotation]);
    else existing.push(annotation);
  };

  for (const thread of threads) {
    push(thread.anchor.path, {
      ...annotationForAnchor(thread.anchor),
      metadata: { kind: 'thread', threadId: thread.id },
    });
  }

  // Drafts render after threads on the same line, so a reply box appears below
  // the conversation it belongs to rather than above it.
  for (const draft of drafts) {
    push(draft.anchor.path, {
      ...annotationForAnchor(draft.anchor),
      metadata: { kind: 'draft', draftId: draft.id },
    });
  }

  return byItem;
}

// Whether two annotation lists are the same, so an item is only re-rendered when
// its annotations actually changed. CodeView needs a version bump per update,
// and bumping every item on every keystroke would re-tokenize the whole diff.
export function areAnnotationsEqual(
  a: readonly ReviewAnnotation[] | undefined,
  b: readonly ReviewAnnotation[] | undefined
): boolean {
  if (a === b) return true;
  if (a == null || b == null) return (a?.length ?? 0) === (b?.length ?? 0);
  if (a.length !== b.length) return false;
  return a.every((annotation, index) => {
    const other = b[index];
    if (annotation.lineNumber !== other.lineNumber) return false;
    if (annotation.side !== other.side) return false;
    const left = annotation.metadata;
    const right = other.metadata;
    if (left.kind !== right.kind) return false;
    return left.kind === 'thread' && right.kind === 'thread'
      ? left.threadId === right.threadId
      : left.kind === 'draft' && right.kind === 'draft'
        ? left.draftId === right.draftId
        : false;
  });
}
