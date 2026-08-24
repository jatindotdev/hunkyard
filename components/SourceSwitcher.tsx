'use client';

import { IconChevronSm, IconFolderOpen, IconSearch } from '@pierre/icons';
import { type CSSProperties, useEffect, useState } from 'react';

import { CHROME_ICON_BUTTON_CLASS } from './chromeButtonStyles';
import { DiffUrlForm } from './DiffUrlForm';
import { LocalTargetLabel } from './LocalTargetLabel';
import { useRepos } from './useRepos';
import { useRepoSurvey } from './useRepoSurvey';
import { Button } from '@/components/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/DropdownMenu';
import { cn } from '@/lib/cn';
import { encodeLocalDiffPath } from '@/lib/localDiffSource';
import { suggestReviewTargets } from '@/lib/local/repoSurvey';
import { encodeOpenerHref } from '@/lib/openerRoute';
import { useRouter } from '@/src/navigation';

interface SourceSwitcherProps {
  className?: string;
  dropdownStyle?: CSSProperties;
  initialUrl: string;
  // Set for a local review: what is being reviewed, and where.
  localTarget?: string;
  localRepoRoot?: string;
  localRepoId?: string;
  onUrlChange(url: string): void;
}

// Changing what you are reviewing without going back to the opener.
//
// A dropdown rather than a command palette: Radix already gives arrow keys,
// typeahead and focus return, where a palette would add a focus trap, a second
// overlay order, and a third interaction with the two sharp edges in
// useReviewKeyboard.
export function SourceSwitcher({
  className,
  dropdownStyle,
  initialUrl,
  localTarget,
  localRepoRoot,
  localRepoId,
  onUrlChange,
}: SourceSwitcherProps) {
  const [open, setOpen] = useState(false);

  // The review shortcuts bail on a modifier, so this cannot collide with them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        {localTarget == null ? (
          <>
            <DiffUrlForm
              className="min-w-0"
              initialUrl={initialUrl}
              onUrlChange={onUrlChange}
              placeholder="owner/repo#123, or a URL"
              inputClassName="w-full md:w-auto"
            />
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-md"
                aria-label="Switch what you are reviewing"
                title="Switch what you are reviewing (⌘K)"
                className={CHROME_ICON_BUTTON_CLASS}
              >
                <IconChevronSm className="size-4 md:size-3" />
              </Button>
            </DropdownMenuTrigger>
          </>
        ) : (
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Switch what you are reviewing (⌘K)"
              className="hover:bg-accent/50 flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1"
            >
              <LocalTargetLabel repoRoot={localRepoRoot} target={localTarget} />
              <IconChevronSm className="size-3 shrink-0 opacity-50" />
            </button>
          </DropdownMenuTrigger>
        )}

        <DropdownMenuContent
          align="start"
          className="max-h-[70vh] w-80 overflow-y-auto"
          style={dropdownStyle}
        >
          <SourceSwitcherMenu repoId={localRepoId} open={open} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SourceSwitcherMenu({
  repoId,
  open,
}: {
  repoId: string | undefined;
  open: boolean;
}) {
  const router = useRouter();
  const { repos, home } = useRepos();

  return (
    <>
      {/* Mounted only while the menu is open, so a review page does not pay
          for a survey nobody asked to see. */}
      {open && repoId != null && (
        <TargetMenuItems
          repoId={repoId}
          onPick={(spec) => router.push(encodeLocalDiffPath(spec, repoId))}
        />
      )}

      {repos.filter((repo) => repo.id !== repoId).length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Recent repositories</DropdownMenuLabel>
          {repos
            .filter((repo) => repo.id !== repoId)
            .map((repo) => (
              <DropdownMenuItem
                key={repo.id}
                onSelect={() =>
                  router.push(
                    encodeOpenerHref({ kind: 'targets', repoId: repo.id })
                  )
                }
              >
                <span className="truncate">{repo.root.split('/').at(-1)}</span>
              </DropdownMenuItem>
            ))}
        </>
      )}

      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="flex items-center gap-2"
        onSelect={() =>
          router.push(encodeOpenerHref({ kind: 'browse', path: home ?? '/' }))
        }
      >
        <IconSearch className="size-3.5 opacity-60" />
        Browse for a repository…
      </DropdownMenuItem>
      <DropdownMenuItem
        className="flex items-center gap-2"
        onSelect={() => router.push('/')}
      >
        <IconFolderOpen className="size-3.5 opacity-60" />
        Open something else
      </DropdownMenuItem>
    </>
  );
}

// The same suggestions the picker page shows, so the two surfaces cannot drift.
function TargetMenuItems({
  repoId,
  onPick,
}: {
  repoId: string;
  onPick(spec: string | undefined): void;
}) {
  const { survey } = useRepoSurvey(repoId, ['refs', 'status']);
  if (survey == null) {
    return (
      <DropdownMenuLabel className="text-muted-foreground">
        Reading the repository…
      </DropdownMenuLabel>
    );
  }

  return (
    <>
      <DropdownMenuLabel>In this repository</DropdownMenuLabel>
      {suggestReviewTargets(survey).map((target) => (
        <DropdownMenuItem key={target.title} onSelect={() => onPick(target.spec)}>
          <span className="min-w-0 flex-1 truncate">{target.title}</span>
          {target.count != null && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {target.count}
            </span>
          )}
        </DropdownMenuItem>
      ))}
    </>
  );
}
