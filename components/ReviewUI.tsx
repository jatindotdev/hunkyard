'use client';

import { type DiffIndicators } from '@pierre/diffs';
import { type CodeViewHandle, useWorkerPool } from '@pierre/diffs/react';
import { type ColorMode } from '@pierre/theming';
import { useThemeController } from '@pierre/theming/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ReviewAnnotationMetadata, Thread } from '@/lib/review/types';
import { boolPref, oneOf, usePersistedState } from './usePersistedState';
import { useViewedFiles } from './useViewedFiles';
import { useReviewKeyboard } from './useReviewKeyboard';
import { KeyboardHelp } from './KeyboardHelp';
import { OpenerOverlay, useOpenerHotkey } from './OpenerOverlay';
import type { ReviewViewerCommands } from './HunkyardViewer';
import { HunkyardHeader } from './HunkyardHeader';
import { HunkyardSidebar } from './HunkyardSidebar';
import { HunkyardStatusPanel } from './HunkyardStatusPanel';
import { HunkyardViewer } from './HunkyardViewer';
import { ThemeSourceProvider } from './ThemeSourceProvider';
import { useGitHubToken } from './useGitHubToken';
import { useLocalDiffWatch } from './useLocalDiffWatch';
import { useReviewThreads } from './useReviewThreads';
import { usePatchLoader } from './usePatchLoader';
import { useThemeCycle } from './useThemeCycle';
import {
  docsThemeCatalog,
  themeController,
} from '@/components/themeController';
import { createGitHubDiffFileLoader } from '@/lib/github/diffFileLoader';
import { createLocalDiffFileLoader } from '@/lib/local/diffFileLoader';
import {
  describeLocalTarget,
  encodeLocalDiffPath,
} from '@/lib/local/diffSource';
import type { DarkThemeName, LightThemeName } from '@/lib/theme/names';
import type {
} from '@/lib/types';

// Where the diff comes from. GitHub is described by a path on a host; a local
// review is described by a git revspec, which is not a path and has no URL to
// open, so the two cannot share one shape.
export type ReviewSource =
  | { kind: 'github'; domain?: string; initialUrl: string; path: string }
  // `repoRoot` is resolved on the server and passed down purely for display;
  // the client never uses it to address anything.
  | {
      kind: 'local';
      target: string | undefined;
      // Which registered repository this review is of. Absent only until the
      // client has learned the default and put it in the URL.
      repoId: string | undefined;
      // Resolved on the server and passed down purely for display; the client
      // never uses it to address anything.
      repoRoot?: string;
    };

interface ReviewUIProps {
  source: ReviewSource;
}

export function ReviewUI({ source }: ReviewUIProps) {
  // Provide the hunkyard-scoped theme context, then render the body BELOW it so
  // the diffs hook + selection hook can read the controller context.
  return (
    <ThemeSourceProvider controller={themeController}>
      <ReviewUIInner source={source} />
    </ThemeSourceProvider>
  );
}

// Every local endpoint takes the same two identifiers: which repository, and
// which target within it.
function localApiQuery(
  target: string | undefined,
  repoId: string | undefined
): URLSearchParams {
  const params = new URLSearchParams();
  if (target != null) params.set('target', target);
  if (repoId != null) params.set('repo', repoId);
  return params;
}

const NARROW_VIEWPORT = '(max-width: 767px)';

function isNarrowViewport(): boolean {
  return window.matchMedia(NARROW_VIEWPORT).matches;
}

function ReviewUIInner({ source }: ReviewUIProps) {
  const isLocal = source.kind === 'local';
  // `path` remains the loader's identity for the request and the fallback cache
  // seed; for a local review that is the canonical /local/<spec> path.
  const repoId = source.kind === 'local' ? source.repoId : undefined;
  const path = isLocal
    ? encodeLocalDiffPath(source.target, repoId)
    : source.path;
  const domain = isLocal ? undefined : source.domain;
  // A local diff has no upstream page, so there is nothing for the header's
  // "open source" link to point at.
  const initialUrl = isLocal ? '' : source.initialUrl;
  const patchRequestUrl = isLocal
    ? `/api/local-diff?${localApiQuery(source.target, repoId)}`
    : `/api/diff?${new URLSearchParams(
        source.domain == null || source.domain === ''
          ? { path: source.path }
          : { path: source.path, domain: source.domain }
      )}`;

  const isWorkerPoolReadyOrDisable = useIsWorkerPoolReadyOrDisabled();
  // Display prefs persist per browser, so a reviewer sets them once rather than
  // on every navigation. Split view is unusable below the mobile breakpoint, so
  // that is the default there -- a default, not a clamp: someone who picks split
  // on a phone keeps it, and picking unified on a desktop is no longer undone
  // the next time the window crosses the breakpoint.
  const [diffStyle, setDiffStyle] = usePersistedState<'split' | 'unified'>(
    'diffStyle',
    isNarrowViewport() ? 'unified' : 'split',
    oneOf(['split', 'unified'] as const)
  );
  const [collapseMode, setCollapseMode] = usePersistedState<
    'expanded' | 'collapsed'
  >('collapseMode', 'expanded', oneOf(['expanded', 'collapsed'] as const));
  const [fileTreeOverlayOpen, setFileTreeOverlayOpen] = useState(false);
  const [overflow, setOverflow] = usePersistedState<'wrap' | 'scroll'>(
    'overflow',
    'scroll',
    oneOf(['wrap', 'scroll'] as const)
  );
  const [showBackgrounds, setShowBackgrounds] = usePersistedState(
    'showBackgrounds',
    true,
    boolPref
  );
  const [diffIndicators, setDiffIndicators] = usePersistedState<DiffIndicators>(
    'diffIndicators',
    'bars',
    oneOf(['classic', 'bars', 'none'] as const)
  );
  const [lineNumbers, setLineNumbers] = usePersistedState(
    'lineNumbers',
    true,
    boolPref
  );
  const {
    clearToken: clearGitHubToken,
    hasToken: hasGitHubToken,
    setToken: setGitHubToken,
    token: githubToken,
    tokenVersion: githubTokenVersion,
  } = useGitHubToken();
  const githubTokenRef = useRef(githubToken);
  const githubTokenVersionRef = useRef(githubTokenVersion);
  useEffect(() => {
    githubTokenRef.current = githubToken;
  }, [githubToken]);
  useEffect(() => {
    githubTokenVersionRef.current = githubTokenVersion;
  }, [githubTokenVersion]);
  const getGitHubToken = useCallback(() => githubTokenRef.current, []);
  // All theming state — color mode and the light/dark theme-name picks — lives
  // in the single @pierre/theming controller (the same instance the app-wide
  // ThemeProvider is bound to). Reading it here means picking Auto/Light/Dark
  // flips both the CodeView's `themeType` and the app's <html> class, and the
  // theme-name picks persist with no separate local state.
  const themeState = useThemeController(themeController);

  // The controller reads persisted values synchronously when its module loads
  // on the client, so useSyncExternalStore would surface them on the very first
  // client render — but the server rendered the defaults. Gate every
  // theme-derived value (rendered into inline chrome styles + the CodeView
  // themeType) behind a client-mounted flag so the first client render matches
  // the SSR markup, then flips to the user's selection. This also keeps the
  // long-lived WorkerPool and the CodeView from mounting against the default
  // palette before the persisted values apply.
  const [themesHydrated, setThemesHydrated] = useState(false);
  useEffect(() => {
    setThemesHydrated(true);
  }, []);

  const colorMode: ColorMode = themesHydrated ? themeState.mode : 'system';
  const appResolvedTheme = themesHydrated
    ? themeState.resolvedColorScheme
    : undefined;
  const lightThemeName = themesHydrated
    ? themeState.lightThemeName
    : docsThemeCatalog.defaultLightThemeName;
  const darkThemeName = themesHydrated
    ? themeState.darkThemeName
    : docsThemeCatalog.defaultDarkThemeName;
  const setColorMode = useCallback((mode: ColorMode) => {
    themeController.setColorMode(mode);
  }, []);
  const setLightThemeName = useCallback((name: LightThemeName) => {
    themeController.setThemeNameForScheme('light', name);
  }, []);
  const setDarkThemeName = useCallback((name: DarkThemeName) => {
    themeController.setThemeNameForScheme('dark', name);
  }, []);
  // The cycle button in the System Monitor sweeps through every Shiki
  // theme so reviewers can preview the full set without manually picking
  // each one. The hook captures the user's current pick when cycling
  // starts so the visible theme anchors the rotation.
  const themeCycle = useThemeCycle({
    lightThemeName,
    darkThemeName,
    resolvedThemeMode: appResolvedTheme,
    setLightThemeName,
    setDarkThemeName,
    setColorMode,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewHandle<ReviewAnnotationMetadata> | null>(null);
  const loadDiffFiles = useMemo(() => {
    // Local expansion reads the repository directly, so it must not be gated on
    // a GitHub token the way the GitHub loader is.
    if (source.kind === 'local') {
      return createLocalDiffFileLoader(source.target, { repoId });
    }
    return domain == null && hasGitHubToken
      ? createGitHubDiffFileLoader(path, {
          getAuthVersion: () => githubTokenVersionRef.current,
          getToken: () => githubTokenRef.current,
        })
      : undefined;
  }, [domain, hasGitHubToken, path, repoId, source]);
  const handlePatchLoadStart = useCallback(() => {
    setFileTreeOverlayOpen(false);
  }, []);
  const {
    applyCollapseModeToLoaded,
    fileByItemId,
    diffStats,
    errorMessage,
    initialItems,
    loadState,
    onLineLinkChange,
    onViewerReady,
    retryLoad,
    treeSource,
    viewerKey,
  } = usePatchLoader({
    collapseMode,
    domain,
    getGitHubToken,
    githubTokenVersion,
    onLoadStart: handlePatchLoadStart,
    path,
    patchRequestUrl,
    sendGitHubToken: !isLocal && (domain == null || domain === ''),
    viewerRef,
  });

  // Review threads, owned here so the diff reloading cannot take them with it.
  const reviewQuery = useMemo(() => {
    if (source.kind === 'local') {
      return localApiQuery(source.target, repoId).toString();
    }
    return new URLSearchParams({ path: source.path }).toString();
  }, [repoId, source]);

  // Viewed state is per review: a pull request and a local target each keep
  // their own progress, so switching between them does not mix the two.
  const viewed = useViewedFiles(
    domain == null || domain === '' ? path : `${domain}${path}`
  );

  const review = useReviewThreads({
    query: reviewQuery,
    // Threads only mean something for a pull request or a local review, and
    // both go through the same endpoints.
    enabled: isLocal || source.kind === 'github',
  });

  // Repository paths and viewer item ids are not interchangeable: ids carry
  // decoration. Both directions come from the accumulator's own map.
  const pathForItemId = useCallback(
    (itemId: string) => fileByItemId?.get(itemId)?.path,
    [fileByItemId]
  );
  const itemIdForPath = useMemo(() => {
    const byPath = new Map<string, string>();
    if (fileByItemId != null) {
      for (const [itemId, file] of fileByItemId) {
        // Later entries win: the accumulator renames the older item when a path
        // repeats, so the undecorated id is the current one.
        byPath.set(file.path, itemId);
      }
    }
    return (path: string) => byPath.get(path);
  }, [fileByItemId]);

  // Reload when the diff on disk changes, holding the scroll position so an
  // edit does not throw the reviewer back to the top of the file list.
  const pendingScrollRef = useRef<number | null>(null);
  const handleLocalChange = useCallback(() => {
    pendingScrollRef.current = scrollRef.current?.scrollTop ?? null;
    retryLoad();
  }, [retryLoad]);

  useLocalDiffWatch({
    enabled: isLocal,
    onChanged: handleLocalChange,
    repoId,
    target: isLocal ? source.target : undefined,
  });

  useEffect(() => {
    const pending = pendingScrollRef.current;
    if (pending == null || loadState !== 'ready') return;
    const element = scrollRef.current;
    if (element == null) return;
    // The viewer virtualizes, so the content has to exist before the offset
    // means anything; a frame after `ready` is enough in practice.
    const frame = requestAnimationFrame(() => {
      element.scrollTop = pending;
      pendingScrollRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [loadState]);

  // The tree overlay only exists below the breakpoint, so widening past it has
  // to close the overlay rather than leave it stranded over the diff.
  useEffect(() => {
    const mediaQuery = window.matchMedia(NARROW_VIEWPORT);
    const handleChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setFileTreeOverlayOpen(false);
    };
    if (!mediaQuery.matches) setFileTreeOverlayOpen(false);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  const handleSelectTreeItem = useCallback((itemId: string) => {
    setFileTreeOverlayOpen(false);
    const viewer = viewerRef.current;
    if (viewer == null) {
      return;
    }
    const item = viewer.getItem(itemId);
    if (item != null && item.collapsed === true) {
      item.collapsed = false;
      item.version = typeof item.version === 'number' ? item.version + 1 : 1;
      viewer.updateItem(item);
    }
    viewer.scrollTo({
      type: 'item',
      id: itemId,
      align: 'start',
      behavior: 'smooth',
    });
  }, []);
  const handleToggleCollapseMode = useCallback(() => {
    const next = collapseMode === 'expanded' ? 'collapsed' : 'expanded';
    setCollapseMode(next);
    applyCollapseModeToLoaded(next);
  }, [applyCollapseModeToLoaded, collapseMode]);
  const handleToggleFileTreeOverlay = useCallback(() => {
    setFileTreeOverlayOpen((open) => !open);
  }, []);
  const handleCloseFileTreeOverlay = useCallback(() => {
    setFileTreeOverlayOpen(false);
  }, []);

  const handleToggleResolved = useCallback(
    (thread: { id: string; resolved: boolean }) => {
      void review.setResolved(thread.id, !thread.resolved);
    },
    [review]
  );

  const handleSelectThread = useCallback(
    (thread: Thread) => {
      setFileTreeOverlayOpen(false);
      const itemId = itemIdForPath(thread.anchor.path);
      // A thread can point at a file that is not in the current diff; there is
      // nothing to scroll to in that case.
      if (itemId == null) return;

      // Expand first: scrolling into a collapsed file lands nowhere. The old
      // comment handler skipped this, which is why clicking a comment in a
      // collapsed file appeared to do nothing.
      const item = viewerRef.current?.getItem(itemId);
      if (item != null && item.collapsed === true) {
        viewerRef.current?.updateItem({ ...item, collapsed: false, version: (item.version ?? 0) + 1 });
      }

      const side = thread.anchor.side === 'LEFT' ? 'deletions' : 'additions';
      const range = {
        start: thread.anchor.startLine ?? thread.anchor.line,
        end: thread.anchor.line,
        side,
        endSide: side,
      } as const;
      viewerRef.current?.setSelectedLines({ id: itemId, range });
      viewerRef.current?.scrollTo({
        type: 'line',
        id: itemId,
        lineNumber: thread.anchor.line,
        side,
        align: 'center',
        behavior: 'smooth-auto',
      });
    },
    [itemIdForPath, viewerRef]
  );

  // The keyboard map. Files come from the loaded items in display order; the
  // thread walk and the submit chord reuse the same handlers the sidebar does,
  // so a shortcut can never drift from what a click would do.
  const viewerCommandsRef = useRef<ReviewViewerCommands | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const { open: openerOpen, setOpen: setOpenerOpen } = useOpenerHotkey();
  const keyboardItemIds = useMemo(
    () => initialItems.map((item) => item.id),
    [initialItems]
  );
  const orderedThreads = useMemo(
    () =>
      [...review.threads].sort((left, right) => {
        const leftIndex = keyboardItemIds.indexOf(
          itemIdForPath(left.anchor.path) ?? ''
        );
        const rightIndex = keyboardItemIds.indexOf(
          itemIdForPath(right.anchor.path) ?? ''
        );
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        return left.anchor.line - right.anchor.line;
      }),
    [itemIdForPath, keyboardItemIds, review.threads]
  );
  const focusedThreadIndexRef = useRef(-1);
  const handleWalkThreads = useCallback(
    (delta: 1 | -1) => {
      if (orderedThreads.length === 0) return;
      const next = Math.min(
        Math.max(focusedThreadIndexRef.current + delta, 0),
        orderedThreads.length - 1
      );
      focusedThreadIndexRef.current = next;
      handleSelectThread(orderedThreads[next]);
    },
    [handleSelectThread, orderedThreads]
  );
  const { focusedItemId } = useReviewKeyboard({
    itemIds: keyboardItemIds,
    focusItem: handleSelectTreeItem,
    toggleViewed: (itemId) => viewerCommandsRef.current?.toggleViewedForItem(itemId),
    startComment: () => viewerCommandsRef.current?.startCommentAtSelection(),
    selectThread: handleWalkThreads,
    // Only a batched review has anything to submit; a local one writes on save.
    submitReview: review.capabilities?.batches
      ? () => handleSubmitReview('COMMENT', '')
      : undefined,
    toggleHelp: () => setHelpOpen((open) => !open),
  });

  const handleSubmitReview = useCallback(
    (event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES', body: string) => {
      void review.submit(event, body.trim() === '' ? undefined : body);
    },
    [review]
  );

  // Withhold the viewer until the persisted themes have been read from
  // localStorage. Otherwise on client-side navigation back into a diff the
  // CodeView would mount during the brief render where lightThemeName/darkThemeName
  // are still at their `DEFAULT_*_THEME` initial values and tokenize the
  // first batch of files against the wrong palette.
  const viewerAvailable =
    isWorkerPoolReadyOrDisable &&
    themesHydrated &&
    (loadState === 'ready' ||
      (loadState === 'streaming' && initialItems.length > 0));

  return (
    <ReviewGrid>
      <HunkyardHeader
        className="[grid-area:header]"
        collapseMode={collapseMode}
        colorMode={colorMode}
        darkThemeName={darkThemeName}
        diffIndicators={diffIndicators}
        diffStyle={diffStyle}
        initialUrl={initialUrl}
        localTarget={isLocal ? describeLocalTarget(source.target) : undefined}
        localRepoRoot={source.kind === 'local' ? source.repoRoot : undefined}
        onOpenSearch={() => setOpenerOpen(true)}
        lightThemeName={lightThemeName}
        lineNumbers={lineNumbers}
        overflow={overflow}
        fileTreeOverlayOpen={fileTreeOverlayOpen}
        fileTreeAvailable={treeSource != null}
        githubTokenActive={hasGitHubToken}
        onClearGitHubToken={clearGitHubToken}
        onSaveGitHubToken={setGitHubToken}
        onToggleCollapseMode={handleToggleCollapseMode}
        onToggleFileTreeOverlay={handleToggleFileTreeOverlay}
        setColorMode={setColorMode}
        setDarkThemeName={setDarkThemeName}
        setDiffIndicators={setDiffIndicators}
        setDiffStyle={setDiffStyle}
        setLightThemeName={setLightThemeName}
        setLineNumbers={setLineNumbers}
        setOverflow={setOverflow}
        setShowBackgrounds={setShowBackgrounds}
        showBackgrounds={showBackgrounds}
      />
      {viewerAvailable && treeSource != null ? (
        <>
          <HunkyardSidebar
            viewedCount={viewed.viewedPaths.size}
            focusedPath={
              focusedItemId == null ? undefined : pathForItemId(focusedItemId)
            }
            className="[grid-area:viewer] md:[grid-area:tree]"
            threads={review.threads}
            reviewBusy={review.busy}
            onSubmitReview={
              // Only offered when the store batches. A local review writes
              // through, so a submit button would imply something it does not do.
              review.capabilities?.batches === true
                ? handleSubmitReview
                : undefined
            }
            diffStats={diffStats}
            mobileOverlayOpen={fileTreeOverlayOpen}
            onMobileClose={handleCloseFileTreeOverlay}
            onSelectThread={handleSelectThread}
            scrollRef={scrollRef}
            source={treeSource}
            streaming={loadState === 'streaming'}
            themeCycle={themeCycle}
            viewerRef={viewerRef}
            onSelectItem={handleSelectTreeItem}
          />
          <HunkyardViewer
            commandsRef={viewerCommandsRef}
            isViewedAt={viewed.isViewedAt}
            onToggleViewed={viewed.setViewed}
            onReconcileViewed={viewed.reconcile}
            key={viewerKey}
            className="[grid-area:viewer]"
            diffStyle={diffStyle}
            overflow={overflow}
            showBackgrounds={showBackgrounds}
            diffIndicators={diffIndicators}
            lineNumbers={lineNumbers}
            scrollRef={scrollRef}
            themeType={colorMode}
            viewerRef={viewerRef}
            initialItems={initialItems}
            loadDiffFiles={loadDiffFiles}
            threads={review.threads}
            drafts={review.drafts}
            author={review.capabilities?.author ?? 'you'}
            canResolve={review.capabilities?.supportsResolve ?? false}
            busy={review.busy}
            itemIdForPath={itemIdForPath}
            pathForItemId={pathForItemId}
            headCommitId={review.capabilities?.headCommitId ?? 'HEAD'}
            onStartDraft={review.startDraft}
            onUpdateDraft={review.updateDraft}
            onDiscardDraft={review.discardDraft}
            onSaveDraft={review.saveDraft}
            onRemoveComment={review.removeComment}
            onToggleResolved={handleToggleResolved}
            onLineLinkChange={onLineLinkChange}
            onViewerReady={onViewerReady}
          />
        </>
      ) : (
        <HunkyardStatusPanel
          awaitingHighlighter={
            // The patch is in hand and the tree is built; the only thing left
            // is the worker pool. Common for a local diff, which arrives in
            // milliseconds.
            loadState === 'ready' &&
            treeSource != null &&
            !isWorkerPoolReadyOrDisable
          }
          errorMessage={errorMessage}
          isLocal={isLocal}
          onRetry={retryLoad}
          state={loadState}
        />
      )}
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <OpenerOverlay
        open={openerOpen}
        onClose={() => setOpenerOpen(false)}
        repoId={source.kind === 'local' ? source.repoId : undefined}
      />
    </ReviewGrid>
  );
}

function useIsWorkerPoolReadyOrDisabled() {
  const workerPool = useWorkerPool();
  const [isReady, setIsReady] = useState(
    () => workerPool?.isInitialized() ?? true
  );
  const isReadyRef = useRef(isReady);
  useEffect(() => {
    // The callback will always be fired immediately with the new state, so we
    // don't need to check for it in the effect
    return workerPool?.subscribeToStatChanges((stats) => {
      const isReady = stats.managerState === 'initialized';
      if (isReady !== isReadyRef.current) {
        setIsReady(isReady);
        isReadyRef.current = isReady;
      }
    });
  }, [workerPool]);
  return isReady;
}

interface ReviewGridProps {
  children: ReactNode;
}

function ReviewGrid({ children }: ReviewGridProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden overscroll-contain contain-strict [grid-template-areas:'header''viewer'] md:grid-cols-[320px_minmax(0,1fr)] md:[grid-template-areas:'header_header''tree_viewer']">
      {children}
    </div>
  );
}
