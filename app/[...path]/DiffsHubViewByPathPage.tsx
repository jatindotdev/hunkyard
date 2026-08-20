import { redirect } from 'next/navigation';

import { ReviewUI } from '@/components/ReviewUI';
import { resolveDiffshubViewerRoute } from '@/lib/resolveDiffshubViewerRoute';
import { resolveConfiguredRepoRoot } from '@/lib/git/repo';

// Viewer route that mirrors the upstream path. GitHub is the public default,
// while hidden alternate domains can opt in through the `domain` query param.
export async function DiffsHubViewByPathPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ domain?: string | string[] }>;
}) {
  const { path } = await params;
  const { domain } = await searchParams;
  const requestedDomain = Array.isArray(domain) ? domain[0] : domain;
  const route = resolveDiffshubViewerRoute(path, requestedDomain);

  if (route.kind === 'redirect') {
    redirect(route.target);
  }

  // Resolved here so the header can name the repository. A failure is not fatal:
  // the route itself reports a missing repository, and the label simply omits
  // the name.
  let repoRoot: string | undefined;
  if (route.kind === 'render-local') {
    repoRoot = await resolveConfiguredRepoRoot().catch(() => undefined);
  }

  return (
    <div className="flex h-dvh flex-col gap-2">
      <ReviewUI
        source={
          route.kind === 'render-local'
            ? { kind: 'local', target: route.target, repoRoot }
            : {
                kind: 'github',
                domain: route.domain,
                initialUrl: route.url,
                path: route.upstreamPath,
              }
        }
      />
    </div>
  );
}
