'use client';

import { IconCheck, IconX } from '@pierre/icons';
import { memo } from 'react';

import { Button } from '@/components/Button';
import { CommentAuthorAvatar } from '@/components/CommentAuthorAvatar';
import { annotationCardBase } from '@/lib/annotation';
import { cn } from '@/lib/cn';
import type { Thread } from '@/lib/review/types';

interface ThreadAnnotationProps {
  thread: Thread;
  canResolve: boolean;
  onReply(thread: Thread): void;
  onRemove(threadId: string, commentId: string): void;
  onToggleResolved(thread: Thread): void;
}

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// A review thread rendered inline in the diff: every comment, not just one.
export const ThreadAnnotation = memo(function ThreadAnnotation({
  thread,
  canResolve,
  onReply,
  onRemove,
  onToggleResolved,
}: ThreadAnnotationProps) {
  return (
    <div className={cn(annotationCardBase, 'flex-col gap-3')}>
      {(thread.resolved || thread.outdated) && (
        <div className="flex items-center gap-2 text-[11px]">
          {thread.resolved && (
            <span className="text-muted-foreground rounded border px-1.5 py-0.5">
              Resolved
            </span>
          )}
          {thread.outdated && (
            // The lines this was written against are no longer in the diff.
            // Shown rather than hidden, because a stale comment is information.
            <span className="text-muted-foreground rounded border px-1.5 py-0.5">
              Outdated
            </span>
          )}
        </div>
      )}

      {thread.comments.map((comment) => (
        <div key={comment.id} className="flex gap-2.5">
          <CommentAuthorAvatar author={comment.author} className="size-6" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <strong className="text-[13px]">{comment.author.login}</strong>
              <span className="text-muted-foreground text-[11px]">
                {relative(comment.createdAt)}
              </span>
              {comment.pending && (
                // Queued locally, not yet sent. GitHub has no way to add to a
                // pending review incrementally, so this state is ours.
                <span className="text-muted-foreground rounded border px-1 text-[10px]">
                  Not sent
                </span>
              )}
              <button
                type="button"
                aria-label="Delete comment"
                title="Delete comment"
                className="text-muted-foreground hover:text-foreground ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => onRemove(thread.id, comment.id)}
              >
                <IconX className="size-3" />
              </button>
            </div>
            <p className="mt-1 text-[13px] whitespace-pre-wrap">{comment.body}</p>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => onReply(thread)}>
          Reply
        </Button>
        {canResolve && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onToggleResolved(thread)}
          >
            <IconCheck className="mr-1 size-3" />
            {thread.resolved ? 'Unresolve' : 'Resolve'}
          </Button>
        )}
      </div>
    </div>
  );
});
