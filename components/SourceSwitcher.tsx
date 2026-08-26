'use client';

import { IconChevronSm } from '@pierre/icons';

import { CHROME_ICON_BUTTON_CLASS } from './chromeButtonStyles';
import { DiffUrlForm } from './DiffUrlForm';
import { LocalTargetLabel } from './LocalTargetLabel';
import { Button } from '@/components/Button';
import { cn } from '@/lib/cn';

interface SourceSwitcherProps {
  className?: string;
  initialUrl: string;
  // Set for a local review: what is being reviewed, and where.
  localTarget?: string;
  localRepoRoot?: string;
  onUrlChange(url: string): void;
  // Opens the opener over this review.
  onOpenSearch(): void;
}

// What you are looking at, and the way to look at something else.
//
// The way to look at something else is the opener itself, over the top, rather
// than a menu here listing some of the same things -- two surfaces answering the
// same question drift, and the one that used to live here had less in it.
export function SourceSwitcher({
  className,
  initialUrl,
  localTarget,
  localRepoRoot,
  onUrlChange,
  onOpenSearch,
}: SourceSwitcherProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      {localTarget == null ? (
        <>
          <DiffUrlForm
            className="min-w-0"
            initialUrl={initialUrl}
            onUrlChange={onUrlChange}
            placeholder="owner/repo#123, or a URL"
            inputClassName="w-full md:w-auto"
          />
          <Button
            variant="ghost"
            size="icon-md"
            aria-label="Open something else"
            title="Open something else (⌘K)"
            className={CHROME_ICON_BUTTON_CLASS}
            onClick={onOpenSearch}
          >
            <IconChevronSm className="size-4 md:size-3" />
          </Button>
        </>
      ) : (
        <button
          type="button"
          title="Open something else (⌘K)"
          onClick={onOpenSearch}
          className="hover:bg-accent/50 flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1"
        >
          <LocalTargetLabel repoRoot={localRepoRoot} target={localTarget} />
          <IconChevronSm className="size-3 shrink-0 opacity-50" />
        </button>
      )}
    </div>
  );
}
