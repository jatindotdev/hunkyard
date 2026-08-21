'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ReviewKeyboardActions {
  // The files in display order. j/k walk this list.
  itemIds: readonly string[];
  focusItem(itemId: string): void;
  toggleViewed(itemId: string): void;
  startComment(): void;
  selectThread(delta: 1 | -1): void;
  submitReview?(): void;
  toggleHelp(): void;
}

// A shortcut must not fire while the reviewer is writing a comment. The draft
// editor lives inside the diff's shadow DOM, so `event.target` is the shadow
// host rather than the textarea -- composedPath is the only way to see what is
// really focused.
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isTypingTarget(event: KeyboardEvent): boolean {
  for (const node of event.composedPath()) {
    // Duck-typed rather than `instanceof HTMLElement`: a composed path also
    // carries ShadowRoot, Document and Window entries, and an element from
    // another realm fails an instanceof check against this realm's constructor.
    const candidate = node as Partial<HTMLElement> | null;
    if (candidate == null || typeof candidate.tagName !== 'string') continue;
    if (candidate.isContentEditable === true) return true;
    if (TEXT_ENTRY_TAGS.has(candidate.tagName)) return true;
  }
  return false;
}

// The single-key review shortcuts. Held apart from the viewer so the keys act on
// the same state the sidebar and the header do, rather than on whatever the
// CodeView happens to have focused.
export function useReviewKeyboard(actions: ReviewKeyboardActions): {
  focusedItemId: string | undefined;
} {
  const [focusedItemId, setFocusedItemId] = useState<string | undefined>();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const focusedRef = useRef(focusedItemId);
  focusedRef.current = focusedItemId;

  const moveFocus = useCallback((delta: 1 | -1) => {
    const { itemIds, focusItem } = actionsRef.current;
    if (itemIds.length === 0) return;
    const current = focusedRef.current;
    const index = current == null ? -1 : itemIds.indexOf(current);
    // Nothing focused yet: `j` starts at the first file and `k` at the last, so
    // both keys do something visible on first press.
    const next =
      index === -1
        ? delta === 1
          ? 0
          : itemIds.length - 1
        : Math.min(Math.max(index + delta, 0), itemIds.length - 1);
    const itemId = itemIds[next];
    setFocusedItemId(itemId);
    focusItem(itemId);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const current = actionsRef.current;

      // Submit is the one chord, and it has to work from inside the summary box,
      // so it is checked before the typing guard.
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        if (current.submitReview == null) return;
        event.preventDefault();
        current.submitReview();
        return;
      }

      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if (isTypingTarget(event)) return;

      switch (event.key) {
        case 'j':
          event.preventDefault();
          moveFocus(1);
          return;
        case 'k':
          event.preventDefault();
          moveFocus(-1);
          return;
        case 'v': {
          const itemId = focusedRef.current;
          if (itemId == null) return;
          event.preventDefault();
          current.toggleViewed(itemId);
          return;
        }
        case 'c':
          event.preventDefault();
          current.startComment();
          return;
        case 'n':
          event.preventDefault();
          current.selectThread(1);
          return;
        case 'p':
          event.preventDefault();
          current.selectThread(-1);
          return;
        case '?':
          event.preventDefault();
          current.toggleHelp();
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moveFocus]);

  // A file can leave the review between renders (a reload, a changed target), so
  // a focus pointing at nothing has to clear rather than strand j/k.
  useEffect(() => {
    if (focusedItemId == null) return;
    if (!actions.itemIds.includes(focusedItemId)) setFocusedItemId(undefined);
  }, [actions.itemIds, focusedItemId]);

  return { focusedItemId };
}
