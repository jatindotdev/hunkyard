import type { FileTreeGitStatusPatch, GitStatusEntry } from '@pierre/trees';

export type ViewerLoadState =
  | 'fetching'
  | 'streaming'
  | 'parsing'
  | 'ready'
  | 'error';

export interface DiffsHubViewerFile {
  fileOrder: number;
  path: string;
}

export type DiffsHubFileByItemId = ReadonlyMap<string, DiffsHubViewerFile>;

// The fully pre-computed input this tree needs for a given fetch. It is built
// once at fetch time by snapshotDiffsHubTreeSource and stored alongside the
// viewer items, so later per-item annotation updates do not feed into the
// tree and do not cause it to rebuild.
//
// Streamed publishes link successive snapshots through `previousSource` so the
// tree consumer can recognize append-only growth and apply the delta as
// `model.batch` adds instead of rebuilding the entire path store. The link is
// present only on snapshots that share the same underlying accumulator; the
// initial publish and any non-streamed source leave it undefined and force a
// full reset.
//
// `paths` and `pathToItemId` may alias the live accumulator state for
// streamed sources, so consumers must treat them as read-only and must use
// `pathCount` (captured at snapshot time) as the exclusive upper bound when
// iterating `paths`. The `readonly` markers and ReadonlyMap type enforce the
// read-only side; pathCount is what keeps later in-place growth invisible to
// this snapshot.
// A file's own added/deleted line counts, for the tree row decoration.
export interface DiffsHubFileLineCounts {
  added: number;
  deleted: number;
}

export interface DiffsHubFileTreeSource {
  gitStatus: readonly GitStatusEntry[];
  gitStatusPatch?: FileTreeGitStatusPatch;
  pathCount: number;
  paths: readonly string[];
  pathToItemId: ReadonlyMap<string, string>;
  // Per-file line counts, keyed by tree path. A file's counts are known the
  // moment its path is added, so a row never renders ahead of its own numbers.
  lineCountsByPath: ReadonlyMap<string, DiffsHubFileLineCounts>;
  previousSource?: DiffsHubFileTreeSource;
}

export interface DiffsHubDiffStats {
  addedLines: number;
  deletedLines: number;
  fileCount: number;
  totalLinesOfCode: number;
}
