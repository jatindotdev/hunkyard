export const LOCAL_ROUTE_PREFIX = 'local';

// The target spec as the CLI would have received it: undefined for the working
// tree, `--staged` / `--all`, or any revspec.
export interface LocalDiffSource {
  kind: 'local';
  target: string | undefined;
}

// `/local` and `/local/<spec>` describe a local review. The spec is a single
// segment so a revspec containing slashes -- `origin/main...feature/x` is
// ordinary -- must arrive percent-encoded, which is what encodeLocalDiffPath
// produces. Extra segments are joined back with `/` so a hand-typed
// `/local/origin/main...feature` still works rather than 404ing.
export function parseLocalDiffSource(
  pathSegments: readonly string[]
): LocalDiffSource | null {
  if (pathSegments.length === 0) return null;
  if (pathSegments[0] !== LOCAL_ROUTE_PREFIX) return null;

  const rest = pathSegments.slice(1);
  if (rest.length === 0) return { kind: 'local', target: undefined };

  const joined = rest.map((segment) => decodeURIComponent(segment)).join('/');
  const trimmed = joined.trim();
  return { kind: 'local', target: trimmed === '' ? undefined : trimmed };
}

// The repository goes in the query rather than a path segment: a revspec can be
// anything, so `/local/<repo>/<spec>` could not be told apart from a spec whose
// first segment happens to look like a repository id.
export function encodeLocalDiffPath(
  target: string | undefined,
  repoId?: string
): string {
  const spec =
    target == null || target.trim() === ''
      ? `/${LOCAL_ROUTE_PREFIX}`
      : `/${LOCAL_ROUTE_PREFIX}/${encodeURIComponent(target.trim())}`;
  return repoId == null || repoId === ''
    ? spec
    : `${spec}?repo=${encodeURIComponent(repoId)}`;
}

// A label for the header. There is no external URL for a local review, so the
// header's "open in new tab" affordance has nothing to point at.
export function describeLocalTarget(target: string | undefined): string {
  if (target == null) return 'working tree';
  if (target === '--staged' || target === '--cached') return 'staged changes';
  if (target === '--all') return 'all uncommitted changes';
  return target;
}
