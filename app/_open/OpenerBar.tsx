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

// Fixed rather than generated: there is one opener on screen at a time, and a
// stable id is what `aria-activedescendant` needs to point at.
const LIST_ID = 'opener-results';
const ERROR_ID = 'opener-error';

function rowId(index: number): string {
  return `opener-row-${index}`;
}

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
  // Called once a row has taken you somewhere, so a host that is floating over
  // something can get out of the way.
  onNavigate?(): void;
}

// One field for everything the opener used to be: a URL box, a list of
// repositories, and a folder browser, each with its own way in and its own way
// back. Typing decides which of them you meant.
export function OpenerBar({ repoId, onScope, onNavigate }: OpenerBarProps) {
  const router = useRouter();
  const { repos, home, open } = useRepos();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Scrolling on hover would fight the mouse that caused the change, so only a
  // keyboard move asks for the row to be brought into view.
  const byKeyboard = useRef(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const classified = useMemo(() => classifyQuery(query, home), [query, home]);

  // Only fetched while a path is being typed, so an empty box costs nothing.
  const pathQuery = classified.kind === 'path' ? splitPathQuery(classified.path) : null;
  const { listing, loading: listingLoading, error: listingError } =
    useDirectoryListing(pathQuery?.dir, { filter: pathQuery?.filter ?? '' });

  const {
    survey,
    loading: surveyLoading,
    error: surveyError,
    unknownRepo,
  } = useRepoSurvey(repoId, ['refs', 'status', 'commits']);
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

  // Every one of these was being discarded, so a repository that had not
  // finished being read looked like a repository with nothing in it, and a
  // browse that failed outright looked the same.
  const status: string | null = unknownRepo
    ? 'That repository is not on your list any more.'
    : (surveyError ?? listingError ?? null);
  const busy =
    status == null &&
    sections.length === 0 &&
    ((repoId != null && surveyLoading) ||
      (classified.kind === 'path' && listingLoading));

  useEffect(() => {
    setActive(0);
  }, [query, repoId]);

  useEffect(() => {
    if (!byKeyboard.current) return;
    byKeyboard.current = false;
    // `nearest` scrolls the least it can, and only when the row is actually
    // outside the list -- moving between two visible rows should not move
    // anything else.
    document
      .querySelector(`[data-opener-row="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [repoId]);

  const choose = (row: OpenerRow | undefined) => {
    if (row == null) return;
    setError(null);

    switch (row.action.kind) {
      case 'navigate':
        router.push(row.action.href);
        onNavigate?.();
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
      byKeyboard.current = true;
      setActive((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      byKeyboard.current = true;
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
    <div
      className={cn(
        // One object, not a field with a list floating under it. A palette that
        // comes apart into two cards reads as two things to aim at.
        'bg-background overflow-hidden rounded-xl border shadow-2xl',
        // A hairline of light along the edge, so the panel reads as raised
        // rather than as a hole cut in the backdrop.
        'ring-1 ring-white/8 dark:ring-white/10',
        'focus-within:border-ring/50'
      )}
    >
      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <IconSearch className="text-muted-foreground size-4 shrink-0" />
        {scopedRepo != null && (
          // Before the text, not after it. Backspace deletes leftwards, so a
          // token sitting to the right of the cursor does not read as something
          // backspace would remove -- which is exactly what it is.
          <button
            type="button"
            onClick={() => onScope(undefined)}
            className="bg-accent hover:bg-accent/70 text-foreground/90 flex shrink-0 items-center gap-1.5 rounded-md py-1 pr-1.5 pl-2 text-xs transition-colors"
            title="Search everything again"
          >
            <IconFolder className="size-3 opacity-60" />
            {baseName(scopedRepo.root)}
            <IconX className="size-3 opacity-50" />
          </button>
        )}
        {/* A combobox in behaviour since it was written; this is it saying so.
            Without the wiring a screen reader hears a bare text field, is never
            told a list of results exists, and hears nothing at all as the arrow
            keys move through it. */}
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-label={placeholder}
          aria-expanded={rows.length > 0}
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={
            rows.length > 0 ? rowId(active) : undefined
          }
          aria-describedby={error != null ? ERROR_ID : undefined}
          aria-invalid={error != null || undefined}
          className="text-foreground placeholder:text-muted-foreground/70 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
        {opening && (
          <span className="text-muted-foreground text-xs">opening…</span>
        )}
      </div>

      {error != null && (
        <p
          id={ERROR_ID}
          role="alert"
          className="text-destructive border-t px-4 py-2 text-xs"
        >
          {error}
        </p>
      )}

      {sections.length > 0 && (
        <div
          id={LIST_ID}
          role="listbox"
          aria-label="Results"
          className="max-h-[52vh] overflow-y-auto border-t py-1"
        >
          <Results
            sections={sections}
            rows={rows}
            active={active}
            onHover={setActive}
            onChoose={choose}
          />
        </div>
      )}

      {sections.length === 0 && status == null && !busy && (
        <p className="text-muted-foreground border-t px-4 py-3 text-sm">
          {query.trim() !== '' ? (
            <>
              Nothing matches. Paths start with <code>/</code> or{' '}
              <code>~</code>; pull requests look like{' '}
              <code>owner/repo#123</code>.
            </>
          ) : repoId != null ? (
            <>Nothing to review in this repository yet.</>
          ) : (
            // First run: nothing opened, nothing typed. Previously a bare box
            // with no rows and no way to know what it wanted.
            <>
              Nothing opened yet. Type a path like <code>~/dev</code> to find a
              repository, or paste a pull request.
            </>
          )}
        </p>
      )}

      {busy && (
        <p className="text-muted-foreground border-t px-4 py-3 text-sm">
          Reading the repository…
        </p>
      )}

      {status != null && (
        <p role="status" className="text-muted-foreground border-t px-4 py-3 text-sm">
          {status}
        </p>
      )}

      <div className="text-muted-foreground flex items-center gap-3 border-t px-4 py-2 text-[11px]">
        <Hint keys="↑↓" label="move" />
        <Hint keys="↵" label={enterLabel(rows[active])} />
        {/* Whichever gesture is actually available: backspace only removes the
            repository once there is nothing left to delete before it. */}
        {scopedRepo != null && query === '' ? (
          <Hint keys="⌫" label="leave this repository" />
        ) : (
          <Hint keys="esc" label="clear" />
        )}
      </div>
    </div>
  );
}

// What Enter would do to the row under the cursor, rather than a guess at what
// most rows do.
function enterLabel(row: OpenerRow | undefined): string {
  switch (row?.action.kind) {
    case 'browse':
      return 'open folder';
    case 'open':
      return 'open repository';
    case 'scope':
      return 'search inside';
    default:
      return 'review';
  }
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="bg-accent/60 rounded px-1.5 py-0.5 font-sans text-[10px]">
        {keys}
      </kbd>
      {label}
    </span>
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
  if (sections.length === 0) return null;

  let index = -1;
  return (
    <>
      {sections.map((section) => (
        <div key={section.label}>
          <div className="text-muted-foreground/80 px-4 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
            {section.label}
          </div>
          {section.note != null && (
            <p className="text-muted-foreground px-4 py-1.5 text-sm">
              {section.note}
            </p>
          )}
          {section.rows.map((row) => {
            index += 1;
            const at = index;
            const Icon = ICONS[row.icon];
            return (
              <button
                key={row.id}
                id={rowId(at)}
                type="button"
                role="option"
                aria-selected={at === active}
                // Out of the tab order: the field keeps focus and moves the
                // selection with the arrow keys, so a Tab stop per row would be
                // ten invisible stops fighting that.
                tabIndex={-1}
                data-opener-row={at}
                onMouseEnter={() => onHover(at)}
                onClick={() => onChoose(row)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2 text-left',
                  at === active && 'bg-accent'
                )}
              >
                <Icon
                  className={cn(
                    'size-4 shrink-0',
                    at === active ? 'opacity-90' : 'opacity-60'
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm">
                    {row.title}
                  </span>
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
    </>
  );
}
