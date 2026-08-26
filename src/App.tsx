'use client';

import { useEffect, useState } from 'react';

import { NavigationProvider } from './navigation';
import { useLocation } from './useLocation';
import { OpenPage } from '@/app/_open/OpenPage';
import { ReviewUI, type ReviewSource } from '@/components/ReviewUI';
import { useRepos } from '@/components/useRepos';
import { encodeLocalDiffPath } from '@/lib/localDiffSource';
import { resolveViewerRoute } from '@/lib/resolveViewerRoute';
import { SITE_NAME } from '@/lib/site';

function toSegments(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment !== '');
}

export function App() {
  const { pathname, search, navigate } = useLocation();
  const segments = toSegments(pathname);
  const params = new URLSearchParams(search);
  const repoId = params.get('repo') ?? undefined;
  // The diff route has always been able to fetch a patch from another forge;
  // reading the domain back is what lets the client reach it.
  const domain = params.get('domain') ?? undefined;
  const route =
    segments.length === 0 ? null : resolveViewerRoute(segments, domain);

  // The header can name the repository only if it is told which one, and the
  // list is already fetched for the opener.
  const { repos } = useRepos();
  const repoRoot = repos.find((repo) => repo.id === repoId)?.root;

  // Canonicalisation used to happen as a server redirect; here it is a history
  // replace, so the URL still ends up in its canonical form without a reload.
  useEffect(() => {
    if (route?.kind === 'redirect') navigate(route.target, { replace: true });
  }, [route, navigate]);

  // A local URL with no repository names the most recently opened one. The
  // daemon serves several, so the id is put into the URL rather than left
  // implicit: reviewing two repositories in two tabs has to keep working after
  // a third `hunk` changes which one is most recent.
  const [defaultRepoMissing, setDefaultRepoMissing] = useState(false);
  const needsRepoId = route?.kind === 'render-local' && repoId == null;
  useEffect(() => {
    if (!needsRepoId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/repos', { cache: 'no-store' });
        const body = (await response.json()) as { defaultId?: string | null };
        if (cancelled) return;
        if (body.defaultId == null) {
          setDefaultRepoMissing(true);
          return;
        }
        navigate(
          encodeLocalDiffPath(
            route.kind === 'render-local' ? route.target : undefined,
            body.defaultId
          ),
          { replace: true }
        );
      } catch {
        if (!cancelled) setDefaultRepoMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, needsRepoId, route]);

  useEffect(() => {
    document.title =
      route == null || route.kind === 'redirect'
        ? SITE_NAME
        : route.kind === 'render-local'
          ? `${route.target ?? 'working tree'} · ${SITE_NAME}`
          : `${route.upstreamPath.replace(/^\//, '')} · ${SITE_NAME}`;
  }, [route]);

  const navigator = {
    push: (to: string) => navigate(to),
    replace: (to: string) => navigate(to, { replace: true }),
  };

  if (route == null || route.kind === 'redirect') {
    return (
      <NavigationProvider value={navigator}>
        <OpenPage search={search} />
      </NavigationProvider>
    );
  }

  const source: ReviewSource =
    route.kind === 'render-local'
      ? { kind: 'local', target: route.target, repoId, repoRoot }
      : {
          kind: 'github',
          domain: route.domain,
          initialUrl: route.url,
          path: route.upstreamPath,
        };

  if (needsRepoId) {
    // Nothing has ever been opened, so there is no default to fall back to.
    // The opener is where that is fixed, not the terminal.
    if (defaultRepoMissing) {
      return (
        <NavigationProvider value={navigator}>
          <OpenPage search="" />
        </NavigationProvider>
      );
    }
    return (
      <NavigationProvider value={navigator}>
        <div className="text-muted-foreground grid h-dvh place-items-center p-6 text-center text-sm">
          Finding your repository…
        </div>
      </NavigationProvider>
    );
  }

  return (
    <NavigationProvider value={navigator}>
      <div className="flex h-dvh flex-col gap-2">
        <ReviewUI source={source} />
      </div>
    </NavigationProvider>
  );
}
