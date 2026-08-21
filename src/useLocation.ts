'use client';

import { useCallback, useEffect, useState } from 'react';

// The app has exactly three shapes of URL and no nested layouts, so a router
// library would be more machinery than routing. This tracks the pathname and
// exposes a push/replace that keeps history working.
function currentHref(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}

export function useLocation(): {
  pathname: string;
  search: string;
  navigate(to: string, options?: { replace?: boolean }): void;
} {
  // The query matters as much as the path: it carries which repository a local
  // review is of, so a change to it is a navigation.
  const [href, setHref] = useState(currentHref);

  useEffect(() => {
    const onPopState = () => setHref(currentHref());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback(
    (to: string, options: { replace?: boolean } = {}) => {
      if (to === currentHref()) return;
      if (options.replace === true) window.history.replaceState(null, '', to);
      else window.history.pushState(null, '', to);
      setHref(to);
    },
    []
  );

  const [pathname, query] = href.split('?');
  return {
    pathname: pathname ?? '/',
    search: query == null ? '' : `?${query}`,
    navigate,
  };
}
