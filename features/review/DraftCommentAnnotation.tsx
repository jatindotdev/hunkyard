'use client';

import { IconArrow } from '@pierre/icons';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/ui/Button';
import { annotationCardBase } from './annotation';
import { cn } from '@/lib/cn';
import type { DraftComment } from './useReviewThreads';

interface DraftCommentAnnotationProps {
  draft: DraftComment;
  author: string;
  busy: boolean;
  onChange(draftId: string, body: string): void;
  onDiscard(draftId: string): void;
  onSave(draftId: string): void;
}

export function DraftCommentAnnotation({
  draft,
  author,
  busy,
  onChange,
  onDiscard,
  onSave,
}: DraftCommentAnnotationProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The text is owned here rather than read back from the draft store. The
  // library renders an annotation only when the item's annotation list changes,
  // and a keystroke changes neither the metadata nor the list -- deliberately, so
  // typing does not re-tokenize the diff. Reading `draft.body` for `value` would
  // therefore pin the textarea to whatever it held when the annotation was last
  // rendered, which is the empty string.
  const [body, setBody] = useState(draft.body);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea == null) return;
    // preventScroll matters: focusing inside a virtualized list otherwise
    // yanks the viewport.
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const canSave = body.trim() !== '' && !busy;

  return (
    <form
      className={cn(annotationCardBase, 'flex-col gap-2')}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSave(draft.id);
      }}
    >
      <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
        <span>
          {draft.replyToThreadId == null ? 'New comment' : 'Reply'} as{' '}
          <strong className="text-foreground font-medium">{author}</strong>
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        rows={3}
        placeholder="Leave a comment"
        className="bg-background/60 min-h-16 w-full resize-y rounded-md border p-2 font-sans text-[13px] outline-none focus-visible:ring-1"
        onChange={(event) => {
          setBody(event.target.value);
          // The store still needs every keystroke: saving reads the body from
          // there, and the queue count is derived from it.
          onChange(draft.id, event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            // No confirm dialog: several drafts can be open at once now, so a
            // modal per draft would be worse than losing a line of text. The
            // text stays until the draft is explicitly discarded anyway.
            onDiscard(draft.id);
            return;
          }
          // Cmd/Ctrl+Enter submits and plain Enter newlines, which is the
          // convention everywhere else. Upstream had Shift+Enter submitting,
          // which is inverted from every other comment box.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (canSave) onSave(draft.id);
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onDiscard(draft.id)}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSave}>
          <IconArrow className="mr-1 size-3" />
          Comment
        </Button>
      </div>
    </form>
  );
}
