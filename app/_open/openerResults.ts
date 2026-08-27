import type { DirectoryListing } from '@/lib/fs/browse';
import type { RepositorySurvey } from '@/lib/git/survey';
import { encodeLocalDiffPath } from '@/lib/local/diffSource';
import { baseName, rankBy, shortenPath, type QueryKind } from '@/lib/opener/search';
import { suggestReviewTargets, validateRevspecInput } from '@/lib/local/repoSurvey';
import type { KnownRepo } from '@/components/useRepos';

// What one row in the results does when you choose it.
export type OpenerAction =
  // Somewhere to go: a review, or a pull request.
  | { kind: 'navigate'; href: string }
  // Descend into a folder, which replaces the query rather than navigating.
  | { kind: 'browse'; path: string }
  // Open a repository by path, registering it on the way.
  | { kind: 'open'; path: string }
  // Narrow everything that follows to one repository.
  | { kind: 'scope'; repoId: string; root: string };

export interface OpenerRow {
  id: string;
  title: string;
  detail?: string;
  badge?: string;
  icon: 'repo' | 'folder' | 'github' | 'diff' | 'branch' | 'commit' | 'tag';
  action: OpenerAction;
}

export interface OpenerSection {
  label: string;
  rows: OpenerRow[];
  // Shown instead of rows when there is nothing to offer but the absence is
  // worth explaining. A section that simply vanishes reads as a bug.
  note?: string;
}

// Everything offered when no repository is chosen yet: a pull request if that is
// what was typed, the repositories already opened, and whatever folders the path
// so far points at.
export function unscopedSections(options: {
  query: QueryKind;
  repos: readonly KnownRepo[];
  listing: DirectoryListing | null;
  // The half-typed last segment of a path, which the server filtered by and
  // this ranks by -- the server's filter is a substring match, and completing a
  // path wants what starts with it first.
  pathFilter: string;
  home: string | null;
}): OpenerSection[] {
  const { query, repos, listing, pathFilter, home } = options;
  const sections: OpenerSection[] = [];
  const text = query.kind === 'text' ? query.text : '';

  if (query.kind === 'github') {
    sections.push({
      label: 'Pull request',
      rows: [
        {
          id: `github:${query.href}`,
          title: query.href.replace(/^\//, ''),
          detail: 'open this pull request, comparison or commit',
          icon: 'github',
          action: { kind: 'navigate', href: query.href },
        },
      ],
    });
  }

  // Matched against the path while a path is being typed, so `~/dev/head/hunk`
  // surfaces the repository you already have open rather than listing every
  // repository above the folders you are actually walking. A parsed pull
  // request is unambiguous, so nothing is offered under it.
  const matched =
    query.kind === 'github'
      ? []
      : query.kind === 'path'
        ? rankBy(
            repos.filter((repo) =>
              repo.root.startsWith(
                query.path.slice(0, query.path.lastIndexOf('/') + 1)
              )
            ),
            pathFilter,
            (repo) => baseName(repo.root),
            4
          )
        : rankBy(repos, text, (repo) => baseName(repo.root));
  if (matched.length > 0) {
    sections.push({
      label: 'Repositories',
      rows: matched.map((repo) => ({
        id: `repo:${repo.id}`,
        title: baseName(repo.root),
        detail: shortenPath(repo.root, home),
        icon: 'repo',
        action: { kind: 'scope', repoId: repo.id, root: repo.root },
      })),
    });
  }

  // Only once a path is being typed. Listing the home directory against an
  // empty box would bury the repositories you actually use under Applications
  // and Library.
  if (query.kind === 'path' && listing != null) {
    // Whatever is already listed above as a repository is not worth a second
    // row saying the same thing one section down.
    const shown = new Set(matched.map((repo) => repo.root));
    const entries = rankBy(
      listing.entries.filter((entry) => !shown.has(entry.path)),
      pathFilter,
      (entry) => entry.name,
      8
    );
    const rows = entries.map((entry) => ({
      id: `dir:${entry.path}`,
      title: entry.name,
      detail: shortenPath(entry.path, home),
      badge: entry.isRepository ? 'git' : undefined,
      icon: 'folder' as const,
      action: entry.isRepository
        ? ({ kind: 'open', path: entry.path } as const)
        : ({ kind: 'browse', path: entry.path } as const),
    }));

    // The folder being listed is worth offering too when it is a repository,
    // since typing its full path should not require stepping back into it.
    if (listing.isRepository) {
      rows.unshift({
        id: `open:${listing.path}`,
        title: baseName(listing.path),
        detail: `${shortenPath(listing.path, home)} — open this repository`,
        badge: 'git',
        icon: 'folder' as const,
        action: { kind: 'open', path: listing.path } as const,
      });
    }

    if (rows.length > 0) sections.push({ label: 'Folders', rows });
  }

  return sections;
}

// Everything offered once a repository is chosen: what it has to review.
export function scopedSections(options: {
  repoId: string;
  survey: RepositorySurvey | null;
  text: string;
}): OpenerSection[] {
  const { repoId, survey, text } = options;
  const href = (spec: string | undefined) => encodeLocalDiffPath(spec, repoId);
  const sections: OpenerSection[] = [];

  const targets = survey == null ? [] : suggestReviewTargets(survey);
  // A count of zero is a diff with nothing in it, and offering it is offering a
  // dead end: it is selectable, it is the first thing under the cursor, and it
  // lands on an empty review. Counts are only known once the survey answers, so
  // an unknown one is still offered rather than making the list jump.
  const reviewable = targets.filter(
    (target) => target.kind !== 'range' && target.count !== 0
  );
  const uncommitted = rankBy(reviewable, text, (target) => target.title, 3);

  if (uncommitted.length === 0 && survey?.status != null && text === '') {
    sections.push({
      label: 'Uncommitted',
      rows: [],
      note: 'Nothing uncommitted. The working tree is clean.',
    });
  } else if (uncommitted.length > 0) {
    sections.push({
      label: 'Uncommitted',
      rows: uncommitted.map((target) => ({
        id: `target:${target.title}`,
        title: target.title,
        detail: target.detail,
        badge:
          target.count == null
            ? undefined
            : `${target.count} ${target.count === 1 ? 'file' : 'files'}`,
        icon: 'diff' as const,
        action: { kind: 'navigate', href: href(target.spec) },
      })),
    });
  }

  const compare = targets.find((target) => target.kind === 'range');
  if (compare?.spec != null && (text === '' || compare.title.includes(text))) {
    sections.push({
      label: 'This branch',
      rows: [
        {
          id: `compare:${compare.spec}`,
          title: compare.title,
          detail: compare.detail,
          icon: 'branch',
          action: { kind: 'navigate', href: href(compare.spec) },
        },
      ],
    });
  }

  if (survey != null) {
    const refs = rankBy(
      [...survey.branches, ...survey.remoteBranches],
      text,
      (ref) => ref.name,
      6
    );
    if (refs.length > 0) {
      sections.push({
        label: 'Branches',
        rows: refs.map((ref) => ({
          id: `ref:${ref.name}`,
          title: ref.name,
          detail: ref.subject,
          badge: ref.isHead ? 'current' : undefined,
          icon: 'branch' as const,
          action: { kind: 'navigate', href: href(ref.name) },
        })),
      });
    }

    const tags = rankBy(survey.tags, text, (tag) => tag.name, 4);
    if (tags.length > 0 && text !== '') {
      sections.push({
        label: 'Tags',
        rows: tags.map((tag) => ({
          id: `tag:${tag.name}`,
          title: tag.name,
          detail: tag.subject,
          icon: 'tag' as const,
          action: { kind: 'navigate', href: href(tag.name) },
        })),
      });
    }

    const commits = rankBy(
      survey.commits,
      text,
      (commit) => `${commit.subject} ${commit.shortOid}`,
      5
    );
    if (commits.length > 0) {
      sections.push({
        label: 'Commits',
        rows: commits.map((commit) => ({
          id: `commit:${commit.oid}`,
          title: commit.subject === '' ? commit.shortOid : commit.subject,
          detail: `${commit.shortOid} · ${commit.author}`,
          icon: 'commit' as const,
          action: { kind: 'navigate', href: href(commit.oid) },
        })),
      });
    }
  }

  // Anything git understands, for what the lists above cannot name: a range
  // typed out, a relative revision, a tag from before the hundred shown.
  const typed = validateRevspecInput(text);
  if (typed.valid && !sections.some((s) => s.rows.some((r) => r.title === typed.spec))) {
    sections.push({
      label: 'Revision',
      rows: [
        {
          id: `spec:${typed.spec}`,
          title: typed.spec,
          detail: 'review this revision, range or commit',
          icon: 'diff',
          action: { kind: 'navigate', href: href(typed.spec) },
        },
      ],
    });
  }

  return sections;
}

export function flattenRows(sections: readonly OpenerSection[]): OpenerRow[] {
  return sections.flatMap((section) => section.rows);
}
