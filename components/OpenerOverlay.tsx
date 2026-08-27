'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDialogFocus } from './useDialogFocus';

import { OpenerBar } from '@/app/_open/OpenerBar';

// The opener, over whatever you are already looking at.
//
// It is the same field the home page is, rather than a menu that lists some of
// the same things: two surfaces answering "what do you want to review" would
// drift, and the one that lived in the header already had less in it.
//
// Deliberately not wrapped in the diff surface's chrome theme. That theme is
// derived from the syntax colours and its `--color-foreground` is the muted one
// code is written in -- applied here it silently turned every label in the
// panel mid-grey. This is app chrome and uses the app's own tokens.
export function OpenerOverlay({
  open,
  onClose,
  repoId,
}: {
  open: boolean;
  onClose(): void;
  // Where to start narrowed, when opened from inside a local review.
  repoId?: string;
}) {
  // Scope is local here rather than in the URL: the URL belongs to the review
  // underneath, which is still there when this closes.
  const [scoped, setScoped] = useState<string | undefined>(repoId);
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(open, panel);

  useEffect(() => {
    if (open) setScoped(repoId);
  }, [open, repoId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Only when the field has nothing left to clear, which it handles
        // itself; this is the outermost step of the same gesture.
        const input = document.querySelector<HTMLInputElement>(
          '[data-opener-overlay] input'
        );
        if (input != null && input.value !== '') return;
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-opener-overlay
      role="dialog"
      aria-modal="true"
      aria-label="Open something to review"
      className="hunkyard-scrim fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-5 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        // Only the backdrop, so a drag that ends outside the panel does not
        // close it mid-selection.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={panel} className="hunkyard-palette-enter w-full max-w-2xl">
        <OpenerBar repoId={scoped} onScope={setScoped} onNavigate={onClose} />
      </div>
    </div>,
    document.body
  );
}

// ⌘K, from anywhere. Held here rather than in the overlay so the listener does
// not depend on the overlay being mounted.
export function useOpenerHotkey(): {
  open: boolean;
  setOpen(open: boolean): void;
} {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((current) => !current), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return { open, setOpen };
}
