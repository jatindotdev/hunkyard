'use client';

import { IconTrash } from '@pierre/icons';
import { useState } from 'react';

import { Button } from '@/components/Button';
import { useRepos, type KnownRepo } from '@/components/useRepos';
import { encodeOpenerHref } from '@/lib/openerRoute';
import { Link } from '@/src/navigation';

function repoName(root: string): string {
  const segments = root.split('/').filter((segment) => segment !== '');
  return segments[segments.length - 1] ?? root;
}

// A path is worth more than the folder name when two checkouts share one, but
// the home prefix is the same on every row and says nothing.
function shorten(root: string, home: string | null): string {
  return home != null && root.startsWith(`${home}/`)
    ? `~/${root.slice(home.length + 1)}`
    : root;
}

interface RecentReposListProps {
  // Every row is a link, so the list works before the browser is ever opened.
  home?: string | null;
  emptyMessage?: string;
}

export function RecentReposList({
  home = null,
  emptyMessage = 'Nothing yet. Browse for a repository, or run hunk inside one.',
}: RecentReposListProps) {
  const { repos, loading, error, forget } = useRepos();
  const [forgetting, setForgetting] = useState<string | null>(null);

  if (loading && repos.length === 0) {
    return <p className="text-muted-foreground text-sm">Reading your list…</p>;
  }
  if (error != null && repos.length === 0) {
    return <p className="text-muted-foreground text-sm">{error}</p>;
  }
  if (repos.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }

  return (
    <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
      {repos.map((repo: KnownRepo) => (
        <li
          key={repo.id}
          className="hover:bg-accent/50 group flex items-center gap-2 transition-colors"
        >
          <Link
            href={encodeOpenerHref({ kind: 'targets', repoId: repo.id })}
            className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5"
          >
            <span className="truncate text-sm font-medium">
              {repoName(repo.root)}
            </span>
            <span className="text-muted-foreground truncate font-mono text-xs">
              {shorten(repo.root, home)}
            </span>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            aria-label={`Forget ${repoName(repo.root)}`}
            title="Forget this repository. The repository itself is untouched."
            disabled={forgetting === repo.id}
            className="mr-2 opacity-0 transition-opacity group-hover:opacity-60 focus-visible:opacity-100 hover:opacity-100"
            onClick={() => {
              setForgetting(repo.id);
              void forget(repo.id).finally(() => setForgetting(null));
            }}
          >
            <IconTrash className="size-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
