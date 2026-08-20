import type { FileDiffMetadata } from '@pierre/diffs';

// git's empty blob, `git hash-object -t blob /dev/null`. A constant, so it
// identifies a zero-byte file without reading the patch text.
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
// An absent side is all zeroes in the `index` line.
const ABSENT_BLOB = /^0+$/;

export type NonTextReason = 'binary' | 'empty';

function isEmptyBlob(objectId: string | undefined): boolean {
  if (objectId == null) return false;
  // git abbreviates the id in the patch, so compare by prefix.
  return EMPTY_BLOB.startsWith(objectId) || objectId.startsWith(EMPTY_BLOB);
}

// Why a file has nothing to show, or null when it does.
//
// @pierre/diffs has no binary handling at all: a binary file parses to zero
// hunks and renders as an empty card, indistinguishable from a bug. It also
// cannot be told apart from a zero-byte text file by hunk count alone -- both
// are `type: 'new'` with no hunks -- but their blob ids differ, and git's empty
// blob is a fixed hash.
export function classifyNonTextFile(
  fileDiff: FileDiffMetadata
): NonTextReason | null {
  if (fileDiff.hunks.length > 0) return null;
  // A pure rename has no hunks because nothing changed; the header already says
  // "old -> new", so it needs no explanation.
  if (fileDiff.type === 'rename-pure') return null;

  const sides = [fileDiff.prevObjectId, fileDiff.newObjectId].filter(
    (id): id is string => id != null && !ABSENT_BLOB.test(id)
  );
  // Nothing to compare against: treat an unknown shape as binary rather than
  // claiming a file is empty when it may not be.
  if (sides.length === 0) return 'binary';
  return sides.every(isEmptyBlob) ? 'empty' : 'binary';
}

export function describeNonTextFile(reason: NonTextReason): string {
  return reason === 'empty' ? 'Empty file' : 'Binary file';
}
