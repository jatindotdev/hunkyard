'use client';

import { useEffect } from 'react';

import { NavigationProvider } from './navigation';
import { useLocation } from './useLocation';
import { HomePage } from '@/app/_home/HomePage';
import { ReviewUI, type ReviewSource } from '@/components/ReviewUI';
import { resolveDiffshubViewerRoute } from '@/lib/resolveDiffshubViewerRoute';
import { SITE_NAME } from '@/lib/site';

function toSegments(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment !== '');
}

export function App() {
  const { pathname, navigate } = useLocation();
  const segments = toSegments(pathname);
  const route =
    segments.length === 0
      ? null
      : resolveDiffshubViewerRoute(segments, undefined);

  // Canonicalisation used to happen as a server redirect; here it is a history
  // replace, so the URL still ends up in its canonical form without a reload.
  useEffect(() => {
    if (route?.kind === 'redirect') navigate(route.target, { replace: true });
  }, [route, navigate]);

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
        <HomePage />
      </NavigationProvider>
    );
  }

  const source: ReviewSource =
    route.kind === 'render-local'
      ? { kind: 'local', target: route.target }
      : {
          kind: 'github',
          domain: route.domain,
          initialUrl: route.url,
          path: route.upstreamPath,
        };

  return (
    <NavigationProvider value={navigator}>
      <div className="flex h-dvh flex-col gap-2">
        <ReviewUI source={source} />
      </div>
    </NavigationProvider>
  );
}
