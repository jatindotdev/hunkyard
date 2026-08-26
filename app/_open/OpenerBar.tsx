'use client';

import {
  IconBranch,
  IconBrandGithub,
  IconCommit,
  IconFolder,
  IconSearch,
  IconTag,
  IconX,
} from '@pierre/icons';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useDirectoryListing } from '@/components/useDirectoryListing';
import { useRepoSurvey } from '@/components/useRepoSurvey';
import { useRepos } from '@/components/useRepos';
import { cn } from '@/lib/cn';
import { classifyQuery, baseName, splitPathQuery } from '@/lib/openerSearch';
import { useRouter } from '@/src/navigation';

import {
  flattenRows,
  scopedSections,
  unscopedSections,
  type OpenerRow,
  type OpenerSection,
} from './openerResults';

const ICONS = {
  repo: IconFolder,
  folder: IconFolder,
  github: IconBrandGithub,
  diff: IconCommit,
  branch: IconBranch,
  commit: IconCommit,
  tag: IconTag,
} as const;

interface OpenerBarProps {
  // The repository everything is narrowed to, if one is chosen. Kept in the URL
  // so a scoped opener is a link like any other page.
  repoId?: string;
  onScope(repoId: string | undefined): void;
}

// One field for everything the opener used to be: a URL box, a list of
// repositories, and a folder browser, each with its own way in and its own way
// back. Typing decides which of them you meant.
export function OpenerBar({ repoId, onScope }: OpenerBarProps) {
  const router = useRouter();
  const { repos, home, open } = useRepos();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const classified = useMemo(() => classifyQuery(query, home), [query, home]);

  // Only fetched while a path is being typed, so an empty box costs nothing.
  const pathQuery = classified.kind === 'path' ? splitPathQuery(classified.path) : null;
  const { listing } = useDirectoryListing(pathQuery?.dir, {
    filter: pathQuery?.filter ?? '',
  });

  const { survey } = useRepoSurvey(repoId, ['refs', 'status', 'commits']);
  const scopedRepo = repos.find((repo) => repo.id === repoId);

  const sections: OpenerSection[] = useMemo(() => {
    if (repoId != null) {
      return scopedSections({
        repoId,
        survey,
        text: classified.kind === 'empty' ? '' : query.trim(),
      });
    }
    return unscopedSections({
      query: classified,
      repos,
      listing,
      pathFilter: pathQuery?.filter ?? '',
      home,
    });
  }, [repoId, survey, classified, query, repos, listing, pathQuery?.filter, home]);

  const rows = useMemo(() => flattenRows(sections), [sections]);

  useEffect(() => {
    setActive(0);
  }, [query, repoId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [repoId]);

  const choose = (row: OpenerRow | undefined) => {
    if (row == null) return;
    setError(null);

    switch (row.action.kind) {
      case 'navigate':
        router.push(row.action.href);
        return;
      case 'browse':
        // Descending replaces what you typed rather than navigating, so the
        // field is always the whole state and there is nowhere to go "back" to.
        setQuery(`${row.action.path}/`);
        inputRef.current?.focus();
        return;
      case 'scope':
        onScope(row.action.repoId);
        setQuery('');
        return;
      case 'open': {
        const path = row.action.path;
        setOpening(true);
        void open(path)
          .then((repo) => {
            onScope(repo.id);
            setQuery('');
          })
          .catch((thrown: unknown) => {
            setError(thrown instanceof Error ? thrown.message : 'Could not open it.');
          })
          .finally(() => setOpening(false));
        return;
      }
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(rows[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (query !== '') setQuery('');
      else if (repoId != null) onScope(undefined);
    } else if (event.key === 'Backspace' && query === '' && repoId != null) {
      // Backspacing past the start of an empty field removes the chip, which is
      // the same gesture as deleting the last thing you typed.
      event.preventDefault();
      onScope(undefined);
    }
  };

  const placeholder =
    repoId != null
      ? 'A branch, a commit, or a revision'
      : 'A repository, a path, or a pull request';

  return (
    <div className="flex w-full flex-col gap-3">
      <div
        className={cn(
          'bg-background/80 focus-within:border-ring/60 rounded-2xl border shadow-2xl backdrop-blur transition-colors',
          'focus-within:ring-ring/10 focus-within:ring-4'
        )}
      >
        <div className="flex items-center gap-2.5 px-4 py-3.5">
          <IconSearch className="text-muted-foreground size-4 shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            className="placeholder:text-muted-foreground/70 min-w-0 flex-1 bg-transparent text-base outline-none"
          />
          {opening && (
            <span className="text-muted-foreground text-xs">opening…</span>
          )}
        </div>

        {scopedRepo != null && (
          <div className="flex items-center gap-2 px-4 pb-3">
            <button
              type="button"
              onClick={() => onScope(undefined)}
              className="bg-accent/70 hover:bg-accent flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors"
              title="Search everything again"
            >
              <IconFolder className="size-3 opacity-60" />
              {baseName(scopedRepo.root)}
              <IconX className="size-3 opacity-50" />
            </button>
            <span className="text-muted-foreground truncate text-xs">
              searching inside this repository
            </span>
          </div>
        )}
      </div>

      {error != null && <p className="text-destructive px-1 text-xs">{error}</p>}

      <Results
        sections={sections}
        rows={rows}
        active={active}
        onHover={setActive}
        onChoose={choose}
      />

      {rows.length === 0 && query.trim() !== '' && (
        <p className="text-muted-foreground px-1 text-sm">
          Nothing matches. Paths start with <code>/</code> or <code>~</code>;
          pull requests look like <code>owner/repo#123</code>.
        </p>
      )}
    </div>
  );
}

function Results({
  sections,
  rows,
  active,
  onHover,
  onChoose,
}: {
  sections: readonly OpenerSection[];
  rows: readonly OpenerRow[];
  active: number;
  onHover(index: number): void;
  onChoose(row: OpenerRow): void;
}) {
  if (rows.length === 0) return null;

  let index = -1;
  return (
    <div className="border-border bg-background/60 max-h-[52vh] overflow-y-auto rounded-xl border">
      {sections.map((section) => (
        <div key={section.label}>
          <div className="text-muted-foreground px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
            {section.label}
          </div>
          {section.rows.map((row) => {
            index += 1;
            const at = index;
            const Icon = ICONS[row.icon];
            return (
              <button
                key={row.id}
                type="button"
                onMouseEnter={() => onHover(at)}
                onClick={() => onChoose(row)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                  at === active ? 'bg-accent' : 'hover:bg-accent/40'
                )}
              >
                <Icon className="size-4 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{row.title}</span>
                  {row.detail != null && row.detail !== '' && (
                    <span className="text-muted-foreground block truncate text-xs">
                      {row.detail}
                    </span>
                  )}
                </span>
                {row.badge != null && (
                  <span className="text-muted-foreground shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px]">
                    {row.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
