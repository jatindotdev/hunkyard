'use client';

import { useEffect, type RefObject } from 'react';

// Focus for something that claims to be a modal.
//
// `aria-modal="true"` is a claim, not a mechanism: it tells a screen reader
// that everything behind is unavailable, and both dialogs here were saying so
// while Tab walked straight out into the page underneath. This is the part that
// makes the claim true -- focus moves in, stays in, and goes back where it came
// from.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // A control inside a collapsed or hidden branch is in the DOM and not
    // reachable, and cycling onto it would strand focus somewhere invisible.
    (element) => element.offsetParent != null || element === document.activeElement
  );
}

export function useDialogFocus(
  open: boolean,
  container: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    if (!open) return;
    const root = container.current;
    if (root == null) return;

    // Captured before anything moves, and restored on the way out: leaving a
    // dialog should put you back where you opened it from, not at the top of
    // the document.
    const previous = document.activeElement as HTMLElement | null;

    // A text field first, wherever it sits in the markup. Taking the first
    // focusable instead means whichever control happens to be earliest in the
    // DOM wins -- in the opener that is the repository chip, which stole focus
    // from the field the dialog exists to type into.
    const focusable = focusableWithin(root);
    const field = focusable.find(
      (element) =>
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
    );
    (field ?? focusable[0] ?? root).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = focusableWithin(root);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      const active = document.activeElement;

      // Only the two edges are handled. Everything between them is the
      // browser's own tab order, which is better than any order recomputed
      // here.
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!root.contains(active)) {
        // Focus escaped some other way -- a click on the page behind, a
        // programmatic move. Bring it back rather than letting Tab continue
        // from outside.
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Only if focus is still inside: if something else has legitimately taken
      // it since, stealing it back would be the ruder move.
      if (root.contains(document.activeElement)) {
        previous?.focus?.({ preventScroll: true });
      }
    };
  }, [open, container]);
}
