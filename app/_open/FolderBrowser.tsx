'use client';

import {
  IconArrowLeftBar,
  IconBranch,
  IconChevron,
  IconFolder,
  IconSearch,
} from '@pierre/icons';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useDirectoryListing } from '@/components/useDirectoryListing';
import { usePersistedState, boolPref } from '@/components/usePersistedState';
import { useRepos } from '@/components/useRepos';
import { cn } from '@/lib/cn';
import { browseCrumbs } from '@/lib/fs/browseCrumbs';
import { encodeOpenerHref } from '@/lib/openerRoute';
import { useRouter } from '@/src/navigation';

// A deep path is mostly middle. The ends are what tell you where you are.
const CRUMB_HEAD = 1;
const CRUMB_TAIL = 3;

interface Crumb {
  name: string;
  path: string;
}

export function collapseCrumbs(
  crumbs: readonly Crumb[]
): (Crumb | { ellipsis: true })[] {
  if (crumbs.length <= CRUMB_HEAD + CRUMB_TAIL + 1) return [...crumbs];
  return [
    ...crumbs.slice(0, CRUMB_HEAD),
    { ellipsis: true } as const,
    ...crumbs.slice(-CRUMB_TAIL),
  ];
}

export function FolderBrowser({ path }: { path: string }) {
  const router = useRouter();
  const { open } = useRepos();
  const [filter, setFilter] = useState('');
  const [hidden, setHidden] = usePersistedState('browse.hidden', false, boolPref);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const { listing, loading, error } = useDirectoryListing(path, {
    filter,
    hidden,
  });

  // Stepping into a folder replaces rather than pushes: Back should move
  // between reviews, not retrace every folder on the way here.
  const enter = (next: string) => {
    setFilter('');
    setActive(0);
    router.replace(encodeOpenerHref({ kind: 'browse', path: next }));
  };

  // Committing a repository is a push, and one round trip both opens it and
  // remembers it: the reply carries the id the review URL needs.
  const openRepository = (root: string) => {
    setOpening(true);
    setOpenError(null);
    void open(root)
      .then((repo) =>
        router.push(encodeOpenerHref({ kind: 'targets', repoId: repo.id }))
      )
      .catch((thrown: unknown) => {
        setOpenError(thrown instanceof Error ? thrown.message : 'Failed to open.');
      })
      .finally(() => setOpening(false));
  };

  const entries = listing?.entries ?? [];
  useEffect(() => {
    if (active >= entries.length) setActive(Math.max(0, entries.length - 1));
  }, [active, entries.length]);

  const crumbs = useMemo(
    () => collapseCrumbs(browseCrumbs(listing?.path ?? path)),
    [listing?.path, path]
  );

  // Scoped to this component rather than a window listener, so it cannot
  // collide with the viewer's own keyboard map.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, entries.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const entry = entries[active];
      if (entry != null) {
        event.preventDefault();
        if (entry.isRepository) openRepository(entry.path);
        else enter(entry.path);
      }
    } else if (event.key === 'Backspace' && filter === '') {
      if (listing?.parent != null) {
        event.preventDefault();
        enter(listing.parent);
      }
    }
  };

  const primary = resolvePrimaryAction(listing);

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <nav
        aria-label="Path"
        className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-0.5 font-mono text-xs"
      >
        {crumbs.map((crumb, index) =>
          'ellipsis' in crumb ? (
            <span key="ellipsis" className="px-1 opacity-50">
              …
            </span>
          ) : (
            <span key={crumb.path} className="flex items-center">
              {index > 0 && <IconChevron className="size-3 -rotate-90 opacity-30" />}
              <button
                type="button"
                className="hover:text-foreground rounded px-1 py-0.5"
                onClick={() => enter(crumb.path)}
              >
                {crumb.name}
              </button>
            </span>
          )
        )}
      </nav>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-md"
          aria-label="Up one folder"
          disabled={listing?.parent == null}
          onClick={() => listing?.parent != null && enter(listing.parent)}
        >
          <IconArrowLeftBar className="size-4" />
        </Button>
        <div className="relative flex-1">
          <IconSearch className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 opacity-60" />
          <Input
            autoFocus
            inputSize="sm"
            className="pl-8"
            placeholder="Filter this folder"
            value={filter}
            onChange={(event) => {
              setFilter(event.currentTarget.value);
              setActive(0);
            }}
          />
        </div>
        <Button
          type="button"
          variant={hidden ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={hidden}
          onClick={() => setHidden(!hidden)}
        >
          Hidden
        </Button>
      </div>

      {error != null ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          {error}
        </p>
      ) : (
        <ul
          ref={listRef}
          className={cn(
            'border-border divide-border max-h-[52vh] divide-y overflow-y-auto rounded-lg border',
            loading && 'opacity-60'
          )}
        >
          {entries.length === 0 && !loading && (
            <li className="text-muted-foreground p-4 text-sm">
              No folders here.
            </li>
          )}
          {entries.map((entry, index) => (
            <li key={entry.path}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  index === active ? 'bg-accent' : 'hover:bg-accent/50'
                )}
                onMouseEnter={() => setActive(index)}
                onClick={() =>
                  entry.isRepository ? openRepository(entry.path) : enter(entry.path)
                }
              >
                <IconFolder className="size-4 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.isRepository && (
                  <span className="text-muted-foreground flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase">
                    <IconBranch className="size-3" />
                    git
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {listing?.truncated === true && (
        <p className="text-muted-foreground text-xs">
          Only the first 500 folders are shown. Filter to reach the rest.
        </p>
      )}
      {listing?.probeIncomplete === true && (
        <p className="text-muted-foreground text-xs">
          This folder was slow to read, so some of it is not marked as a
          repository even if it is. Open it to find out.
        </p>
      )}
      {openError != null && (
        <p className="text-destructive text-xs">{openError}</p>
      )}

      <div className="bg-[var(--diffshub-sidebar-bg)] sticky bottom-0 flex items-center justify-between gap-3 border-t py-3">
        <span className="text-muted-foreground min-w-0 truncate text-xs">
          {primary.note}
        </span>
        <Button
          type="button"
          disabled={primary.root == null || opening}
          onClick={() => primary.root != null && openRepository(primary.root)}
        >
          {opening ? 'Opening…' : primary.label}
        </Button>
      </div>
    </div>
  );
}

interface PrimaryAction {
  label: string;
  note: string;
  root: string | null;
}

// Three states, because the folder you are standing in is as likely to be
// inside a checkout as to be one.
export function resolvePrimaryAction(
  listing: {
    path: string;
    isRepository: boolean;
    enclosingRepository: string | null;
  } | null
): PrimaryAction {
  if (listing == null) {
    return { label: 'Open this folder', note: '', root: null };
  }
  if (listing.isRepository) {
    return {
      label: 'Open this folder',
      note: 'This folder is a git repository.',
      root: listing.path,
    };
  }
  if (listing.enclosingRepository != null) {
    return {
      label: 'Open the repository',
      note: `Inside ${listing.enclosingRepository}.`,
      root: listing.enclosingRepository,
    };
  }
  return {
    label: 'Open this folder',
    note: 'No repository here. Keep browsing.',
    root: null,
  };
}
