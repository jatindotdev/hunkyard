import {
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewLineSelection,
  type CodeViewOptions,
  type DiffIndicators,
  type DiffLineAnnotation,
  type FileDiffContentsLoader,
  type LineAnnotation,
  type SelectedLineRange,
  type ThemeTypes,
} from '@pierre/diffs';
import { type CodeViewHandle, useStableCallback } from '@pierre/diffs/react';
import { IconChevronSm } from '@pierre/icons';
import {
  memo,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ThemedCodeView } from './ThemedCodeView';
import { useChromeThemeProps } from './useChromeThemeProps';
import { buildAnnotationThemeStyle } from '@/lib/annotationThemeStyle';
import { cn } from '@/lib/cn';
import { CODE_VIEW_CUSTOM_CSS, CODE_VIEW_LAYOUT } from '@/lib/constants';
import { isDiffItem } from '@/lib/isDiffItem';
import { DraftCommentAnnotation } from './DraftCommentAnnotation';
import { ThreadAnnotation } from './ThreadAnnotation';
import type { DraftComment } from './useReviewThreads';
import {
  areAnnotationsEqual,
  projectAnnotations,
} from '@/lib/review/project';
import { anchorFromSelection } from '@/lib/review/types';
import type {
  ReviewAnnotationMetadata,
  Thread,
  ThreadAnchor,
} from '@/lib/review/types';
import { diffshubChromeMapping } from '@/lib/theme/diffshubChromeMapping';
import {
  classifyNonTextFile,
  describeNonTextFile,
} from '@/lib/nonTextFile';

function getNextItemVersion(item: CodeViewItem<ReviewAnnotationMetadata>): number {
  return typeof item.version === 'number' ? item.version + 1 : 1;
}

function updateViewerDiffItem(
  viewer: CodeViewHandle<ReviewAnnotationMetadata>,
  itemId: string,
  updateItem: (item: CodeViewDiffItem<ReviewAnnotationMetadata>) => boolean
): CodeViewDiffItem<ReviewAnnotationMetadata> | undefined {
  const item = viewer.getItem(itemId);
  if (item == null || !isDiffItem(item)) {
    return undefined;
  }

  if (!updateItem(item)) {
    return undefined;
  }

  item.version = getNextItemVersion(item);
  return viewer.updateItem(item) ? item : undefined;
}

interface DiffsHubViewerProps {
  className?: string;
  diffStyle: 'split' | 'unified';
  // Review state, owned by ReviewUI. The viewer renders it and reports
  // intentions back; it holds no comment state of its own, which is what stops
  // a reload from destroying comments.
  threads: readonly Thread[];
  drafts: readonly DraftComment[];
  author: string;
  canResolve: boolean;
  busy: boolean;
  // Resolves a repository path to the item showing it. Item ids carry
  // decoration, so this cannot be computed from the path.
  itemIdForPath(path: string): string | undefined;
  pathForItemId(itemId: string): string | undefined;
  headCommitId: string;
  onStartDraft(anchor: ThreadAnchor, replyToThreadId?: string): void;
  onUpdateDraft(draftId: string, body: string): void;
  onDiscardDraft(draftId: string): void;
  onSaveDraft(draftId: string): void;
  onRemoveComment(threadId: string, commentId: string): void;
  onToggleResolved(thread: Thread): void;
  overflow: 'wrap' | 'scroll';
  showBackgrounds: boolean;
  diffIndicators: DiffIndicators;
  lineNumbers: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  themeType: ThemeTypes;
  viewerRef: RefObject<CodeViewHandle<ReviewAnnotationMetadata> | null>;
  initialItems: CodeViewItem<ReviewAnnotationMetadata>[];
  loadDiffFiles?: FileDiffContentsLoader;
  onLineLinkChange(selection: CodeViewLineSelection | null): void;
  onViewerReady(): void;
}

export const DiffsHubViewer = memo(function DiffsHubViewer({
  className,
  diffStyle,
  threads,
  drafts,
  author,
  canResolve,
  busy,
  itemIdForPath,
  pathForItemId,
  headCommitId,
  onStartDraft,
  onUpdateDraft,
  onDiscardDraft,
  onSaveDraft,
  onRemoveComment,
  onToggleResolved,
  overflow,
  showBackgrounds,
  diffIndicators,
  lineNumbers,
  scrollRef,
  themeType,
  viewerRef,
  initialItems,
  loadDiffFiles,
  onLineLinkChange,
  onViewerReady,
}: DiffsHubViewerProps) {

  const [selectedLines, setSelectedLines] =
    useState<CodeViewLineSelection | null>(null);
  const { style: chromeStyle } = useChromeThemeProps(diffshubChromeMapping);
  // Preserve the previous `undefined`-means-not-resolved contract that
  // buildAnnotationThemeStyle and the className fallbacks depend on.
  const themeChromeStyle =
    Object.keys(chromeStyle).length > 0 ? chromeStyle : undefined;
  const annotationThemeStyle = useMemo(
    () => buildAnnotationThemeStyle(themeChromeStyle),
    [themeChromeStyle]
  );

  const handleSetSelection = useStableCallback(
    (selection: CodeViewLineSelection | null) => {
      setSelectedLines(selection);
    }
  );

  // Reports the current line selection up so the URL permalink can follow it.
  // Unrelated to comments: selecting lines and commenting are separate gestures.
  const handleLineSelectionEnd = useStableCallback(
    (
      range: SelectedLineRange | null,
      item: CodeViewItem<ReviewAnnotationMetadata>
    ) => {
      onLineLinkChange(range == null ? null : { id: item.id, range });
    }
  );

  const handleViewerRef = useStableCallback(
    (viewer: CodeViewHandle<ReviewAnnotationMetadata> | null) => {
      viewerRef.current = viewer;
      if (viewer != null) {
        onViewerReady();
      }
    }
  );

  // Items that currently carry annotations, so one that loses them all can be
  // cleared rather than keeping a deleted thread on screen.
  const annotatedItemsRef = useRef<Set<string>>(new Set());

  // Annotations are a projection of review state, so they are recomputed and
  // applied whenever that state changes rather than mutated by the handlers.
  // Only items whose annotations actually differ are updated: CodeView requires
  // a version bump per update, and bumping everything on each keystroke would
  // re-tokenize the whole diff.
  const projected = useMemo(
    () => projectAnnotations(threads, drafts, itemIdForPath),
    [drafts, itemIdForPath, threads]
  );

  useEffect(() => {
    const { current: viewer } = viewerRef;
    if (viewer == null) return;

    const touched = new Set<string>();
    for (const [itemId, annotations] of projected) {
      touched.add(itemId);
      updateViewerDiffItem(viewer, itemId, (item) => {
        if (areAnnotationsEqual(item.annotations, annotations)) return false;
        item.annotations = annotations;
        return true;
      });
    }

    // An item that had annotations and no longer does needs clearing, or a
    // deleted thread would stay on screen.
    for (const itemId of annotatedItemsRef.current) {
      if (touched.has(itemId)) continue;
      updateViewerDiffItem(viewer, itemId, (item) => {
        if (areAnnotationsEqual(item.annotations, [])) return false;
        item.annotations = [];
        return true;
      });
    }
    annotatedItemsRef.current = touched;
  }, [projected, viewerRef]);

  const handleStartDraft = useStableCallback(
    (range: SelectedLineRange, itemId: string) => {
      const path = pathForItemId(itemId);
      // Without a path there is nothing to anchor to, and guessing one from the
      // item id would be wrong for a decorated id.
      if (path == null) return;
      onStartDraft(anchorFromSelection(range, path, headCommitId));
    }
  );

  const handleReply = useStableCallback((thread: Thread) => {
    onStartDraft(thread.anchor, thread.id);
  });

  const handleToggleItemCollapsed = useStableCallback((itemId: string) => {
    const { current: viewerHandle } = viewerRef;
    const viewer = viewerHandle?.getInstance();
    const item = viewerHandle?.getItem(itemId);
    if (viewerHandle == null || viewer == null || item == null) {
      return;
    }

    // NOTE(amadeus): If the top of the item is before the scrollTop, then
    // we'll want to apply a scroll fix on the next render to ensure we
    // keep the collapsed file in view and anchored.
    const itemTop = viewer.getTopForItem(itemId);
    item.collapsed = item.collapsed !== true;
    item.version = getNextItemVersion(item);
    if (!viewerHandle.updateItem(item)) {
      return;
    }

    if (itemTop != null && itemTop < viewer.getScrollTop()) {
      viewer.scrollTo({
        type: 'item',
        id: item.id,
        align: 'start',
      });
    }
  });

  const renderReviewAnnotation = useStableCallback(
    (
      annotation:
        | DiffLineAnnotation<ReviewAnnotationMetadata>
        | LineAnnotation<ReviewAnnotationMetadata>,
      item: CodeViewItem<ReviewAnnotationMetadata>
    ) => {
      // The library hands over either annotation shape; only a diff annotation
      // has a side, and only a diff item can hold one.
      if (!('side' in annotation) || item.type !== 'diff') return null;

      const { metadata } = annotation;
      if (metadata.kind === 'draft') {
        const draft = drafts.find((candidate) => candidate.id === metadata.draftId);
        if (draft == null) return null;
        return (
          <DraftCommentAnnotation
            draft={draft}
            author={author}
            busy={busy}
            onChange={onUpdateDraft}
            onDiscard={onDiscardDraft}
            onSave={onSaveDraft}
          />
        );
      }

      const thread = threads.find((candidate) => candidate.id === metadata.threadId);
      if (thread == null) return null;
      return (
        <ThreadAnnotation
          thread={thread}
          canResolve={canResolve}
          onReply={handleReply}
          onRemove={onRemoveComment}
          onToggleResolved={onToggleResolved}
        />
      );
    }
  );

  // A binary or zero-byte file parses to no hunks, so without this it renders
  // as an empty card that looks like a failure. @pierre/diffs has no binary
  // handling of its own, so the explanation has to come from here.
  const renderHeaderMetadata = useStableCallback(
    (item: CodeViewItem<ReviewAnnotationMetadata>) => {
      if (item.type !== 'diff') return null;
      const reason = classifyNonTextFile(item.fileDiff);
      if (reason == null) return null;
      return (
        <span
          className="text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none"
          title={
            reason === 'empty'
              ? 'This file has no contents, so there is nothing to diff.'
              : 'Binary files have no line-by-line diff.'
          }
        >
          {describeNonTextFile(reason)}
        </span>
      );
    }
  );

  const renderHeaderPrefix = useStableCallback(
    (item: CodeViewItem<ReviewAnnotationMetadata>) => {
      if (item.type !== 'diff') {
        return null;
      }

      return (
        <CollapseDiffButton
          disabled={
            item.fileDiff.splitLineCount === 0 &&
            item.fileDiff.unifiedLineCount === 0
          }
          collapsed={item.collapsed}
          onToggle={() => handleToggleItemCollapsed(item.id)}
        />
      );
    }
  );

  // NOTE(amadeus): For some insane reason, the react compiler did not know how
  // to properly memoize this, so we pulled it into a `useMemo` for safety...
  const options: CodeViewOptions<ReviewAnnotationMetadata> = useMemo(
    () =>
      ({
        // Use this to validate itemMetrics when changing layout with unsafeCSS.
        // __devOnlyValidateItemHeights: true,
        layout: CODE_VIEW_LAYOUT,
        themeType,
        diffStyle,
        diffIndicators,
        overflow,
        loadDiffFiles,
        disableBackground: !showBackgrounds,
        disableLineNumbers: !lineNumbers,
        lineHoverHighlight: 'number',
        // hunkSeparators: 'line-info-basic',
        enableLineSelection: true,
        enableGutterUtility: true,
        stickyHeaders: true,
        unsafeCSS: CODE_VIEW_CUSTOM_CSS,
        // FIXME(amadeus): Move all `onX` methods onto the react component maybe?
        onGutterUtilityClick(range, context) {
          if (context.item.type !== 'diff') {
            return;
          }
          handleStartDraft(range, context.item.id);
        },
        onLineSelectionEnd(range, context) {
          handleLineSelectionEnd(range, context.item);
        },
      }) satisfies CodeViewOptions<ReviewAnnotationMetadata>,
    [
      diffIndicators,
      diffStyle,
      handleStartDraft,
      handleLineSelectionEnd,
      lineNumbers,
      loadDiffFiles,
      overflow,
      showBackgrounds,
      themeType,
    ]
  );
  return (
    <ThemedCodeView<ReviewAnnotationMetadata>
      ref={handleViewerRef}
      containerRef={scrollRef}
      initialItems={initialItems}
      className={cn(
        className,
        'cv-scrollbar relative h-full min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain border-b border-border w-full [contain:strict] [overflow-anchor:none] [will-change:scroll-position] md:border-b-0 [&_diffs-container]:overflow-clip [&_diffs-container]:[contain:layout_paint_style] [&_diffs-container]:shadow-[0_-1px_0_var(--diffshub-diff-separator,var(--color-border-opaque)),0_1px_0_var(--diffshub-diff-separator,var(--color-border-opaque))]'
      )}
      options={options}
      style={annotationThemeStyle}
      selectedLines={selectedLines}
      onSelectedLinesChange={handleSetSelection}
      renderAnnotation={renderReviewAnnotation}
      renderHeaderMetadata={renderHeaderMetadata}
      renderHeaderPrefix={renderHeaderPrefix}
    />
  );
});

interface CollapseDiffButtonProps {
  disabled?: boolean;
  collapsed?: boolean;
  onToggle(): void;
}

function CollapseDiffButton({
  disabled = false,
  collapsed = false,
  onToggle,
}: CollapseDiffButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-expanded={!disabled && !collapsed}
      aria-hidden={disabled}
      aria-label={
        disabled ? undefined : collapsed ? 'Expand diff' : 'Collapse diff'
      }
      className="text-muted-foreground hover:bg-muted hover:text-foreground ml-[-8px] inline-flex size-6 cursor-pointer items-center justify-center rounded-md transition disabled:pointer-events-none disabled:opacity-50"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <IconChevronSm
        aria-hidden="true"
        className={cn(
          'size-4 transition-transform',
          (disabled || collapsed) && '-rotate-90'
        )}
      />
    </button>
  );
}
