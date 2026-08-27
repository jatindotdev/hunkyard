'use client';

import { useEffect, useRef } from 'react';

import { Button } from './Button';
import { useDialogFocus } from './useDialogFocus';
import { cn } from '@/lib/cn';
import { DEVTOOLS_ENABLED } from '@/lib/devtools';

interface Shortcut {
  keys: readonly string[];
  description: string;
}

const SHORTCUTS: readonly { group: string; shortcuts: readonly Shortcut[] }[] = [
  {
    group: 'Files',
    shortcuts: [
      { keys: ['j'], description: 'Next file' },
      { keys: ['k'], description: 'Previous file' },
      { keys: ['v'], description: 'Mark the current file viewed' },
    ],
  },
  {
    group: 'Review',
    shortcuts: [
      { keys: ['c'], description: 'Comment on the selected lines' },
      { keys: ['n'], description: 'Next comment thread' },
      { keys: ['p'], description: 'Previous comment thread' },
      { keys: ['⌘', '↵'], description: 'Submit the review' },
    ],
  },
  {
    group: 'Panels',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Open something else' },
      { keys: ['F2'], description: 'Diff stats' },
      // F3 opens the worker-pool monitor, which only renders under
      // DEVTOOLS_ENABLED. Listing it unconditionally advertised a key that does
      // nothing in a release build.
      ...(DEVTOOLS_ENABLED
        ? [{ keys: ['F3'], description: 'System monitor' }]
        : []),
      { keys: ['?'], description: 'This list' },
    ],
  },
];

interface KeyboardHelpProps {
  open: boolean;
  onClose(): void;
}

export function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(open, panel);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(0_0_0_/_0.4)] p-4 font-sans"
      onClick={onClose}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="bg-card text-card-foreground max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-xl border p-4 shadow-lg outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Keyboard shortcuts</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {SHORTCUTS.map(({ group, shortcuts }) => (
            <div key={group}>
              <h3 className="text-muted-foreground mb-1 text-[11px] uppercase tracking-wide">
                {group}
              </h3>
              <ul className="flex flex-col gap-1">
                {shortcuts.map(({ keys, description }) => (
                  <li
                    key={description}
                    className="flex items-center justify-between gap-4 text-xs"
                  >
                    <span>{description}</span>
                    <span className="flex gap-1">
                      {keys.map((key) => (
                        <kbd
                          key={key}
                          className={cn(
                            'bg-muted min-w-5 rounded border px-1.5 py-0.5 text-center font-mono text-[11px] leading-none'
                          )}
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
