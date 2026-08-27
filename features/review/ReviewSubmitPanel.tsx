'use client';

import { IconCheck, IconCiWarningFill, IconConvoFill } from '@pierre/icons';
import { useState } from 'react';

import { Button } from '@/ui/Button';
import { cn } from '@/lib/cn';

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

interface ReviewSubmitPanelProps {
  className?: string;
  // How many comments are queued and not yet sent.
  pendingCount: number;
  busy: boolean;
  onSubmit(event: ReviewEvent, body: string): void;
}

const EVENTS: { value: ReviewEvent; label: string; hint: string }[] = [
  { value: 'COMMENT', label: 'Comment', hint: 'Leave notes without a verdict' },
  { value: 'APPROVE', label: 'Approve', hint: 'Sign off on these changes' },
  {
    value: 'REQUEST_CHANGES',
    label: 'Request changes',
    hint: 'Block until these are addressed',
  },
];

// Sends everything queued as one review.
//
// Only shown for a source that batches. A local review writes straight through,
// so there is nothing to submit and offering a button would imply otherwise.
export function ReviewSubmitPanel({
  className,
  pendingCount,
  busy,
  onSubmit,
}: ReviewSubmitPanelProps) {
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [body, setBody] = useState('');

  // An approval with no comments is a legitimate review; a plain comment with
  // neither queued comments nor a summary is not.
  const canSubmit =
    !busy && (event !== 'COMMENT' || pendingCount > 0 || body.trim() !== '');

  return (
    <section
      className={cn('border-border flex flex-col gap-2 border-t p-3', className)}
    >
      <header className="flex items-center gap-2 text-[11px]">
        <IconConvoFill className="size-3 opacity-60" />
        <span className="font-medium">Submit review</span>
        <span className="text-muted-foreground ml-auto">
          {pendingCount === 0
            ? 'nothing queued'
            : `${pendingCount} comment${pendingCount === 1 ? '' : 's'} queued`}
        </span>
      </header>

      <textarea
        value={body}
        rows={2}
        placeholder="Summary (optional)"
        className="bg-background/60 min-h-12 w-full resize-y rounded-md border p-2 font-sans text-[13px] outline-none focus-visible:ring-1"
        onChange={(changeEvent) => setBody(changeEvent.target.value)}
      />

      <div role="radiogroup" aria-label="Review verdict" className="flex flex-col gap-0.5">
        {EVENTS.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px]',
              event === option.value ? 'bg-accent/70' : 'hover:bg-accent/40'
            )}
          >
            <input
              type="radio"
              name="review-event"
              className="size-3"
              checked={event === option.value}
              onChange={() => setEvent(option.value)}
            />
            <span className="font-medium">{option.label}</span>
            <span className="text-muted-foreground truncate text-[11px]">
              {option.hint}
            </span>
          </label>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        disabled={!canSubmit}
        className="w-full"
        onClick={() => {
          onSubmit(event, body);
          setBody('');
        }}
      >
        {event === 'REQUEST_CHANGES' ? (
          <IconCiWarningFill className="mr-1 size-3" />
        ) : (
          <IconCheck className="mr-1 size-3" />
        )}
        {busy ? 'Submitting…' : 'Submit'}
      </Button>
    </section>
  );
}
