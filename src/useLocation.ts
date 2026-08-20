'use client';

import { useCallback, useEffect, useState } from 'react';

// The app has exactly three shapes of URL and no nested layouts, so a router
// library would be more machinery than routing. This tracks the pathname and
// exposes a push/replace that keeps history working.
export function useLocation(): {
  pathname: string;
  navigate(to: string, options?: { replace?: boolean }): void;
} {
  const [pathname, setPathname] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname
  );

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback(
    (to: string, options: { replace?: boolean } = {}) => {
      if (to === window.location.pathname) return;
      if (options.replace === true) window.history.replaceState(null, '', to);
      else window.history.pushState(null, '', to);
      setPathname(to);
    },
    []
  );

  return { pathname, navigate };
}
