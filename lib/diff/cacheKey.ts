import type { FileDiffMetadata } from '@pierre/diffs';

// The worker pool keys highlight results by `cacheKey`, and @pierre/diffs is
// explicit that it must change whenever the diff's contents change:
//
//   "if you modify the contents of the diff in any way, you will need to
//    update the cacheKey"
//
// A key derived from the source path plus a file's position -- which is what a
// URL-derived key amounts to -- does not satisfy that for any source whose
// content can change under a stable path. A pull request that receives another
// push is the occasional case; a working tree is the constant one, since every
// keystroke changes content while the path stays `/local/worktree`.
//
// Git already solves this: the `index <old>..<new>` line in every patch record
// carries the blob ids of both sides, and parsePatchFiles reads them into
// prevObjectId/newObjectId. Those are content hashes, so keying on them makes
// the key change exactly when the content does -- including for working-tree
// diffs, where git hashes the file on disk.
//
// The path stays in the key on purpose. Language is inferred from the filename,
// so byte-identical content under two extensions must not share a highlight
// entry.
export function contentAddressedCacheKey(
  fileDiff: FileDiffMetadata,
  fallbackSeed: string
): string {
  const prev = fileDiff.prevObjectId;
  const next = fileDiff.newObjectId;

  // A pure rename carries no `index` line, because no content changed. There
  // is nothing to invalidate, so the stable path-based key is correct.
  if (prev == null && next == null) {
    return `${fallbackSeed}:${fileDiff.name}`;
  }

  return `${prev ?? 'none'}..${next ?? 'none'}:${fileDiff.name}`;
}
