import {
  encodeLocalDiffPath,
  parseLocalDiffSource,
} from '@/lib/local/diffSource';
import { normalizeGitHubPath } from '@/lib/github/normalizePath';

const GITHUB_HOST = 'github.com';

export type ViewerRoute =
  | { kind: 'redirect'; target: string }
  | {
      kind: 'render';
      upstreamPath: string;
      url: string;
      domain: string | undefined;
    }
  // A local review has no upstream URL and no domain: the target is a git
  // revspec, not a path on a host.
  | { kind: 'render-local'; target: string | undefined; canonicalPath: string };

// Resolves the catch-all viewer route into either a redirect or the props the
// viewer needs to render. Extracted from the route page so it can be unit
// tested without spinning up Next.js. Empty paths redirect to the home page;
// GitHub paths are canonicalized via normalizeGitHubPath so direct navigation
// matches the hrefs getPatchViewerHref produces from form input. Non-GitHub
// hosts are passed through unchanged because their canonical form is unknown.
export function resolveViewerRoute(
  pathSegments: readonly string[],
  requestedDomainInput: string | undefined
): ViewerRoute {
  if (pathSegments.length === 0) {
    return { kind: 'redirect', target: '/' };
  }

  // Local targets are matched before anything GitHub-shaped runs.
  // normalizeGitHubPath would otherwise rewrite and trim a revspec, and the
  // `https://github.com<path>` URL below is meaningless for a local diff.
  const local = parseLocalDiffSource(pathSegments);
  if (local != null) {
    const canonicalPath = encodeLocalDiffPath(local.target);
    const joined = `/${pathSegments.join('/')}`;
    // Send an unencoded or oddly-spelled spec to its canonical form so the URL
    // is stable and shareable between sessions.
    if (canonicalPath !== joined) {
      return { kind: 'redirect', target: canonicalPath };
    }
    return { kind: 'render-local', target: local.target, canonicalPath };
  }

  const domain =
    requestedDomainInput == null || requestedDomainInput === ''
      ? undefined
      : requestedDomainInput;
  const joinedPath = `/${pathSegments.join('/')}`;
  const upstreamPath =
    domain == null ? normalizeGitHubPath(joinedPath) : joinedPath;

  if (upstreamPath !== joinedPath) {
    const query = domain == null ? '' : `?domain=${encodeURIComponent(domain)}`;
    return { kind: 'redirect', target: `${upstreamPath}${query}` };
  }

  const host = domain ?? GITHUB_HOST;
  return {
    domain,
    kind: 'render',
    upstreamPath,
    url: `https://${host}${upstreamPath}`,
  };
}
