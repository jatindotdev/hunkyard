import { getPatchViewerHref } from './getPatchViewerHref';

// What one input box can mean.
//
// The opener used to be three surfaces -- a URL field, a repository list, and a
// folder browser -- each with its own way in and its own way back. They are one
// field now, so this decides what you meant by what you typed rather than by
// which box you typed it into.

export type QueryKind =
  | { kind: 'empty' }
  // Parses as something on a forge: a pull request, a compare, a commit.
  | { kind: 'github'; href: string }
  // Starts at the filesystem root or at home, so it names a directory.
  | { kind: 'path'; path: string }
  // Anything else: matched against names.
  | { kind: 'text'; text: string };

export function classifyQuery(input: string, home: string | null): QueryKind {
  const trimmed = input.trim();
  if (trimmed === '') return { kind: 'empty' };

  if (trimmed.startsWith('/')) return { kind: 'path', path: trimmed };
  if (trimmed === '~' || trimmed.startsWith('~/')) {
    // Typed by hand far more often than the expanded form, and meaningless to
    // every other consumer of a path, so it is expanded here rather than in the
    // fetch.
    if (home == null) return { kind: 'text', text: trimmed };
    return { kind: 'path', path: home + trimmed.slice(1) };
  }

  // Checked after paths: a URL never starts with a slash, and `owner/repo` is
  // ambiguous with a relative path, which this does not accept anyway.
  const href = getPatchViewerHref(trimmed);
  if (href != null) return { kind: 'github', href };

  return { kind: 'text', text: trimmed };
}

// The directory to list for a path query, and the part still being typed.
//
// `/Users/ja` lists `/Users` filtered by `ja`, so results narrow as you type
// rather than waiting for a directory that does not exist yet.
export function splitPathQuery(path: string): { dir: string; filter: string } {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash <= 0) return { dir: '/', filter: path.slice(1) };
  return { dir: path.slice(0, lastSlash), filter: path.slice(lastSlash + 1) };
}

// A subsequence match, scored so that better matches sort first.
//
// Not a fuzzy library: the sets here are a handful of repositories and at most a
// few hundred refs, and the rules that matter are few enough to read. Returns
// null when the query is not a subsequence at all.
export function matchScore(text: string, query: string): number | null {
  if (query === '') return 0;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  // An exact or prefix match is not merely a good subsequence, it is what you
  // meant, and it has to beat a scattered match in a longer string.
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 900 - text.length;

  let score = 0;
  let from = 0;
  let previous = -2;
  for (const character of needle) {
    const at = haystack.indexOf(character, from);
    if (at === -1) return null;
    // Adjacent characters are worth more than scattered ones, and a match just
    // after a separator is worth more than one in the middle of a word.
    if (at === previous + 1) score += 8;
    else if (at === 0 || '/-_. '.includes(haystack[at - 1] ?? '')) score += 5;
    else score += 1;
    previous = at;
    from = at + 1;
  }

  // Shorter haystacks win ties: `hunk` should match `hunk` before `hunkyard`.
  return score - text.length / 100;
}

export interface Ranked<T> {
  item: T;
  score: number;
}

export function rankBy<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
  limit = 8
): T[] {
  if (query === '') return items.slice(0, limit);

  const ranked: Ranked<T>[] = [];
  for (const item of items) {
    const score = matchScore(text(item), query);
    if (score != null) ranked.push({ item, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit).map((entry) => entry.item);
}

// The last segment of a path, for showing a repository by name.
export function baseName(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const at = trimmed.lastIndexOf('/');
  return at === -1 ? trimmed : trimmed.slice(at + 1);
}

// `~` back in, since that is how the path was most likely typed and always how
// it is shortest to read.
export function shortenPath(path: string, home: string | null): string {
  if (home == null || home === '') return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
