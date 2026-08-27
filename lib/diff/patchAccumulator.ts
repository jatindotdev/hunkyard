import {
  type ChangeTypes,
  type CodeViewItem,
  type FileDiffMetadata,
  parsePatchFiles,
} from '@pierre/diffs';
import type {
  FileTreeGitStatusPatch,
  GitStatusEntry,
} from '@pierre/trees';

import type { ReviewAnnotationMetadata } from '@/lib/review/types';
import { contentAddressedCacheKey } from './cacheKey';
import { getPatchTreePathPrefix } from './gitPatchMetadata';
import { mapChangeTypeToGitStatus } from '@/lib/tree/gitStatus';
import type {
  HunkyardFileByItemId,
  HunkyardFileLineCounts,
  HunkyardViewerFile,
  HunkyardDiffStats,
  FileTreeSource,
} from '@/lib/types';

export interface PatchAccumulator {
  diffStats: HunkyardDiffStats;
  fileIndex: number;
  gitStatusByPath: Map<string, GitStatusEntry>;
  itemIdToFile: Map<string, HunkyardViewerFile>;
  items: CodeViewItem<ReviewAnnotationMetadata>[];
  // The last tree source emitted by snapshotHunkyardTreeSource for this
  // accumulator. Each new snapshot links back to this so the consumer can
  // recognize append-only growth and skip the full PathStore rebuild.
  lastTreeSource: FileTreeSource | undefined;
  nextCollisionSuffixByBase: Map<string, number>;
  pendingGitStatusRemovePaths: Set<string>;
  pendingGitStatusSetByPath: Map<string, GitStatusEntry>;
  pendingItems: CodeViewItem<ReviewAnnotationMetadata>[];
  pendingItemById: Map<string, CodeViewItem<ReviewAnnotationMetadata>>;
  pathToItemId: Map<string, string>;
  pathStateByTreePath: Map<string, CodeViewPathState>;
  lineCountsByPath: Map<string, HunkyardFileLineCounts>;
  paths: string[];
}

export interface HunkyardItemIdRename {
  oldId: string;
  newId: string;
}

interface CodeViewPathState {
  currentItem: CodeViewItem<ReviewAnnotationMetadata>;
  currentItemId: string;
  currentType: ChangeTypes;
  sawDeleted: boolean;
}

export interface LoadedHunkyardData {
  itemIdToFile: HunkyardFileByItemId;
  diffStats: HunkyardDiffStats;
  items: CodeViewItem<ReviewAnnotationMetadata>[];
  treeSource: FileTreeSource;
}

export function createPatchAccumulator(): PatchAccumulator {
  return {
    diffStats: {
      addedLines: 0,
      deletedLines: 0,
      fileCount: 0,
      totalLinesOfCode: 0,
    },
    fileIndex: 0,
    gitStatusByPath: new Map(),
    itemIdToFile: new Map(),
    items: [],
    lastTreeSource: undefined,
    nextCollisionSuffixByBase: new Map(),
    pendingGitStatusRemovePaths: new Set(),
    pendingGitStatusSetByPath: new Map(),
    pendingItems: [],
    pendingItemById: new Map(),
    pathToItemId: new Map(),
    pathStateByTreePath: new Map(),
    lineCountsByPath: new Map(),
    paths: [],
  };
}

export function appendFileDiffToHunkyardData(
  accumulator: PatchAccumulator,
  fileDiff: FileDiffMetadata,
  treePathPrefix: string | undefined
): HunkyardItemIdRename | undefined {
  const { diffStats } = accumulator;
  diffStats.fileCount++;
  diffStats.totalLinesOfCode += fileDiff.unifiedLineCount;
  let added = 0;
  let deleted = 0;
  for (const hunk of fileDiff.hunks) {
    added += hunk.additionLines;
    deleted += hunk.deletionLines;
  }
  diffStats.addedLines += added;
  diffStats.deletedLines += deleted;

  const path = fileDiff.name;
  const treePath = treePathPrefix == null ? path : `${treePathPrefix}/${path}`;
  accumulator.lineCountsByPath.set(treePath, { added, deleted });
  const previousPathState =
    path.length === 0
      ? undefined
      : accumulator.pathStateByTreePath.get(treePath);
  const itemIdRename =
    previousPathState == null
      ? undefined
      : renameCurrentPathItem(accumulator, treePath, previousPathState);
  const id = accumulator.itemIdToFile.has(treePath)
    ? createFallbackItemId(accumulator, treePath)
    : treePath;
  // Streaming cache keys read fileIndex before this append, so keep advancing
  // it even though item ids are now path-based.
  accumulator.fileIndex++;
  const fileOrder = accumulator.items.length;

  const item: CodeViewItem<ReviewAnnotationMetadata> = {
    id,
    type: 'diff',
    fileDiff,
    version: 0,
  };
  accumulator.items.push(item);
  accumulator.pendingItems.push(item);
  accumulator.pendingItemById.set(id, item);

  accumulator.itemIdToFile.set(id, { fileOrder, path });
  if (path.length === 0) {
    return itemIdRename;
  }

  if (previousPathState == null) {
    accumulator.paths.push(treePath);
  }
  accumulator.pathToItemId.set(treePath, id);
  updateGitStatusByPath(
    accumulator,
    treePath,
    fileDiff.type,
    previousPathState?.sawDeleted === true
  );
  accumulator.pathStateByTreePath.set(treePath, {
    currentItem: item,
    currentItemId: id,
    currentType: fileDiff.type,
    sawDeleted:
      previousPathState?.sawDeleted === true || fileDiff.type === 'deleted',
  });

  return itemIdRename;
}

export function takePendingHunkyardItems(
  accumulator: PatchAccumulator
): CodeViewItem<ReviewAnnotationMetadata>[] {
  const { pendingItems } = accumulator;
  accumulator.pendingItems = [];
  accumulator.pendingItemById.clear();
  return pendingItems;
}

// Produces a tree source snapshot, linking it to the previous snapshot from
// the same accumulator. The consumer treats that link as a hint that the new
// paths array is an append-only extension of the prior one and applies the
// delta with model.batch instead of rebuilding the whole PathStore. Consumers
// that recreate the accumulator (e.g. a new request) discard the prior link
// implicitly because lastTreeSource is undefined on a fresh accumulator.
export function snapshotHunkyardTreeSource(
  accumulator: PatchAccumulator
): FileTreeSource {
  const previousSource = accumulator.lastTreeSource;
  const gitStatusPatch = takePendingGitStatusPatch(accumulator);
  const snapshot: FileTreeSource = {
    gitStatus: Array.from(accumulator.gitStatusByPath.values()),
    gitStatusPatch: previousSource == null ? undefined : gitStatusPatch,
    pathCount: accumulator.paths.length,
    paths: accumulator.paths,
    pathToItemId: accumulator.pathToItemId,
    lineCountsByPath: accumulator.lineCountsByPath,
    previousSource,
  };
  accumulator.lastTreeSource = snapshot;
  return snapshot;
}

function takePendingGitStatusPatch(
  accumulator: PatchAccumulator
): FileTreeGitStatusPatch | undefined {
  const { pendingGitStatusRemovePaths, pendingGitStatusSetByPath } =
    accumulator;
  if (
    pendingGitStatusRemovePaths.size === 0 &&
    pendingGitStatusSetByPath.size === 0
  ) {
    return undefined;
  }

  const patch: FileTreeGitStatusPatch = {};
  if (pendingGitStatusRemovePaths.size > 0) {
    patch.remove = [...pendingGitStatusRemovePaths];
    pendingGitStatusRemovePaths.clear();
  }
  if (pendingGitStatusSetByPath.size > 0) {
    patch.set = [...pendingGitStatusSetByPath.values()];
    pendingGitStatusSetByPath.clear();
  }
  return patch;
}

// Moves the current CodeView item for a path off the canonical tree id so the
// next diff entry for that same path can own tree navigation without rebuilding.
function renameCurrentPathItem(
  accumulator: PatchAccumulator,
  treePath: string,
  pathState: CodeViewPathState
): HunkyardItemIdRename | undefined {
  const oldId = pathState.currentItemId;
  const newId = createSupersededItemId(
    accumulator,
    treePath,
    pathState.currentType
  );
  pathState.currentItem.id = newId;
  pathState.currentItemId = newId;

  const file = accumulator.itemIdToFile.get(oldId);
  if (file != null) {
    accumulator.itemIdToFile.delete(oldId);
    accumulator.itemIdToFile.set(newId, file);
  }

  const pendingItem = accumulator.pendingItemById.get(oldId);
  if (pendingItem != null) {
    accumulator.pendingItemById.delete(oldId);
    accumulator.pendingItemById.set(newId, pendingItem);
    return undefined;
  }

  return { oldId, newId };
}

function createSupersededItemId(
  accumulator: PatchAccumulator,
  treePath: string,
  changeType: ChangeTypes
): string {
  const semanticSuffix = changeType === 'deleted' ? '?deleted' : '?previous';
  return createUniqueItemId(accumulator, `${treePath}${semanticSuffix}`);
}

function createFallbackItemId(
  accumulator: PatchAccumulator,
  treePath: string
): string {
  return createUniqueItemId(accumulator, `${treePath}?2`);
}

// Resolves rare id collisions by advancing a per-base suffix instead of scanning
// accumulated items.
function createUniqueItemId(
  accumulator: PatchAccumulator,
  baseId: string
): string {
  if (!accumulator.itemIdToFile.has(baseId)) {
    return baseId;
  }

  let suffix = accumulator.nextCollisionSuffixByBase.get(baseId) ?? 2;
  let itemId = `${baseId}-${suffix}`;
  while (accumulator.itemIdToFile.has(itemId)) {
    suffix++;
    itemId = `${baseId}-${suffix}`;
  }
  accumulator.nextCollisionSuffixByBase.set(baseId, suffix + 1);
  return itemId;
}

// Maintains the file tree status for a real path while repeated patch entries
// replace the path's final CodeView item.
function updateGitStatusByPath(
  accumulator: PatchAccumulator,
  treePath: string,
  changeType: ChangeTypes,
  hadDeletedEntry: boolean
): void {
  if (hadDeletedEntry && changeType !== 'deleted') {
    if (accumulator.gitStatusByPath.delete(treePath)) {
      recordGitStatusRemove(accumulator, treePath);
    }
    return;
  }

  // Modified files are excluded so they render as the visual default. Only
  // added, deleted, and renamed files retain status indicators.
  const gitStatusEntry = mapChangeTypeToGitStatus(changeType);
  if (gitStatusEntry === 'modified') {
    if (accumulator.gitStatusByPath.delete(treePath)) {
      recordGitStatusRemove(accumulator, treePath);
    }
  } else {
    const previousStatus = accumulator.gitStatusByPath.get(treePath)?.status;
    if (previousStatus === gitStatusEntry) {
      return;
    }

    const entry = {
      path: treePath,
      status: gitStatusEntry,
    };
    accumulator.gitStatusByPath.set(treePath, entry);
    recordGitStatusSet(accumulator, entry);
  }
}

function recordGitStatusSet(
  accumulator: PatchAccumulator,
  entry: GitStatusEntry
): void {
  accumulator.pendingGitStatusRemovePaths.delete(entry.path);
  accumulator.pendingGitStatusSetByPath.set(entry.path, entry);
}

function recordGitStatusRemove(
  accumulator: PatchAccumulator,
  path: string
): void {
  accumulator.pendingGitStatusSetByPath.delete(path);
  accumulator.pendingGitStatusRemovePaths.add(path);
}

export function snapshotHunkyardData(
  accumulator: PatchAccumulator
): LoadedHunkyardData {
  return {
    itemIdToFile: new Map(accumulator.itemIdToFile),
    diffStats: { ...accumulator.diffStats },
    items: accumulator.items.slice(),
    treeSource: snapshotHunkyardTreeSource(accumulator),
  };
}

// Converts raw patch text into the exact state slices consumed by the diff
// viewer, sidebar tree, stats panel, and comment index in one linear pass.
export function buildHunkyardData(
  patchContent: string,
  githubPath: string
): LoadedHunkyardData {
  const parsedPatches = parsePatchFiles(
    patchContent,
    // Use the url as a cache key
    encodeURIComponent(githubPath)
  );

  const accumulator = createPatchAccumulator();
  const shouldPrefixTreePaths = parsedPatches.length > 1;
  for (const [patchIndex, patch] of parsedPatches.entries()) {
    const treePathPrefix = shouldPrefixTreePaths
      ? getPatchTreePathPrefix(patch.patchMetadata, patchIndex)
      : undefined;
    for (const [fileIndex, fileDiff] of patch.files.entries()) {
      // Same reasoning as the streaming path: parsePatchFiles keys off the
      // supplied prefix and position, which does not change when a mutable
      // source's content does.
      fileDiff.cacheKey = contentAddressedCacheKey(
        fileDiff,
        `${encodeURIComponent(githubPath)}-${patchIndex}-${fileIndex}`
      );
      appendFileDiffToHunkyardData(accumulator, fileDiff, treePathPrefix);
    }
  }

  return snapshotHunkyardData(accumulator);
}
