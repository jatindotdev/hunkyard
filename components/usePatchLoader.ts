'use client';

import {
  areSelectionsEqual,
  type CodeViewItem,
  type CodeViewLineSelection,
  processFile,
} from '@pierre/diffs';
import { type CodeViewHandle, useStableCallback } from '@pierre/diffs/react';
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { ReviewAnnotationMetadata } from '@/lib/review/types';
import { CODE_VIEW_BATCH_COUNT, getInitialBatchSize } from '@/lib/constants';
import {
  appendFileDiffToHunkyardData,
  buildHunkyardData,
  createPatchAccumulator,
  type HunkyardItemIdRename,
  snapshotHunkyardTreeSource,
  takePendingHunkyardItems,
} from '@/lib/patchAccumulator';
import { contentAddressedCacheKey } from '@/lib/diffCacheKey';
import { getPatchTreePathPrefix } from '@/lib/gitPatchMetadata';
import {
  type HunkyardLineHashTarget,
  formatHunkyardLineHash,
  parseHunkyardLineHash,
} from '@/lib/lineHash';
import {
  getStreamedPatchMetadata,
  streamGitPatchFiles,
} from '@/lib/streamGitPatchFiles';
import type {
  HunkyardFileByItemId,
  HunkyardDiffStats,
  FileTreeSource,
  ViewerLoadState,
} from '@/lib/types';

const STREAM_PUBLISH_INTERVAL_MS = 100;
const STREAM_INITIAL_PUBLISH_INTERVAL_MS = 500;
const STREAM_WORK_BUDGET_MS = 8;
const STREAM_TREE_PUBLISH_FILE_BATCH_SIZE = 1_000;
const STREAM_TREE_PUBLISH_INTERVAL_MS = 1_000;
const GENERIC_PATCH_LOAD_ERROR_MESSAGE =
  'We couldn’t load that diff. Check the URL and try again.';

interface UsePatchLoaderOptions {
  collapseMode: 'expanded' | 'collapsed';
  domain?: string;
  getGitHubToken?(): string | undefined;
  githubTokenVersion?: number | string;
  onLoadStart(): void;
  path: string;
  // The endpoint that answers with patch bytes. GitHub goes through
  // /api/diff because the diff hosts send no CORS headers; a local review goes
  // through /api/local-diff because it needs a process to run git. Supplied by
  // the caller so this hook stays source-agnostic.
  patchRequestUrl: string;
  // Whether to attach the user's GitHub token. Never true for a local review:
  // the local route has no use for it, and sending it would hand a credential
  // to a git handler.
  sendGitHubToken: boolean;
  viewerRef: RefObject<CodeViewHandle<ReviewAnnotationMetadata> | null>;
}

interface UsePatchLoaderResult {
  applyCollapseModeToLoaded(mode: 'expanded' | 'collapsed'): void;
  fileByItemId: HunkyardFileByItemId | null;
  diffStats: HunkyardDiffStats | null;
  errorMessage: string | null;
  initialItems: CodeViewItem<ReviewAnnotationMetadata>[];
  loadState: ViewerLoadState;
  onLineLinkChange(selection: CodeViewLineSelection | null): void;
  onViewerReady(): void;
  retryLoad(): void;
  treeSource: FileTreeSource | null;
  viewerKey: number;
}

export function usePatchLoader({
  collapseMode,
  domain,
  getGitHubToken,
  githubTokenVersion = 0,
  onLoadStart,
  path,
  patchRequestUrl,
  sendGitHubToken,
  viewerRef,
}: UsePatchLoaderOptions): UsePatchLoaderResult {
  const [initialItems, setInitialItems] = useState<
    CodeViewItem<ReviewAnnotationMetadata>[]
  >([]);
  // Tree data is intentionally stored separately from items so annotation
  // updates do not cascade into the file tree and trigger needless rebuilds.
  // It is updated by fetch/stream batches in this viewer route.
  const [treeSource, setTreeSource] = useState<FileTreeSource | null>(
    null
  );
  const [diffStats, setDiffStats] = useState<HunkyardDiffStats | null>(null);
  const [fileByItemId, setFileByItemId] =
    useState<HunkyardFileByItemId | null>(null);
  const [loadState, setLoadState] = useState<ViewerLoadState>('fetching');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [viewerKey, setViewerKey] = useState(0);
  const requestIdRef = useRef(0);
  const appliedLineHashKeyRef = useRef<string | null>(null);
  const viewerKeyRef = useRef(0);
  // Tracks the ids of every item that has been handed to the viewer so we can
  // walk the full set when the user toggles collapse mode. The viewer handle
  // does not expose an enumeration API, so we maintain our own index.
  const loadedItemIdsRef = useRef<Set<string>>(new Set());
  // Mirrors the latest collapse mode so the streaming code path (which lives
  // inside a long-lived effect/closure) can read the live value without us
  // having to re-bind it on every change.
  const collapseModeRef = useRef(collapseMode);
  collapseModeRef.current = collapseMode;

  // Pre-mutates fresh items so they arrive in the viewer matching the current
  // collapse mode, then records their ids for later bulk updates. Diff items
  // are normalized in both directions because the accumulator initializes
  // deleted-file diffs as collapsed by default — without an unconditional
  // overwrite, those would stay collapsed even when the user is in expanded
  // mode.
  const prepareItemsForViewer = (
    items: readonly CodeViewItem<ReviewAnnotationMetadata>[]
  ): void => {
    const targetCollapsed = collapseModeRef.current === 'collapsed';
    for (const item of items) {
      loadedItemIdsRef.current.add(item.id);
      if (item.type === 'diff') {
        item.collapsed = targetCollapsed;
      }
    }
  };

  const applyCollapseModeToLoaded = useStableCallback(
    (mode: 'expanded' | 'collapsed') => {
      const targetCollapsed = mode === 'collapsed';
      const viewer = viewerRef.current;
      if (viewer == null) {
        // The viewer hasn't mounted yet (e.g. the worker pool is still warming
        // up while the header is already interactive). Rewrite any items
        // already buffered in initialItems so they arrive in the right state
        // once the viewer mounts. New items still streaming in pick up the
        // live collapse mode through prepareItemsForViewer.
        setInitialItems((prev) => {
          let changed = false;
          const next = prev.map((item) => {
            if (
              item.type !== 'diff' ||
              (item.collapsed === true) === targetCollapsed
            ) {
              return item;
            }
            changed = true;
            return { ...item, collapsed: targetCollapsed };
          });
          return changed ? next : prev;
        });
        return;
      }

      for (const itemId of loadedItemIdsRef.current) {
        const item = viewer.getItem(itemId);
        if (item == null || item.type !== 'diff') {
          continue;
        }
        const current = item.collapsed === true;
        if (current === targetCollapsed) {
          continue;
        }
        item.collapsed = targetCollapsed;
        item.version = getNextItemVersion(item);
        viewer.updateItem(item);
      }
    }
  );

  const tryApplyLineHashTarget = useStableCallback(() => {
    const { hash } = window.location;
    const target = parseHunkyardLineHash(hash);
    if (target == null) {
      return;
    }

    const applyKey = getLineHashApplyKey(viewerKeyRef.current, hash);
    if (appliedLineHashKeyRef.current === applyKey) {
      return;
    }

    const viewer = viewerRef.current;
    if (viewer == null) {
      return;
    }

    if (applyHunkyardLineHashTarget(viewer, target)) {
      appliedLineHashKeyRef.current = applyKey;
    }
  });

  const handleLineLinkChange = useStableCallback(
    (selection: CodeViewLineSelection | null) => {
      const nextHash =
        selection == null ? null : formatHunkyardLineHash(selection);
      appliedLineHashKeyRef.current =
        nextHash == null
          ? null
          : getLineHashApplyKey(viewerKeyRef.current, nextHash);
      replaceLocationHash(nextHash);
    }
  );

  useEffect(() => {
    const patchRequestKey =
      domain == null || domain === '' ? path : `${domain}${path}`;

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    const isCurrentRequest = () =>
      requestIdRef.current === requestId && !controller.signal.aborted;

    viewerKeyRef.current = requestId;
    appliedLineHashKeyRef.current = null;
    loadedItemIdsRef.current = new Set();
    setViewerKey(requestId);
    setInitialItems([]);
    setTreeSource(null);
    setDiffStats(null);
    setFileByItemId(null);
    onLoadStart();
    setErrorMessage(null);
    setLoadState('fetching');

    async function loadPatch() {
      try {
        const cacheKeyPrefix = encodeURIComponent(patchRequestKey);
        async function commitFullPatch(patchContent: string) {
          if (!isCurrentRequest()) {
            return;
          }
          setLoadState('parsing');
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

          if (!isCurrentRequest()) {
            return;
          }
          const loadedData = buildHunkyardData(patchContent, patchRequestKey);
          if (!isCurrentRequest()) {
            return;
          }

          setTreeSource(loadedData.treeSource);
          setFileByItemId(loadedData.itemIdToFile);
          setDiffStats(loadedData.diffStats);
          prepareItemsForViewer(loadedData.items);
          setInitialItems(loadedData.items);
          setLoadState('ready');
          await yieldToBrowser();
          if (isCurrentRequest()) {
            tryApplyLineHashTarget();
          }
        }

        const response = await fetch(
          patchRequestUrl,
          createPatchRequestInit(
            controller.signal,
            sendGitHubToken ? getGitHubToken?.() : undefined
          )
        );

        // This only catches route setup errors. GitHub fetch failures are
        // delivered while consuming the stream so the UI can enter the
        // streaming state as soon as the local transport opens.
        if (!response.ok) {
          const detail = (await response.text()).trim();
          throw new Error(
            detail.length > 0 ? detail : `Request failed (${response.status}).`
          );
        }

        if (response.body == null) {
          const patchContent = await response.text();
          await commitFullPatch(patchContent);
          return;
        }

        setLoadState('streaming');
        await yieldToBrowser();
        if (!isCurrentRequest()) {
          return;
        }

        const accumulator = createPatchAccumulator();
        let streamPatchIndex = 0;
        let streamTreePathPrefix: string | undefined;
        let pendingPublishFileCount = 0;
        let pendingTreePublishFileCount = 0;
        let hasPublishedTree = false;
        let hasPublishedInitialItems = false;
        let hasReceivedFirstStreamedFile = false;
        let lastPublishTime = performance.now();
        let lastWorkYieldTime = lastPublishTime;
        let lastTreePublishTime = lastPublishTime;
        const initialPublishFileBatchSize = getInitialBatchSize();

        const publishTreeSource = () => {
          if (pendingTreePublishFileCount === 0 || !isCurrentRequest()) {
            return;
          }

          pendingTreePublishFileCount = 0;
          hasPublishedTree = true;
          lastTreePublishTime = performance.now();
          setFileByItemId(accumulator.itemIdToFile);
          setDiffStats({ ...accumulator.diffStats });
          setTreeSource(snapshotHunkyardTreeSource(accumulator));
        };

        const publishPendingData = async () => {
          if (pendingPublishFileCount === 0 || !isCurrentRequest()) {
            return;
          }

          pendingPublishFileCount = 0;
          lastPublishTime = performance.now();
          const pendingItems = takePendingHunkyardItems(accumulator);
          prepareItemsForViewer(pendingItems);
          if (!hasPublishedInitialItems) {
            hasPublishedInitialItems = true;
            publishTreeSource();
            setInitialItems(pendingItems);
          } else {
            const viewer = viewerRef.current;
            if (viewer != null) {
              viewer.addItems(pendingItems);
            } else {
              setInitialItems((prev) => [...prev, ...pendingItems]);
            }
          }
          await yieldToBrowser();
          if (isCurrentRequest()) {
            tryApplyLineHashTarget();
          }
          lastWorkYieldTime = performance.now();
        };

        const publishPendingDataIfNeeded = async () => {
          if (pendingPublishFileCount === 0) {
            return;
          }

          const elapsed = performance.now() - lastPublishTime;
          const publishFileBatchSize = hasPublishedInitialItems
            ? CODE_VIEW_BATCH_COUNT
            : initialPublishFileBatchSize;
          const publishInterval = hasPublishedInitialItems
            ? STREAM_PUBLISH_INTERVAL_MS
            : STREAM_INITIAL_PUBLISH_INTERVAL_MS;
          if (
            pendingPublishFileCount < publishFileBatchSize &&
            elapsed < publishInterval
          ) {
            return;
          }

          await publishPendingData();
        };
        const shouldDeferInitialPublishForBatchTarget = () => {
          if (hasPublishedInitialItems) {
            return false;
          }

          const elapsed = performance.now() - lastPublishTime;
          return (
            pendingPublishFileCount < initialPublishFileBatchSize &&
            elapsed < STREAM_INITIAL_PUBLISH_INTERVAL_MS
          );
        };
        const publishTreeSourceIfNeeded = () => {
          if (pendingTreePublishFileCount === 0) {
            return;
          }

          const elapsed = performance.now() - lastTreePublishTime;
          if (
            hasPublishedTree &&
            pendingTreePublishFileCount < STREAM_TREE_PUBLISH_FILE_BATCH_SIZE &&
            elapsed < STREAM_TREE_PUBLISH_INTERVAL_MS
          ) {
            return;
          }

          publishTreeSource();
        };
        const appendStreamedFile = async (fileText: string) => {
          if (!hasReceivedFirstStreamedFile) {
            hasReceivedFirstStreamedFile = true;
          }

          const patchMetadata = getStreamedPatchMetadata(fileText);
          if (patchMetadata != null) {
            streamTreePathPrefix = getPatchTreePathPrefix(
              patchMetadata,
              streamPatchIndex++
            );
          }

          const fileDiff = processFile(fileText, {
            cacheKey: `${cacheKeyPrefix}-0-${accumulator.fileIndex}`,
            isGitDiff: true,
          });
          if (fileDiff == null) {
            return;
          }
          // Re-key on the blob ids parseFile just read out of the patch's
          // `index` line, so the worker pool's highlight cache invalidates when
          // the content changes rather than when the request path does. The
          // positional key above stays as the fallback seed for records with no
          // `index` line, i.e. pure renames.
          fileDiff.cacheKey = contentAddressedCacheKey(
            fileDiff,
            `${cacheKeyPrefix}-0-${accumulator.fileIndex}`
          );

          const itemIdRename = appendFileDiffToHunkyardData(
            accumulator,
            fileDiff,
            streamTreePathPrefix
          );
          if (itemIdRename != null) {
            applyHunkyardItemIdRename(viewerRef.current, itemIdRename);
            if (loadedItemIdsRef.current.delete(itemIdRename.oldId)) {
              loadedItemIdsRef.current.add(itemIdRename.newId);
            }
          }
          pendingPublishFileCount++;
          pendingTreePublishFileCount++;
          const elapsedWork = performance.now() - lastWorkYieldTime;
          if (elapsedWork >= STREAM_WORK_BUDGET_MS) {
            if (shouldDeferInitialPublishForBatchTarget()) {
              await yieldToBrowser();
              lastWorkYieldTime = performance.now();
            } else {
              await publishPendingData();
            }
          } else {
            await publishPendingDataIfNeeded();
          }
          publishTreeSourceIfNeeded();
        };

        const fallbackPatchContent = await streamGitPatchFiles(
          response.body,
          appendStreamedFile
        );
        if (!isCurrentRequest()) {
          return;
        }

        await publishPendingData();
        publishTreeSource();
        if (fallbackPatchContent != null) {
          await commitFullPatch(fallbackPatchContent);
          return;
        }

        setFileByItemId(new Map(accumulator.itemIdToFile));
        setDiffStats({ ...accumulator.diffStats });
        setLoadState('ready');
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }
        setErrorMessage(getPatchLoadErrorMessage(error));
        setLoadState('error');
      }
    }

    void loadPatch();

    return () => {
      controller.abort();
    };
  }, [
    domain,
    getGitHubToken,
    githubTokenVersion,
    loadAttempt,
    onLoadStart,
    patchRequestUrl,
    sendGitHubToken,
    path,
    tryApplyLineHashTarget,
    viewerRef,
  ]);

  useEffect(() => {
    window.addEventListener('hashchange', tryApplyLineHashTarget);
    tryApplyLineHashTarget();
    return () => {
      window.removeEventListener('hashchange', tryApplyLineHashTarget);
    };
  }, [tryApplyLineHashTarget]);

  const retryLoad = useCallback(() => {
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  return {
    applyCollapseModeToLoaded,
    fileByItemId,
    diffStats,
    errorMessage,
    initialItems,
    loadState,
    onLineLinkChange: handleLineLinkChange,
    onViewerReady: tryApplyLineHashTarget,
    retryLoad,
    treeSource,
    viewerKey,
  };
}

function getLineHashApplyKey(viewerKey: number, hash: string): string {
  return `${viewerKey}:${hash}`;
}

function applyHunkyardLineHashTarget(
  viewer: CodeViewHandle<ReviewAnnotationMetadata>,
  target: HunkyardLineHashTarget
): boolean {
  const item = viewer.getItem(target.itemId);
  if (item == null) {
    return false;
  }

  const selectedLines = viewer.getSelectedLines();
  if (
    selectedLines?.id === target.itemId &&
    areSelectionsEqual(selectedLines.range, target.range)
  ) {
    return true;
  }

  if (item.collapsed === true) {
    item.collapsed = false;
    item.version = getNextItemVersion(item);
    if (!viewer.updateItem(item)) {
      return false;
    }
    viewer.getInstance()?.render(true);
  }

  viewer.setSelectedLines({ id: target.itemId, range: target.range });
  viewer.scrollTo({
    type: 'range',
    id: target.itemId,
    range: target.range,
    align: 'center',
    behavior: 'instant',
  });
  return true;
}

function applyHunkyardItemIdRename(
  viewer: CodeViewHandle<ReviewAnnotationMetadata> | null,
  rename: HunkyardItemIdRename
): void {
  viewer?.updateItemId(rename.oldId, rename.newId);
}

function getNextItemVersion(item: { version?: string | number }): number {
  return typeof item.version === 'number' ? item.version + 1 : 1;
}

function createPatchRequestInit(
  signal: AbortSignal,
  token: string | undefined
): RequestInit {
  const normalizedToken = token?.trim();
  if (normalizedToken == null || normalizedToken === '') {
    return { cache: 'no-store', signal };
  }
  return {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${normalizedToken}`,
    },
    signal,
  };
}

function getPatchLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return GENERIC_PATCH_LOAD_ERROR_MESSAGE;
}

function replaceLocationHash(hash: string | null): void {
  const { pathname, search } = window.location;
  const nextHash = hash ?? '';
  if (window.location.hash === nextHash) {
    return;
  }

  window.history.replaceState(
    window.history.state,
    '',
    `${pathname}${search}${nextHash}`
  );
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    let didResolve = false;
    const resolveOnce = () => {
      if (didResolve) {
        return;
      }

      didResolve = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(resolveOnce, 50);
    window.requestAnimationFrame(resolveOnce);
  });
}
