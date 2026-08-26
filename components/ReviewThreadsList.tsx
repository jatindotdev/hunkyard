'use client';

import { IconConvoFill } from '@pierre/icons';
import { memo, type MouseEvent } from 'react';

import { CommentAuthorAvatar } from './CommentAuthorAvatar';
import { cn } from '@/lib/cn';
import type { Thread, ThreadSide } from '@/lib/review/types';

interface ReviewThreadsListProps {
  threads: readonly Thread[];
  onSelectThread(thread: Thread): void;
}

function lineLabel(thread: Thread): string {
  const { anchor } = thread;
  const sigil = anchor.side === 'RIGHT' ? '+' : '-';
  return anchor.startLine == null || anchor.startLine === anchor.line
    ? `Line ${sigil}${anchor.line}`
    : `Lines ${sigil}${anchor.startLine}–${anchor.line}`;
}

function lineClassName(side: ThreadSide): string {
  // The themed chrome sets --hunkyard-comment-add-fg / -del-fg from the active
  // Shiki surface's luminance, so these stay legible on mixed palettes where a
  // plain `dark:` variant would leave low-contrast shades on a dark card. The
  // Tailwind values are fallbacks for the first render before chrome applies.
  return side === 'RIGHT'
    ? 'text-[var(--hunkyard-comment-add-fg,#047857)] dark:text-[var(--hunkyard-comment-add-fg,#34d399)]'
    : 'text-[var(--hunkyard-comment-del-fg,#be123c)] dark:text-[var(--hunkyard-comment-del-fg,#fb7185)]';
}

// Lets a drag-selection inside a row finish without also navigating. mouseup
// after selecting fires click on the button, so bail out only when the
// selection is anchored in this row -- a selection elsewhere on the page must
// not block activating it.
function handleRowClick(
  event: MouseEvent<HTMLButtonElement>,
  run: () => void
): void {
  const selection = window.getSelection();
  if (
    selection != null &&
    !selection.isCollapsed &&
    selection.anchorNode != null &&
    event.currentTarget.contains(selection.anchorNode)
  ) {
    return;
  }
  run();
}

function groupByPath(
  threads: readonly Thread[]
): { path: string; threads: Thread[] }[] {
  const byPath = new Map<string, Thread[]>();
  for (const thread of threads) {
    const existing = byPath.get(thread.anchor.path);
    if (existing == null) byPath.set(thread.anchor.path, [thread]);
    else existing.push(thread);
  }
  return [...byPath.entries()]
    .map(([path, group]) => ({
      path,
      threads: [...group].sort((a, b) => a.anchor.line - b.anchor.line),
    }))
    // Alphabetical by path: `fileOrder` from the accumulator is only valid
    // within one load, so it cannot order a persisted list.
    .sort((a, b) => a.path.localeCompare(b.path));
}

export const ReviewThreadsList = memo(function ReviewThreadsList({
  threads,
  onSelectThread,
}: ReviewThreadsListProps) {
  if (threads.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center">
        <IconConvoFill className="size-5 opacity-50" />
        <p className="text-sm">No comments yet</p>
        <p className="text-xs text-pretty">
          Hover a line in the diff and use the gutter button to start one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-2 py-2">
      {groupByPath(threads).map((group) => (
        <section key={group.path} className="flex flex-col gap-1">
          <h3 className="text-muted-foreground truncate px-1 font-mono text-[11px]">
            {group.path}
          </h3>
          {group.threads.map((thread) => {
            const first = thread.comments[0];
            const replies = thread.comments.length - 1;
            return (
              <button
                key={thread.id}
                type="button"
                className="hover:bg-accent/60 flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors"
                onClick={(event) =>
                  handleRowClick(event, () => onSelectThread(thread))
                }
              >
                <CommentAuthorAvatar
                  author={first?.author ?? { login: 'you' }}
                  className="size-5"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[11px]">
                    <span className={lineClassName(thread.anchor.side)}>
                      {lineLabel(thread)}
                    </span>
                    {replies > 0 && (
                      <span className="text-muted-foreground">
                        {replies} {replies === 1 ? 'reply' : 'replies'}
                      </span>
                    )}
                    {thread.resolved && (
                      <span className="text-muted-foreground rounded border px-1">
                        Resolved
                      </span>
                    )}
                    {thread.outdated && (
                      <span className="text-muted-foreground rounded border px-1">
                        Outdated
                      </span>
                    )}
                    {first?.pending === true && (
                      <span className="text-muted-foreground rounded border px-1">
                        Not sent
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 block truncate text-[13px]',
                      thread.resolved && 'text-muted-foreground line-through'
                    )}
                  >
                    {first?.body ?? ''}
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
});
